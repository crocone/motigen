// `motigen preview`: an http server over the project (same resolver as the headless route) with a small API the
// preview UI (/_motigen/preview/) uses: project info, events export, and render jobs with progress.
import { spawn } from 'node:child_process';
import { relative, resolve, join } from 'node:path';
import { createServer } from './serve.js';
import { loadProject, resolveFormat, defaultAudio } from './project.js';
import { renderVideo, exportEvents } from './render.js';

export async function preview({ project, port = 4310, open = false, channel, gpu, ffmpeg }) {
  const jobs = new Map();
  let nextId = 1;
  const json = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); return true; };
  const body = req => new Promise(r => { let s = ''; req.on('data', d => { s += d; }); req.on('end', () => r(s ? JSON.parse(s) : {})); });
  const openOpts = (cfg, f) => ({ project: cfg.root, page: f.page, query: f.query, size: f.size, channel, gpu });

  const api = async (req, res, url) => {
    const p = url.pathname.slice('/_motigen/api/'.length);
    if (p === 'project') {
      const cfg = await loadProject(project.root); // re-read: motigen.json may have changed
      const formats = cfg.formats ? Object.fromEntries(Object.keys(cfg.formats).map(k => [k, resolveFormat(cfg, k)])) : null;
      return json(res, 200, { name: cfg.name, page: cfg.page, fps: cfg.fps, size: cfg.size, query: cfg.query, out: cfg.out, audio: cfg.audio, mix: defaultAudio(cfg) ? `/${cfg.audio}/mix.wav` : null, formats });
    }
    if (p === 'render' && req.method === 'POST') {
      const b = await body(req);
      const cfg = await loadProject(project.root);
      const f = resolveFormat(cfg, b.fmt || '');
      const id = nextId++;
      const job = { id, fmt: b.fmt || '', i: 0, n: 0, done: false, error: null, out: null, started: Date.now() };
      jobs.set(id, job);
      const audio = b.audio === false ? null : defaultAudio(cfg);
      renderVideo({ ...openOpts(cfg, f), out: resolve(cfg.root, f.out), fps: f.fps, audio, workers: b.workers || 2, ffmpeg, onProgress: (i, n) => { job.i = i; job.n = n; } })
        .then(r => { job.done = true; job.out = relative(cfg.root, r.out).replace(/\\/g, '/'); job.seconds = r.seconds; job.audio = !!audio; },
          e => { job.done = true; job.error = e.message; });
      return json(res, 200, { id });
    }
    if (p.startsWith('jobs/')) { const j = jobs.get(+p.slice(5)); return json(res, j ? 200 : 404, j || { error: 'no such job' }); }
    if (p === 'events' && req.method === 'POST') {
      const b = await body(req);
      const cfg = await loadProject(project.root);
      const f = resolveFormat(cfg, b.fmt || '');
      const out = resolve(cfg.root, join(cfg.audio, 'events.json'));
      try { const ev = await exportEvents({ ...openOpts(cfg, f), out }); return json(res, 200, { out: relative(cfg.root, out).replace(/\\/g, '/'), dur: ev.dur, vo: ev.vo?.length ?? 0, clicks: ev.clicks?.length ?? 0, keys: ev.keys?.length ?? 0 }); }
      catch (e) { return json(res, 500, { error: e.message }); }
    }
    return false;
  };

  const server = createServer(project.root, { api });
  await new Promise((ok, no) => server.once('error', no).listen(port, '127.0.0.1', ok));
  const url = `http://127.0.0.1:${port}/_motigen/preview/`;
  console.log(`motigen preview · ${project.name}\n  ${url}\n  film page: http://127.0.0.1:${port}/${project.page}${project.query ? '?' + project.query : ''}`);
  if (open) openBrowser(url);
  await new Promise(() => {}); // until Ctrl+C
}

function openBrowser(url) {
  const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try { spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref(); } catch { /* the url is printed anyway */ }
}
