// Rendering: open a film page headless, drive `window.__film.renderAt(t)` frame by frame, capture through CDP and
// pipe PNGs into ffmpeg. A frame is a pure function of t, so the frame range can be split between several pages
// (`workers`), each encoding its own part; the parts are concatenated losslessly and the audio is muxed last.
import { spawn } from 'node:child_process';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { launch, newContext } from './browser.js';
import { routeProject, ORIGIN } from './serve.js';

// `__ad` is the name an earlier generation of canvas films registered; it is accepted as an alias of `__film`.
const READY = `(() => { const f = window.__film || window.__ad; if (f && !window.__film) window.__film = f; return !!(f && f.ready === true); })()`;

/**
 * Open a film page. Returns { dur, fps, at(t), shot(format), page, close() }.
 * @param {object} o
 * @param {string} o.project      project folder (served at /)
 * @param {string} [o.page]       page path inside it, default film.html
 * @param {string} [o.query]      query string, e.g. 'fmt=v'
 * @param {number[]} [o.size]     viewport [w, h]
 * @param {number} [o.scale]      deviceScaleFactor
 * @param {string} [o.channel]    'chrome' to use installed Chrome
 * @param {boolean} [o.gpu]
 * @param {number} [o.timeout]    ms to wait for __film.ready
 * @param {'auto'|'viewport'} [o.capture]  'auto' reads a film's canvas directly when it exposes one (window.__film.canvas)
 * @param {import('playwright').Browser} [o.browser]  share a browser between pages
 * @param {(line: string) => void} [o.log]
 */
export async function openFilm({ project, page: pageName = 'film.html', query = '', size = [1920, 1080], scale = 1, channel, gpu, timeout = 60000, browser: shared, capture = 'auto', log = s => console.error(s) } = {}) {
  const browser = shared || await launch({ channel, gpu });
  const context = await newContext(browser, { width: size[0], height: size[1], scale });
  await routeProject(context, project);
  const page = await context.newPage();
  // 404s of optional files (vo.json, sfx.json…) are reported by the page itself; the rest of the console noise matters
  page.on('console', m => { if ((m.type() === 'error' || m.type() === 'warning') && !/Failed to load resource: .* 404/.test(m.text())) log(`[page:${m.type()}] ${m.text()}`); });
  page.on('pageerror', e => log('[pageerror] ' + e.message));
  const p = pageName.replace(/^\/+/, '');
  const url = `${ORIGIN}/${p}${query ? (p.includes('?') ? '&' : '?') + query : ''}`;
  await page.goto(url);
  try { await page.waitForFunction(READY, null, { timeout }); }
  catch (e) { throw new Error(`${url}: window.__film.ready did not become true within ${timeout} ms (${e.message.split('\n')[0]})`); }
  const info = await page.evaluate(() => ({ dur: +window.__film.dur, fps: window.__film.fps || null, canvas: window.__film.canvas instanceof HTMLCanvasElement ? [window.__film.canvas.width, window.__film.canvas.height] : null }));
  if (!(info.dur > 0)) throw new Error(`${url}: window.__film.dur is ${info.dur}`);
  const cdp = await context.newCDPSession(page);
  // A film that exposes its canvas (the canvas kit) is read straight from it at the canvas's own size, whatever the
  // page draws around it; any other page is captured as the viewport.
  const fromCanvas = !!info.canvas && capture !== 'viewport';
  return {
    browser, context, page, cdp, url, dur: info.dur, fps: info.fps, size: fromCanvas ? info.canvas : size, fromCanvas,
    /** Render the frame at t seconds (awaits the page's renderAt, then two animation frames so the DOM has painted). */
    at: t => page.evaluate(async t => { await window.__film.renderAt(t); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); }, t),
    /** Capture the frame: the canvas's pixels, or the viewport. */
    shot: async (format = 'png', quality = 90) => {
      if (fromCanvas) {
        const url = await page.evaluate(([f, q]) => window.__film.canvas.toDataURL(f === 'jpeg' ? 'image/jpeg' : 'image/png', q / 100), [format, quality]);
        return Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
      }
      return Buffer.from((await cdp.send('Page.captureScreenshot', { format, quality: format === 'jpeg' ? quality : undefined, optimizeForSpeed: true, captureBeyondViewport: false })).data, 'base64');
    },
    close: async () => { await context.close().catch(() => {}); if (!shared) await browser.close().catch(() => {}); },
  };
}

