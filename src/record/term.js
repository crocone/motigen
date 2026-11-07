// A real terminal, recorded: everything typed goes through a pty, so the stream has the real echo, prompts and
// output, and every chunk gets a timestamp. The player replays the stream through xterm.js up to any moment.
//
// Backends:
//   pty     node-pty on this machine (Windows, macOS, Linux). Default.
//   docker  `docker exec -i <container> script -T …` inside a container that has <dir> mounted at /share:
//           a clean "laptop" with nothing of yours on it (see freshContainer in docker.js).
// Output: <dir>/<name>.out (the raw stream, after one header line) and <dir>/<name>.tm (`script -T` timing:
// "<seconds since the previous chunk> <bytes>" per line), plus <name>.marks.json for the marks you set.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, openSync, writeSync, closeSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const sleep = ms => new Promise(r => setTimeout(r, ms));
const now = () => Date.now() / 1000;

// Deterministic jitter for typing.
export function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }

const BASH_RC = (cwd, ps1) => [
  `PS1='${ps1}'`,
  'export PROMPT_COMMAND=',
  'unset HISTFILE',
  cwd ? `cd "${cwd}"` : '',
  'clear',
  '',
].join('\n');
export const DEFAULT_PS1 = '\\[\\e[38;5;244m\\]\\w\\[\\e[0m\\] \\[\\e[38;5;173m\\]$\\[\\e[0m\\] ';

export class Term {
  /**
   * @param {string} dir   where the stream files go
   * @param {object} [o]
   * @param {'pty'|'docker'} [o.backend]
   * @param {string} [o.name]        file stem, default "term"
   * @param {number} [o.cols] @param {number} [o.rows]
   * @param {string} [o.shell]       pty: the program (default bash, or $SHELL; falls back to powershell.exe on Windows)
   * @param {string[]} [o.args]      pty: its arguments (default: bash --rcfile <rc> -i)
   * @param {string} [o.cwd]         starting folder (inside the container for docker)
   * @param {object} [o.env]
   * @param {string} [o.ps1]         bash prompt
   * @param {string} [o.container]   docker: the container name
   * @param {string} [o.share]       docker: the path of <dir> inside the container (default /share)
   */
  constructor(dir, { backend = 'pty', name = 'term', cols = 112, rows = 30, shell, args, cwd, env, ps1 = DEFAULT_PS1, container, share = '/share' } = {}) {
    this.dir = resolve(dir); this.backend = backend; this.name = name; this.cols = cols; this.rows = rows;
    this.shell = shell; this.args = args; this.cwd = cwd; this.env = env; this.ps1 = ps1; this.container = container; this.share = share;
    this.rand = rng(7); this.marks = []; this.seen = 0;
    this.outFile = join(this.dir, `${name}.out`); this.tmFile = join(this.dir, `${name}.tm`);
  }

  async start() {
    mkdirSync(this.dir, { recursive: true });
    for (const f of [this.outFile, this.tmFile]) rmSync(f, { force: true });
    this.t0 = now();
    if (this.backend === 'docker') return this.#startDocker();
    return this.#startPty();
  }

  async #startPty() {
    let pty;
    try { pty = await import('node-pty'); } catch (e) { throw new Error(`node-pty is not installed (${e.message.split('\n')[0]}); npm i node-pty, or record in a container with backend: "docker"`); }
    const win = process.platform === 'win32';
    let shell = this.shell || process.env.SHELL || 'bash', args = this.args;
    if (win && shell.startsWith('/')) shell = shell.split('/').pop(); // an MSYS path from Git Bash: let PATH find it
    const isBash = /(^|[\\/])bash(\.exe)?$/.test(shell);
    if (isBash) {
      const rc = join(this.dir, `${this.name}.rc`);
      writeFileSync(rc, BASH_RC(this.cwd, this.ps1));
      args ||= ['--rcfile', win ? rc.replace(/\\/g, '/') : rc, '-i'];
    }
    if (!win && !isBash && !args) args = ['-i'];
    if (win && !isBash && !this.shell && !process.env.SHELL) { shell = 'powershell.exe'; args = ['-NoLogo', '-NoProfile']; }
    const env = { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor', LANG: process.env.LANG || 'C.UTF-8', ...(this.env || {}) };
    try { this.p = pty.spawn(shell, args || [], { name: 'xterm-256color', cols: this.cols, rows: this.rows, cwd: isBash ? undefined : this.cwd, env }); }
    catch (e) { throw new Error(`could not start ${shell}: ${e.message}`); }
    // the stream file, after a header line like `script` writes
    this.fd = openSync(this.outFile, 'w');
    this.tmFd = openSync(this.tmFile, 'w');
    writeSync(this.fd, `motigen term ${new Date().toISOString()} ${this.cols}x${this.rows} ${shell}\n`);
    this.buf = ''; this.last = now();
    this.p.onData(d => {
      const b = Buffer.from(d, 'utf8'), t = now();
      writeSync(this.fd, b);
      writeSync(this.tmFd, `${(t - this.last).toFixed(6)} ${b.length}\n`);
      this.last = t; this.buf += d;
    });
    this.exited = new Promise(r => this.p.onExit(() => { this.gone = true; r(); }));
    // node-pty 1.1 on Windows forks a helper to list the console's processes before a kill; run from a terminal
    // that helper cannot attach to the console (it already has one), prints "AttachConsole failed" and times out
    // after 5 s. The shell's own pid is all the kill needs.
    const agent = this.p._agent;
    if (win && agent && typeof agent._getConsoleProcessList === 'function') agent._getConsoleProcessList = () => Promise.resolve([agent._innerPid ?? this.p.pid]);
    if (!isBash && this.cwd && win) { /* PowerShell: cd after start */ await sleep(300); this.send(`cd "${this.cwd}"\r`); await sleep(200); this.send('clear\r'); }
  }

