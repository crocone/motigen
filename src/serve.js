// Serves a project folder to the film page. Two roots: the project at `/` and the package runtime at `/_motigen/`
// (the guide player, the preview UI, and `vendor/<name>/…` for a few npm packages: xterm and the Geist fonts).
// Headless rendering routes a fake secure origin (https://motigen.local) through Playwright, so fonts,
// OffscreenCanvas and WebCodecs work with no server process; `motigen preview` runs a plain http server with the
// same resolver.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { readFile, stat } from 'node:fs/promises';
import { createReadStream, existsSync } from 'node:fs';
import { join, extname, resolve, sep, dirname } from 'node:path';
import http from 'node:http';

export const ORIGIN = 'https://motigen.local';
export const RUNTIME_ROOT = resolve(fileURLToPath(new URL('../runtime/', import.meta.url)));
const require = createRequire(import.meta.url);

export const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.map': 'application/json', '.wasm': 'application/wasm',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.tm': 'text/plain', '.out': 'application/octet-stream',
};

// npm packages exposed under /_motigen/vendor/<name>/<path inside the package>
export const VENDOR = { xterm: '@xterm/xterm', 'geist-sans': '@fontsource/geist-sans', 'geist-mono': '@fontsource/geist-mono', mediabunny: 'mediabunny' };
// browser-safe modules of this package, served at /_motigen/lib/<path under src/> (the loudness code, say)
export const LIB_ROOT = resolve(RUNTIME_ROOT, '..', 'src');

const pkgRoots = new Map();
function packageRoot(name) {
  if (pkgRoots.has(name)) return pkgRoots.get(name);
  let root = null;
  try { root = dirname(require.resolve(`${name}/package.json`)); } catch { /* "exports" may hide package.json: walk node_modules */ }
  if (!root) {
    for (let dir = resolve(RUNTIME_ROOT, '..'); ; dir = dirname(dir)) {
      const cand = join(dir, 'node_modules', name);
      if (existsSync(join(cand, 'package.json'))) { root = cand; break; }
      if (dirname(dir) === dir) break;
    }
  }
  pkgRoots.set(name, root);
  return root;
}

const inside = (root, file) => file === root || file.startsWith(root.endsWith(sep) ? root : root + sep);

/** pathname → { file, type } | null (unknown vendor package, or a path that escapes its root). */
export function createResolver(projectRoot) {
  projectRoot = resolve(projectRoot);
  return function resolvePath(pathname) {
    let p;
    try { p = decodeURIComponent(pathname); } catch { return null; }
    p = p.replace(/\\/g, '/').replace(/^\/+/, '');
    if (p === '' || p.endsWith('/')) p += 'index.html';
    let root = projectRoot, rel = p;
    if (p.startsWith('_motigen/vendor/')) {
      const [name, ...rest] = p.slice('_motigen/vendor/'.length).split('/');
      root = VENDOR[name] ? packageRoot(VENDOR[name]) : null;
      if (!root) return null;
      rel = rest.join('/');
    } else if (p.startsWith('_motigen/lib/')) {
      root = LIB_ROOT; rel = p.slice('_motigen/lib/'.length);
    } else if (p.startsWith('_motigen/')) {
      root = RUNTIME_ROOT; rel = p.slice('_motigen/'.length);
    }
    const file = resolve(root, rel);
    if (!inside(root, file)) return null;
    return { file, type: TYPES[extname(file).toLowerCase()] || 'application/octet-stream' };
  };
}

/** Route https://motigen.local/** of a Playwright context to the project (and the runtime). */
export async function routeProject(context, projectRoot) {
  const resolvePath = createResolver(projectRoot);
  await context.route(`${ORIGIN}/**`, async route => {
    const { pathname } = new URL(route.request().url());
    const r = resolvePath(pathname);
    if (!r) return route.fulfill({ status: 404, body: 'not found: ' + pathname });
    try {
      const body = await readFile(r.file);
      return route.fulfill({ status: 200, body, headers: { 'content-type': r.type, 'cache-control': 'no-store' } });
    } catch (e) {
      if (e.code === 'ENOENT' || e.code === 'EISDIR' || e.code === 'ENOTDIR') return route.fulfill({ status: 404, body: 'missing: ' + pathname });
      throw e;
    }
  });
  return resolvePath;
}

/**
 * A plain http server over the same resolver. `api(req, res, url)` handles /_motigen/api/* (preview uses it);
 * return true from it when the request was answered.
 */
export function createServer(projectRoot, { api } = {}) {
  const resolvePath = createResolver(projectRoot);
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (api && url.pathname.startsWith('/_motigen/api/') && (await api(req, res, url))) return;
      const r = resolvePath(url.pathname);
      if (!r) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('not found'); }
      const st = await stat(r.file).catch(() => null);
      if (st?.isDirectory()) { res.writeHead(302, { location: url.pathname + '/' + url.search }); return res.end(); }
      if (!st) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('missing: ' + url.pathname); }
      res.writeHead(200, { 'content-type': r.type, 'content-length': st.size, 'cache-control': 'no-store' });
      if (req.method === 'HEAD') return res.end();
      createReadStream(r.file).pipe(res);
    } catch (e) {
      res.writeHead(500, { 'content-type': 'text/plain' }); res.end(String(e?.message || e));
    }
  });
}
