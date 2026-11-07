import { parseArgs } from 'node:util';
import { availableParallelism } from 'node:os';
import { createRequire } from 'node:module';
import { join, relative, resolve, dirname } from 'node:path';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { loadProject, resolveFormat, defaultAudio } from './project.js';
import { renderFrames, renderVideo, exportEvents } from './render.js';

const require = createRequire(import.meta.url);
export const VERSION = require('../package.json').version;

const USAGE = `motigen ${VERSION} — video as code

  motigen init <guide|dom|canvas> <dir>      a new project from a template
  motigen preview [--port 4310] [--open]     player: scrub, sound, formats, a render button
  motigen frames -t 1,2.5,10 [-o shots]      stills at those seconds (jpeg; --png; --element '#terminal')
  motigen render [-o out.mp4]                the video (--fps 30 --workers 4 --audio audio/mix.wav --range 10-20)
  motigen events [-o audio/events.json]      the timeline's sound events, for the mix
  motigen vo [audio/lines.txt]               narration: one ElevenLabs call, split per line into audio/vo/ ($ELEVENLABS_API_KEY)
  motigen vo split <resp.json> <lines.txt>   split a saved with-timestamps response instead of calling the API
  motigen vo import [audio/vo] [lines.txt]   use your own recordings: writes vo.json for the files in the folder
  motigen vo check [audio/vo]                flag breathy or garbled lines (spectral flatness)
  motigen mix                                voice + effects + bed from audio/events.json → audio/mix.wav (−14 LUFS)
  motigen srt [-o out/<name>.srt]            subtitles from the voice cues
  motigen build [--fmt h --fmt v]            events → mix → render → srt, per motigen.json
  motigen record [take.mjs]                  run a take script (it imports { Term, Browser } from 'motigenjs/record')
  motigen skill [dir]                        install the agent skill into ./.claude/skills/motigen (or dir)
  motigen help

Options:
  -C, --project <dir>    project folder (default: cwd); its motigen.json sets page, fps, size, audio, out, formats
  -p, --page <file>      the film page (default: motigen.json "page", else film.html)
  --fmt <name>           a format from motigen.json "formats" (size + query + out)
  --size WxH             viewport (default 1920x1080)
  --query "fmt=v"        query string for the page
  --scale N              device scale factor for stills (default 1)
  --no-audio             render without sound even if audio/mix.wav exists
  --crf N --preset P     x264 quality (default 14, slow)
  -j, --workers N        pages rendering in parallel (default: half the cores, at most 4)
  --channel chrome       installed Chrome instead of Playwright's Chromium
  --no-gpu / --gpu       GPU flags (default: on under Windows)
  --ffmpeg <path>        ffmpeg binary (default: ffmpeg in PATH, or $MOTIGEN_FFMPEG)
  --timeout <s>          seconds to wait for window.__film.ready (default 60)
  --voice <id> --model <id> --seed <n>   TTS settings (also "vo": {…} in motigen.json)
  --limit <n>            vo check: flatness above this is flagged (default 0.12)

motigen.json may also hold "vo": { "voice", "model", "seed", "settings" }, "mix": { levels, ducking, target } and
"spellings": [["Acme Cloud dot com", "acmecloud.com"]] for the subtitles.
`;

const OPTIONS = {
  project: { type: 'string', short: 'C' }, page: { type: 'string', short: 'p' }, out: { type: 'string', short: 'o' },
  times: { type: 'string', short: 't' }, every: { type: 'string' }, element: { type: 'string' }, png: { type: 'boolean' }, quality: { type: 'string' }, scale: { type: 'string' },
  fps: { type: 'string' }, size: { type: 'string' }, query: { type: 'string' }, fmt: { type: 'string', multiple: true },
  audio: { type: 'string' }, 'no-audio': { type: 'boolean' }, workers: { type: 'string', short: 'j' }, range: { type: 'string' },
  crf: { type: 'string' }, preset: { type: 'string' }, channel: { type: 'string' }, gpu: { type: 'boolean' }, 'no-gpu': { type: 'boolean' },
  ffmpeg: { type: 'string' }, timeout: { type: 'string' }, port: { type: 'string' }, open: { type: 'boolean' }, force: { type: 'boolean' },
  voice: { type: 'string' }, model: { type: 'string' }, seed: { type: 'string' }, limit: { type: 'string' },
  help: { type: 'boolean', short: 'h' }, version: { type: 'boolean', short: 'v' },
};