  async #startDocker() {
    if (!this.container) throw new Error('docker backend: give the container name');
    const rc = join(this.dir, `${this.name}.rc`);
    writeFileSync(rc, [`stty cols ${this.cols} rows ${this.rows}`, BASH_RC(this.cwd || '~', this.ps1)].join('\n'));
    const s = `${this.share}/${this.name}`;
    this.p = spawn('docker', ['exec', '-i', this.container, 'script', '-q', '-f', '-T', `${s}.tm`, '-O', `${s}.out`, '-c', `bash --rcfile ${s}.rc -i`], { stdio: ['pipe', 'ignore', 'inherit'] });
    this.exited = new Promise(r => this.p.on('close', () => { this.gone = true; r(); }));
    // start() fails here, not later as an uncaught exception, when docker cannot be run at all
    await new Promise((ok, no) => { this.p.once('spawn', ok); this.p.once('error', e => no(new Error(`docker exec failed: ${e.message}`))); });
    this.p.on('error', () => {});
  }

  /** The stream so far, as text. */
  out() {
    if (this.backend === 'docker') return existsSync(this.outFile) ? readFileSync(this.outFile, 'utf8') : '';
    return this.buf || '';
  }

  /** Until `text` shows up in the stream (searched after the previous match, so repeated words resolve in order). */
  async waitFor(text, timeout = 120000) {
    const end = Date.now() + timeout;
    for (;;) {
      const o = this.out(), i = o.indexOf(text, this.seen);
      if (i >= 0) { this.seen = i + text.length; return; }
      if (Date.now() > end) throw new Error(`terminal: no "${text}" after ${timeout} ms\n${o.slice(-600)}`);
      await sleep(100);
    }
  }

  /** Until the stream has been quiet for `ms` (a TUI redraws its spinner while it works). */
  async waitIdle(ms = 5000, timeout = 300000) {
    const end = Date.now() + timeout;
    let len = -1, since = Date.now();
    for (;;) {
      const n = this.out().length;
      if (n !== len) { len = n; since = Date.now(); }
      if (Date.now() - since >= ms) return;
      if (Date.now() > end) throw new Error('terminal never went quiet');
      await sleep(200);
    }
  }

  mark(name) { this.marks.push({ name, t: now() - this.t0 }); }
  send(s) { if (this.backend === 'docker') this.p.stdin.write(s); else this.p.write(s); }

  /** Type like a person: `cps` characters per second with jitter. */
  async type(s, { cps = 13 } = {}) {
    for (const ch of s) {
      this.send(ch);
      await sleep((1000 / cps) * (0.55 + this.rand() * 0.9) + (ch === ' ' ? 40 : 0));
    }
  }
  async paste(s) { this.send(s); await sleep(250); }
  async enter() { this.send('\r'); await sleep(60); }

  async stop() {
    if (this.backend === 'docker') {
      this.send('exit\r');
      await Promise.race([this.exited, sleep(5000)]);
    } else {
      // the pty is closed while the shell is still there: ConPTY's handles are released cleanly that way, and
      // nothing stays behind to keep the process alive
      if (!this.gone) { try { this.p.kill(); } catch { /* already gone */ } }
      await Promise.race([this.exited, sleep(3000)]);
      for (const k of ['fd', 'tmFd']) if (this[k] != null) { closeSync(this[k]); this[k] = null; }
    }
    writeFileSync(join(this.dir, `${this.name}.marks.json`), JSON.stringify({ t0: this.t0, marks: this.marks }, null, 1));
  }
}
