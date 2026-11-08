// The scenes player in a real browser, over examples/scenes-gallery (every scene type once): for each theme and
// format nothing may stick out of the stage or be clipped, the player must report no warnings (a scene that does
// not finish moving before it ends), and a frame must be a pure function of t: rendering the same moments again,
// in another order, gives identical pixels.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { launch } from '../src/browser.js';
import { openFilm } from '../src/render.js';
import { diffPng } from '../src/stability.js';

const project = resolve('examples/scenes-gallery');
let skip = false;
try { const b = await launch(); await b.close(); } catch { skip = 'no Chromium available'; }

// runs in the page: what sticks out of the stage, or is cut off, in the scene that is on screen
function layoutProblems([W, H]) {
  const out = [];
  const sec = [...document.querySelectorAll('#scenes > section')].find(s => getComputedStyle(s).display !== 'none');
  if (!sec) return ['no visible scene'];
  for (const e of sec.querySelectorAll('*')) {
    if (e.closest('.body, svg')) continue;                      // a zoomed picture is cropped on purpose
    const r = e.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    if (r.left < -2 || r.top < -2 || r.right > W + 2 || r.bottom > H + 2) out.push(`${e.className || e.tagName} sticks out of the stage: ${[r.left, r.top, r.right, r.bottom].map(Math.round)}`);
    const cs = getComputedStyle(e);
    if (cs.overflow !== 'visible' && !e.matches('.mask, .win') && (e.scrollWidth > e.clientWidth + 3 || e.scrollHeight > e.clientHeight + 3)) out.push(`${e.className || e.tagName} clips its content (${e.scrollWidth}×${e.scrollHeight} in ${e.clientWidth}×${e.clientHeight})`);
  }
  return out;
}

const SIZES = { h: [1920, 1080], v: [1080, 1920] };

for (const fmt of ['h', 'v']) for (const theme of ['dark', 'light', 'paper']) {
  test(`scenes gallery ${fmt}/${theme}: nothing sticks out, nothing is cut off, no warnings`, { skip, timeout: 120000 }, async () => {
    const logs = [];
    const film = await openFilm({ project, query: `fmt=${fmt}&theme=${theme}`, size: SIZES[fmt], log: s => logs.push(s) });
    try {
      const scenes = await film.page.evaluate(() => window.__film.scenes);
      assert.equal(scenes.length, 15);
      const problems = [];
      for (const s of scenes) {
        await film.at(s.start + s.dur - 0.05);                  // the scene as it ends: everything revealed
        for (const p of await film.page.evaluate(layoutProblems, SIZES[fmt])) problems.push(`scene ${s.i + 1} (${s.type}): ${p}`);
      }
      assert.deepEqual(problems, []);
      assert.deepEqual(await film.page.evaluate(() => window.__film.warnings), []);
      assert.deepEqual(logs, []);
    } finally { await film.close(); }
  });
}

for (const [fmt, theme] of [['h', 'dark'], ['v', 'paper']]) {
  test(`scenes gallery ${fmt}/${theme}: a frame is a pure function of t (a second render, in reverse order, is identical)`, { skip, timeout: 240000 }, async () => {
    const dir = await mkdtemp(join(tmpdir(), 'motigen-replay-'));
    const film = await openFilm({ project, query: `fmt=${fmt}&theme=${theme}`, size: SIZES[fmt] });
    try {
      const scenes = await film.page.evaluate(() => window.__film.scenes);
      const times = scenes.flatMap(s => [s.start + s.dur * 0.5, s.start + s.dur - 0.05]);
      const first = [];
      for (const [i, t] of times.entries()) { await film.at(t); const f = join(dir, `a${i}.png`); await writeFile(f, await film.shot('png')); first.push(f); }
      const bad = [];
      for (const i of [...times.keys()].reverse()) {
        await film.at(times[i]); const f = join(dir, `b${i}.png`); await writeFile(f, await film.shot('png'));
        const d = await diffPng(first[i], f, { threshold: 40 });   // as in `stability --replay`: not edge anti-aliasing noise
        if (d.changed) bad.push(`t=${times[i].toFixed(2)}: ${d.pct}% changed at ${d.box}`);
      }
      assert.deepEqual(bad, []);
    } finally { await film.close(); await rm(dir, { recursive: true, force: true }); }
  });
}
