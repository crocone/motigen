// Frame-to-frame stability: render a few consecutive frames at chosen moments and count the pixels that change
// between them. A hold must give zero; a slow pan gives a steady, small, moving change; "jitter" is a small change
// that comes and goes in a region that should be still (text re-rasterised at sub-pixel offsets, line boil,
// anything that depends on wall-clock time). The difference rasters come from ffmpeg, so no image library is needed.
import { spawn } from 'node:child_process';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { openSync, readSync, closeSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { openFilm } from './render.js';

/** The width of a PNG file, from its header. */
function pngWidth(file) {
  const fd = openSync(file, 'r'), b = Buffer.alloc(24);
  try { readSync(fd, b, 0, 24, 0); } finally { closeSync(fd); }
  return b.readUInt32BE(16);
}

/** Changed pixels between two PNG files: { pct, changed, box: [x0, y0, x1, y1] | null }. */
export async function diffPng(a, b, { threshold = 8, ffmpeg = process.env.MOTIGEN_FFMPEG || 'ffmpeg' } = {}) {
  const raw = await new Promise((res, rej) => {
    const chunks = []; let err = '';
    const p = spawn(ffmpeg, ['-v', 'error', '-i', a, '-i', b, '-lavfi', '[0:v][1:v]blend=all_mode=difference,format=gray', '-f', 'rawvideo', '-'], { stdio: ['ignore', 'pipe', 'pipe'] });
    p.stdout.on('data', d => chunks.push(d)); p.stderr.on('data', d => { err += d; });
    p.on('error', e => rej(e.code === 'ENOENT' ? new Error(`${ffmpeg} not found: install ffmpeg and put it in PATH (or set --ffmpeg / $MOTIGEN_FFMPEG)`) : e));
    p.on('close', code => (code === 0 ? res(Buffer.concat(chunks)) : rej(new Error(`ffmpeg could not diff ${a} and ${b}: ${err.trim()}`))));
  });
  return countDiff(raw, threshold, pngWidth(a));
}

/** The size of a PNG from its header. */
function pngSize(buf) { return [buf.readUInt32BE(16), buf.readUInt32BE(20)]; }

export function countDiff(gray, threshold, width) {
  const n = gray.length, w = width || Math.round(Math.sqrt(n * 16 / 9)) || 1;
  let changed = 0, x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (let i = 0; i < n; i++) {
    if (gray[i] > threshold) { changed++; const x = i % w, y = (i / w) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  return { pct: +(100 * changed / Math.max(1, n)).toFixed(3), changed, box: changed ? [x0, y0, x1, y1] : null };
}

/**
 * @param {object} o
 * @param {number[]} [o.times]   seconds to sample
 * @param {number} [o.every]     sample every N seconds instead
 * @param {number} [o.frames]    consecutive frames per sample (default 3)
 * @param {boolean} [o.replay]   after all samples, render each moment again, last to first, and compare with its first
 *                               render: a frame must be a pure function of t, whatever was rendered before it
 * @param {number} [o.replayThreshold]  per-pixel difference (0-255) that counts in that comparison, default 40
 * @param {string} o.out         folder for the PNGs
 * @returns rows [{ t, pairs: [{ from, to, pct, box }], verdict, replay?: { pct, box } }]
 */
export async function stability({ times = [], every = 0, frames = 3, replay = false, replayThreshold = 40, out, threshold = 8, ffmpeg = process.env.MOTIGEN_FFMPEG || 'ffmpeg', fps: fpsOpt, ...open }) {
  const film = await openFilm(open);
  try {
    const fps = fpsOpt || film.fps || 30;
    if (every > 0) { times = []; for (let t = 0; t < film.dur; t += every) times.push(+t.toFixed(3)); }
    await mkdir(out, { recursive: true });
    const rows = [];
    for (const t of times) {
      const files = [];
      let width = null;
      for (let k = 0; k < frames; k++) {
        const tk = Math.min(t + k / fps, film.dur - 1e-6);
        await film.at(tk);
        const buf = await film.shot('png');
        width ||= pngSize(buf)[0];
        const f = join(out, `t${t.toFixed(2).padStart(6, '0')}-${k}.png`);
        await writeFile(f, buf);
        files.push(f);
      }
      const pairs = [];
      for (let k = 1; k < files.length; k++) {
        // the difference raster (counted here) and, when anything changed, a picture of it with the changes
        // brightened 16×, so the eye finds what moved
        const diffFile = files[k].replace(/\.png$/, '-diff.png');
        const raw = await new Promise((res, rej) => {
          const chunks = []; let err = '';
          const p = spawn(ffmpeg, ['-v', 'error', '-y', '-i', files[k - 1], '-i', files[k], '-filter_complex', "[0:v][1:v]blend=all_mode=difference,format=gray,split[a][b];[b]lutyuv=y='min(255,val*16)'[vis]", '-map', '[a]', '-f', 'rawvideo', '-', '-map', '[vis]', '-frames:v', '1', diffFile], { stdio: ['ignore', 'pipe', 'pipe'] });
          p.stdout.on('data', d => chunks.push(d)); p.stderr.on('data', d => { err += d; });
          p.on('error', e => rej(e.code === 'ENOENT' ? new Error(`${ffmpeg} not found: install ffmpeg and put it in PATH (or set --ffmpeg / $MOTIGEN_FFMPEG)`) : e));
          p.on('close', code => (code === 0 ? res(Buffer.concat(chunks)) : rej(new Error(`ffmpeg could not diff frames: ${err.trim()}`))));
        });
        const d = countDiff(raw, threshold, width);
        if (!d.changed) await rm(diffFile, { force: true });
        pairs.push({ from: +(t + (k - 1) / fps).toFixed(3), to: +(t + k / fps).toFixed(3), ...d, diff: d.changed ? diffFile : null });
      }
      const max = Math.max(...pairs.map(p => p.pct));
      // still: nothing changed. small: under 1 % of the frame changed (a cursor, a caret, a spinner, or jitter: look
      // at the -diff.png). motion: more than that.
      const verdict = max === 0 ? 'still' : max < 1 ? 'small' : 'motion';
      rows.push({ t, pairs, verdict, files });
    }
    if (replay) {
      for (const row of [...rows].reverse()) {
        await film.at(Math.min(row.t, film.dur - 1e-6));
        const f = join(out, `t${row.t.toFixed(2).padStart(6, '0')}-replay.png`);
        await writeFile(f, await film.shot('png'));
        // a replay is compared at a coarser threshold: edge anti-aliasing of an image or a logo may differ by a few
        // levels between two renders (about 20 of 255), content that is missing or moved differs by a hundred or more
        row.replay = await diffPng(row.files[0], f, { threshold: replayThreshold, ffmpeg });
        if (!row.replay.changed) await rm(f, { force: true });
        else row.verdict = 'unstable';
      }
    }
    return rows;
  } finally { await film.close(); }
}

export const resolveOut = (project, out) => resolve(project, out || 'stability');