const fail = m => { throw new Error(m); };
const parseSize = s => { if (!s) return null; const m = /^(\d+)\s*[x×,]\s*(\d+)$/.exec(s.trim()); return m ? [+m[1], +m[2]] : fail(`--size wants WxH, got "${s}"`); };
const parseRange = s => { if (!s) return null; const m = /^([\d.]*)\s*-\s*([\d.]*)$/.exec(s.trim()); return m ? [+(m[1] || 0), m[2] ? +m[2] : Infinity] : fail(`--range wants a-b seconds, got "${s}"`); };
const num = (v, name, d) => (v == null ? d : Number.isFinite(+v) ? +v : fail(`--${name} wants a number, got "${v}"`));
const fmtTime = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const defaultWorkers = () => Math.max(1, Math.min(4, Math.floor(availableParallelism() / 2)));
/** A path for messages: relative to cwd when it is inside it, else absolute. */
const show = f => { const r = relative(process.cwd(), f); return r && !r.startsWith('..') ? r : f; };

/** Everything openFilm needs, from the project config, the chosen format and the flags. */
async function target(v, fmtName) {
  const project = await loadProject(v.project || '.');
  const f = resolveFormat(project, fmtName);
  return {
    project: project.root, cfg: project, fmtName,
    page: v.page || f.page, size: parseSize(v.size) || f.size, query: v.query ?? f.query, outDefault: f.out, fps: num(v.fps, 'fps', f.fps),
    channel: v.channel, gpu: v['no-gpu'] ? false : v.gpu ? true : process.platform === 'win32',
    timeout: num(v.timeout, 'timeout', 60) * 1000, ffmpeg: v.ffmpeg || process.env.MOTIGEN_FFMPEG || 'ffmpeg',
    scale: num(v.scale, 'scale', 1),
  };
}
const open = t => ({ project: t.project, page: t.page, query: t.query, size: t.size, channel: t.channel, gpu: t.gpu, timeout: t.timeout });
/** The project and its audio folder, for the sound commands. */
async function audioOf(v) { const project = await loadProject(v.project || '.'); return { project, audio: resolve(project.root, project.audio), vo: resolve(project.root, project.audio, 'vo') }; }

function progress(label) {
  let last = 0; const t0 = Date.now();
  return (i, n, done) => {
    const now = Date.now(); if (!done && now - last < 500) return; last = now;
    const s = (now - t0) / 1000, rate = i / Math.max(0.001, s), eta = rate > 0 ? (n - i) / rate : 0;
    process.stderr.write(`\r[${label}] ${i}/${n} frames · ${rate.toFixed(1)} fps · ${done ? `${fmtTime(s)} total` : `eta ${fmtTime(eta)}`}${done ? '\n' : '   '}`);
  };
}