/** Stills at the given seconds → files in `out`. `element` screenshots one selector with a transparent background. */
export async function renderFrames({ times, every, out, format = 'jpeg', quality = 90, element, ...open }) {
  const film = await openFilm(open);
  try {
    await mkdir(out, { recursive: true });
    const files = [];
    if (every > 0) { times = []; for (let t = 0; t < film.dur; t += every) times.push(+t.toFixed(3)); }
    for (const t of times) {
      await film.at(t);
      const f = join(out, `t${t.toFixed(2).padStart(6, '0')}.${format === 'png' || element ? 'png' : 'jpg'}`);
      if (element) {
        await film.page.addStyleTag({ content: 'html, body { background: transparent !important; }' });
        await film.page.locator(element).first().screenshot({ path: f, omitBackground: true });
      } else await writeFile(f, await film.shot(format, quality));
      files.push(f);
    }
    return files;
  } finally { await film.close(); }
}

/** The film's sound events (window.__film.events()) plus its shot table when it has one → JSON. */
export async function exportEvents({ out, ...open }) {
  const film = await openFilm(open);
  try {
    const ev = await film.page.evaluate(() => {
      const f = window.__film;
      const ev = typeof f.events === 'function' ? f.events() : { dur: f.dur };
      if (Array.isArray(f.shots)) ev.shots = f.shots.map(s => ({ kind: s.kind, start: +s.start.toFixed(2), dur: +s.dur.toFixed(2), segs: (s.segs || []).map(g => [+g.a.toFixed(2), +g.b.toFixed(2), +g.d.toFixed(2)]), vo: s.vo }));
      return ev;
    });
    if (out) { await mkdir(dirname(resolve(out)), { recursive: true }); await writeFile(out, JSON.stringify(ev, null, 1)); }
    return ev;
  } finally { await film.close(); }
}

/** The page's own mix (window.__film.wav(), the canvas kit) → a WAV file. Returns null when the page has no wav(). */
export async function pageMix({ out, ...open }) {
  const film = await openFilm(open);
  try {
    const has = await film.page.evaluate(() => typeof window.__film.wav === 'function');
    if (!has) return null;
    const b64 = await film.page.evaluate(async () => {
      const blob = await window.__film.wav();
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      return btoa(s);
    });
    const report = await film.page.evaluate(() => window.__film.report || null);
    await mkdir(dirname(resolve(out)), { recursive: true });
    await writeFile(out, Buffer.from(b64, 'base64'));
    return { out, report };
  } finally { await film.close(); }
}

function run(cmd, args) {
  return new Promise((res, rej) => {
    let err = '';
    const p = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    p.stderr.on('data', d => { err += d; });
    p.on('error', e => rej(e.code === 'ENOENT' ? new Error(`${cmd} not found: install ffmpeg and put it in PATH (or set --ffmpeg / $MOTIGEN_FFMPEG)`) : e));
    p.on('close', code => (code === 0 ? res() : rej(new Error(`${cmd} exited with ${code}\n${err.trim()}`))));
  });
}

