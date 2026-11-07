// A project is a folder with the film page and, optionally, motigen.json:
// {
//   "page": "film.html",            the page that registers window.__film
//   "fps": 30,                      optional: the page's window.__film.fps otherwise, else 30
//   "size": [1920, 1080],           viewport
//   "query": "",                    query string for the page
//   "audio": "audio",               folder with lines.txt, vo/, bed.wav, sfx/, events.json, mix.wav
//   "out": "out/<name>.mp4",
//   "formats": { "h": { "size": [1920, 1080], "query": "fmt=h", "out": "out/<name>-16x9.mp4" },
//                "v": { "size": [1080, 1920], "query": "fmt=v", "out": "out/<name>-9x16.mp4" } }
// }
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

export async function loadProject(dir = '.') {
  const root = resolve(dir);
  const file = join(root, 'motigen.json');
  let cfg = {};
  try { cfg = JSON.parse(await readFile(file, 'utf8')); }
  catch (e) { if (e.code !== 'ENOENT') throw new Error(`${file}: ${e.message}`); }
  const name = basename(root);
  // fps stays null unless the config sets it: the film's own window.__film.fps wins then, and 30 is the last resort
  const p = { root, file, name, page: 'film.html', fps: null, size: [1920, 1080], query: '', audio: 'audio', out: `out/${name}.mp4`, formats: null, ...cfg };
  if (!existsSync(join(root, p.page))) throw new Error(`${join(root, p.page)} not found (set "page" in motigen.json, or -p)`);
  return p;
}

/** The effective page/size/query/out for one named format (or the project defaults when name is empty). */
export function resolveFormat(project, name) {
  if (!name) return { page: project.page, size: project.size, query: project.query, out: project.out, fps: project.fps };
  const f = project.formats?.[name];
  if (!f) throw new Error(`format "${name}" is not in ${project.file} (formats: ${Object.keys(project.formats || {}).join(', ') || 'none'})`);
  const base = project.out.replace(/\.mp4$/i, '');
  return { page: f.page || project.page, size: f.size || project.size, query: f.query ?? project.query, out: f.out || `${base}-${name}.mp4`, fps: f.fps || project.fps };
}

/** audio/mix.wav when it exists, else null. */
export function defaultAudio(project) {
  const f = join(project.root, project.audio, 'mix.wav');
  return existsSync(f) ? f : null;
}