const commands = {
  async help() { process.stdout.write(USAGE); },
  async version() { console.log(VERSION); },

  async frames(v, pos) {
    const t = await target(v, v.fmt?.[0]);
    const times = (v.times || pos[0] || '').split(/[,\s]+/).filter(Boolean).map(Number);
    const every = num(v.every, 'every', 0);
    if (!times.length && !every) fail('frames: give the seconds, e.g. -t 0,1.5,10 (or --every 5)');
    if (times.some(x => !Number.isFinite(x))) fail(`frames: bad time in "${v.times}"`);
    const out = resolve(t.project, v.out || 'shots');
    const files = await renderFrames({ ...open(t), scale: t.scale, times, every, out, format: v.png ? 'png' : 'jpeg', quality: num(v.quality, 'quality', 90), element: v.element });
    for (const f of files) console.log(show(f));
  },

  async events(v) {
    const t = await target(v, v.fmt?.[0]);
    const out = resolve(t.project, v.out || join(t.cfg.audio, 'events.json'));
    const ev = await exportEvents({ ...open(t), out });
    console.log(`events -> ${show(out)} · dur ${(+ev.dur).toFixed(2)} s · vo ${ev.vo?.length ?? 0} · clicks ${ev.clicks?.length ?? 0} · keys ${ev.keys?.length ?? 0}`);
  },

  async render(v) {
    const t = await target(v, v.fmt?.[0]);
    const out = resolve(t.project, v.out || t.outDefault);
    const audio = v['no-audio'] ? null : v.audio ? resolve(t.project, v.audio) : defaultAudio(t.cfg);
    const bar = progress('render');
    const r = await renderVideo({ ...open(t), out, fps: t.fps, audio, crf: num(v.crf, 'crf', 14), preset: v.preset || 'slow', range: parseRange(v.range), workers: num(v.workers, 'workers', defaultWorkers()), ffmpeg: t.ffmpeg, onProgress: bar });
    bar(r.frames, r.frames, true);
    console.log(`${show(r.out)} · ${r.frames} frames @ ${r.fps} fps${audio ? ' · audio ' + relative(t.project, audio) : ' · silent'} · ${r.seconds.toFixed(0)} s`);
  },

  async vo(v, pos) {
    const { project, audio, vo: voDir } = await audioOf(v);
    const voMod = await import('./audio/vo.js');
    const sub = ['tts', 'split', 'import', 'check'].includes(pos[0]) ? pos.shift() : 'tts';
    if (sub === 'split') {
      const [resp, lines] = pos;
      if (!resp || !lines) fail('vo split: motigen vo split <resp.json> <lines.txt>');
      const rows = await voMod.splitResponse(JSON.parse(await readFile(resolve(project.root, resp), 'utf8')), await voMod.readLines(resolve(project.root, lines)), resolve(project.root, v.out || voDir));
      for (const r of rows) console.log(`${r.id}  ${r.dur.toFixed(3)} s  ${r.text.slice(0, 70)}`);
    } else if (sub === 'import') {
      const dir = resolve(project.root, pos[0] || voDir), linesFile = pos[1] ? resolve(project.root, pos[1]) : existsSync(join(audio, 'lines.txt')) ? join(audio, 'lines.txt') : null;
      const rows = await voMod.importDir(dir, linesFile);
      for (const r of rows) console.log(`${r.id}  ${r.dur.toFixed(3)} s  ${r.text.slice(0, 70)}`);
      console.log(`${rows.length} lines -> ${show(join(dir, 'vo.json'))}`);
    } else if (sub === 'check') {
      const rows = await voMod.check(resolve(project.root, pos[0] || voDir), { limit: num(v.limit, 'limit', 0.12) });
      for (const r of rows) console.log(`${r.id}  flatness ${r.flatness.toFixed(3)}  ${r.ok ? 'ok' : 'BAD'}`);
      if (rows.some(r => !r.ok)) process.exitCode = 2;
    } else {
      const linesFile = resolve(project.root, pos[0] || join(audio, 'lines.txt'));
      const cfg = project.vo || {};
      const opts = { voice: v.voice || cfg.voice, model: v.model || cfg.model, seed: v.seed != null ? +v.seed : cfg.seed, settings: cfg.settings };
      const rows = await voMod.tts(linesFile, resolve(project.root, v.out || voDir), opts);
      for (const r of rows) console.log(`${r.id}  ${r.dur.toFixed(3)} s  ${r.text.slice(0, 70)}`);
      console.log(`${rows.length} lines -> ${show(resolve(project.root, v.out || voDir))}`);
    }
  },

  async mix(v) {
    const { project, audio } = await audioOf(v);
    if (project.mix?.engine === 'page') {
      // the canvas kit mixes inside the page (its own levels, ducking and effects library): take that
      const t = await target(v, v.fmt?.[0]);
      const { pageMix } = await import('./render.js');
      const out = v.out ? resolve(project.root, v.out) : join(audio, 'mix.wav');
      const r = await pageMix({ ...open(t), out });
      if (!r) fail('mix engine "page" but the page has no window.__film.wav(): use the canvas kit, or set "mix": {"engine": "node"}');
      const n = r.report?.norm?.after, voices = r.report?.vo?.length ?? 0;
      const level = n && Number.isFinite(n.integrated) ? ` · ${n.integrated.toFixed(2)} LUFS · peak ${n.truePeakDb.toFixed(2)} dBTP` : ' · silent';
      console.log(`${show(out)} · in-page mix · voice ${voices} · sfx ${r.report?.sfx?.length ?? 0}${r.report?.missing?.length ? ` · missing ${r.report.missing.join(', ')}` : ''}${level}`);
      if (!voices) console.error('no voice lines yet: run `motigen vo` (or `motigen vo import`) to make audio/vo/, then mix again');
      return;
    }
    if (!existsSync(join(audio, 'events.json'))) fail(`${show(join(audio, 'events.json'))} is missing: run motigen events first`);
    const { mix } = await import('./audio/mix.js');
    const r = await mix({ dir: audio, out: v.out ? resolve(project.root, v.out) : undefined, cfg: project.mix || {}, log: s => console.error(s) });
    if (r.missing.length) console.error(`missing: ${r.missing.join(', ')}`);
    console.log(`${show(r.out)} · ${r.dur.toFixed(2)} s · voice ${r.vo.length} · sfx ${r.sfx} · bed ${r.bed ? (r.bed.looped ? 'looped' : 'as is') : 'none'} · ${r.inputLufs} → ${r.lufs} LUFS · peak ${r.truePeakDb} dBTP · ${r.master === 'limiter' ? `limited ${r.limited}%` : `LRA ${r.lra} LU`}`);
    if (!r.vo.length) console.error('no voice lines yet: run `motigen vo` (or `motigen vo import`) to make audio/vo/, then mix again');
  },

  async srt(v) {
    const { project, audio } = await audioOf(v);
    const { writeSrt } = await import('./audio/srt.js');
    const out = resolve(project.root, v.out || project.out.replace(/\.mp4$/i, '') + '.srt');
    await (await import('node:fs/promises')).mkdir(dirname(out), { recursive: true });
    const r = await writeSrt({ dir: audio, out, spellings: project.spellings || [] });
    console.log(`${r.cues} cues -> ${show(r.out)}`);
  },

  async build(v) {
    const project = await loadProject(v.project || '.');
    const fmts = v.fmt?.length ? v.fmt : project.formats ? Object.keys(project.formats) : [''];
    const audio = resolve(project.root, project.audio), events = join(audio, 'events.json');
    await commands.events({ ...v, out: events, fmt: [fmts[0]] });
    const hasVo = existsSync(join(audio, 'vo', 'vo.json'));
    if ((hasVo || project.mix?.engine === 'page') && !v['no-audio']) await commands.mix({ ...v, out: undefined });
    for (const f of fmts) await commands.render({ ...v, fmt: [f], out: undefined });
    if (hasVo) await commands.srt({ ...v, out: undefined });
  },

  async record(v, pos) {
    const project = await loadProject(v.project || '.');
    const script = resolve(project.root, pos[0] || 'take.mjs');
    if (!existsSync(script)) fail(`record: ${show(script)} not found`);
    const { register } = await import('node:module');
    const { pathToFileURL } = await import('node:url');
    register('./record/hooks.js', import.meta.url);
    process.chdir(project.root);
    process.env.MOTIGEN_PROJECT = project.root;
    await import(pathToFileURL(script).href);
  },

  async skill(v, pos) {
    const { copyFile, mkdir } = await import('node:fs/promises');
    const { fileURLToPath } = await import('node:url');
    const src = fileURLToPath(new URL('../skill/SKILL.md', import.meta.url));
    const dir = resolve(pos[0] || join('.claude', 'skills', 'motigen'));
    await mkdir(dir, { recursive: true });
    await copyFile(src, join(dir, 'SKILL.md'));
    console.log(`${show(join(dir, 'SKILL.md'))} · a coding agent in this folder now knows how to make videos with motigen`);
  },

  async preview(v) {
    const { preview } = await import('./preview.js');
    const t = await target(v, v.fmt?.[0]);
    await preview({ project: t.cfg, port: num(v.port, 'port', 4310), open: !!v.open, channel: t.channel, gpu: t.gpu, ffmpeg: t.ffmpeg });
  },

  async init(v, pos) {
    const { init } = await import('./init.js');
    const [template, dir] = pos;
    if (!template || !dir) fail('init: motigen init <guide|dom|canvas> <dir>');
    const files = await init(template, dir, { force: !!v.force });
    const where = show(resolve(dir)) || '.';
    console.log(`${template} project in ${where}:`);
    for (const f of files) console.log('  ' + f);
    console.log(`\nnext: cd ${where} && ${files.includes('take.mjs') ? 'motigen record take.mjs && ' : ''}motigen preview`);
  },
};

export async function main(argv) {
  let parsed;
  try { parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true }); }
  catch (e) { throw new Error(`${e.message.replace(/^.*?: /, '')}\n\n${USAGE}`); }
  const { values: v, positionals } = parsed;
  if (v.version) return commands.version();
  const [cmd, ...pos] = positionals;
  if (v.help || !cmd || cmd === 'help') return commands.help();
  if (!commands[cmd]) throw new Error(`unknown command "${cmd}"\n\n${USAGE}`);
  await commands[cmd](v, pos);
}