const x264 = (fps, crf, preset) => ['-c:v', 'libx264', '-preset', preset, '-crf', String(crf), '-x264-params', 'aq-mode=3:aq-strength=0.9', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-g', String(fps * 2), '-movflags', '+faststart'];
// audio padded to the video's length, then cut to it: the video always decides the duration
const audioArgs = audio => (audio ? ['-i', audio, '-map', '0:v', '-map', '1:a', '-c:a', 'aac', '-b:a', '256k', '-ar', '48000', '-af', 'apad', '-shortest'] : []);

/** Frames [from, to) of one open film → x264 mp4 (with audio when given). */
export async function encodeRange(film, { from, to, fps, out, audio, crf = 14, preset = 'slow', ffmpeg = 'ffmpeg', onFrame }) {
  const args = ['-v', 'error', '-y', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'png', '-i', '-', ...audioArgs(audio), ...x264(fps, crf, preset), out];
  let err = '', failed = null;
  const ff = spawn(ffmpeg, args, { stdio: ['pipe', 'ignore', 'pipe'] });
  ff.stderr.on('data', d => { err += d; });
  ff.stdin.on('error', () => {}); // EPIPE after ffmpeg died: reported through `exit`
  const exit = new Promise((res, rej) => {
    ff.on('error', e => rej(e.code === 'ENOENT' ? new Error(`${ffmpeg} not found: install ffmpeg and put it in PATH (or set --ffmpeg / $MOTIGEN_FFMPEG)`) : e));
    ff.on('close', code => (code === 0 ? res() : rej(new Error(`ffmpeg exited with ${code}\n${err.trim()}`))));
  });
  exit.catch(e => { failed = e; });
  for (let i = from; i < to; i++) {
    if (failed) throw failed;
    await film.at(i / fps);
    const buf = await film.shot('png');
    if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
    onFrame?.(i - from + 1);
  }
  ff.stdin.end();
  await exit;
}

/**
 * Render the whole film (or `range` = [a, b] seconds) to `out`.
 * @returns {Promise<{ out: string, frames: number, fps: number, seconds: number }>}
 */
export async function renderVideo({ out, fps, audio, crf = 14, preset = 'slow', range, workers = 1, ffmpeg = 'ffmpeg', onProgress, ...open }) {
  const t0 = Date.now();
  out = resolve(out);
  const browser = await launch({ channel: open.channel, gpu: open.gpu });
  const films = [];
  try {
    films.push(await openFilm({ ...open, browser }));
    fps = fps || films[0].fps || 30;
    const dur = films[0].dur;
    const [a, b] = range || [0, dur];
    const first = Math.max(0, Math.round(a * fps)), last = Math.min(Math.round(b * fps), Math.round(dur * fps));
    const n = last - first;
    if (n <= 0) throw new Error(`nothing to render: range ${a}-${b} s of a ${dur} s film`);
    workers = Math.max(1, Math.min(workers | 0 || 1, n));
    await mkdir(dirname(out), { recursive: true });
    if (workers === 1) {
      await encodeRange(films[0], { from: first, to: last, fps, out, audio, crf, preset, ffmpeg, onFrame: i => onProgress?.(i, n) });
    } else {
      const chunk = Math.ceil(n / workers);
      while (films.length < workers) films.push(await openFilm({ ...open, browser }));
      const done = new Array(workers).fill(0), parts = [];
      await Promise.all(films.map((film, w) => {
        const from = first + w * chunk, to = Math.min(last, from + chunk);
        if (from >= to) return null;
        const part = `${out}.part${String(w).padStart(2, '0')}.mp4`;
        parts.push(part);
        return encodeRange(film, { from, to, fps, out: part, crf, preset, ffmpeg, onFrame: i => { done[w] = i; onProgress?.(done.reduce((x, y) => x + y, 0), n); } });
      }));
      const list = `${out}.parts.txt`;
      await writeFile(list, parts.map(p => `file '${p.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n') + '\n');
      await run(ffmpeg, ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, ...audioArgs(audio), '-c:v', 'copy', '-movflags', '+faststart', out]);
      await Promise.all([list, ...parts].map(f => rm(f, { force: true })));
    }
    return { out, frames: n, fps, seconds: (Date.now() - t0) / 1000 };
  } finally {
    for (const f of films) await f.close();
    await browser.close().catch(() => {});
  }
}
