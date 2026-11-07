// A canvas film: paper, letterpress titles, an ink thread, a card, tally marks, a pencil. Every value on screen is
// a pure function of the frame number f (30 fps), so any frame renders at any time. Drawing: /_motigen/canvas/ink.js;
// stage, cards, mix and the window.__film contract: /_motigen/canvas/kit.js. Both formats (?fmt=h 16:9, ?fmt=v 9:16)
// come from LAYOUTS below; `motigen build` renders every format in motigen.json.
import * as K from '/_motigen/canvas/ink.js';
import * as kit from '/_motigen/canvas/kit.js';
const { C, clamp, prog, ease } = K;
const { FMT, W, H, bt, superLines, stampLine, emphasis, ruleCard, drawPencil, label, tryJson } = kit;

const DUR = 12;                           // seconds
let VO = null;                            // audio/vo/vo.json when `motigen vo` has run
async function load() { VO = await tryJson('audio/vo/vo.json'); return { dur: DUR }; }

// ================================================================================================ layout
const LAYOUTS = {
  h: { folio: { x: 72, y: 56, fs: 22 }, title: { x: 96, y: 240, size: 112, maxW: 1100 }, thread: [[120, 470], [360, 560], [700, 520], [1040, 640], [1180, 700]],
       card: { x: 1180, y: 600, w: 620, h: 130 }, tally: { x: 120, y: 820 }, title2: { x: 96, y: 300, size: 112, maxW: 1200 }, under: { x1: 96, x2: 1000, y: 470 },
       end: { x: W / 2, y: 560, size: 150 }, cmd: { x: W / 2, y: 660, size: 34 }, note: { x: W - 72, y: H - 36, fs: 20 } },
  v: { folio: { x: 70, y: 300, fs: 22 }, title: { x: 72, y: 430, size: 92, maxW: 940 }, thread: [[90, 760], [300, 900], [600, 860], [860, 960], [920, 1040]],
       card: { x: 110, y: 1100, w: 860, h: 130 }, tally: { x: 100, y: 1360 }, title2: { x: 72, y: 520, size: 92, maxW: 940 }, under: { x1: 72, x2: 940, y: 700 },
       end: { x: W / 2, y: 900, size: 130 }, cmd: { x: W / 2, y: 990, size: 32 }, note: { x: W - 70, y: 1440, fs: 20 } },
};
const L = LAYOUTS[FMT];
const path = K.splinePts(L.thread, 24);

// ================================================================================================ frames
function render(c, f) {
  const b = bt(f);
  K.text(c, 'motigen · canvas', L.folio.x, L.folio.y, { kind: 'mono', size: L.folio.fs, weight: 500, color: C.muted, track: 0.08 });

  // 1. the title stamps in, holds, lifts off
  superLines(c, [['Video as code.', 'heavy'], ['Every frame is a function of t.', 'serif']], L.title.x, L.title.y, f, 6, 150, { size: L.title.size, maxW: L.title.maxW, lift: true });

  // 2. the thread runs from the title to the card; the card drops in and its rule gets highlighted
  if (f >= 20 && f < 150) {
    const to = ease.inOut(prog(f, 20, 80));
    K.thread(c, path, { to, w: 8, color: C.orange });
    if (to < 1) { const p = K.pointAt(path, to); K.needle(c, p.x, p.y, p.a, { boilT: b }); }
  }
  if (f >= 60 && f < 150) {
    ruleCard(c, L.card, f - 60, f, 'RULE · 01', 'No Date.now(). Frames depend on t only.', { hl: prog(f, 90, 112), hlText: 't only', seed: 41 });
  }
  // 3. tally marks count the renders: the same frame every time
  if (f >= 100 && f < 150) K.tally(c, L.tally.x, L.tally.y, Math.min(5, 1 + Math.floor((f - 100) / 8)), { boilT: b });

  // 4. the second title, underlined by the pencil (it dips before it writes)
  superLines(c, [['Render anywhere.', 'heavy'], ['Same frames, every time.', 'serif']], L.title2.x, L.title2.y, f, 156, 276, { size: L.title2.size, maxW: L.title2.maxW, lift: true });
  if (f >= 190 && f < 276) {
    const p = ease.inOut(prog(f, 200, 250));
    K.underline(c, L.under.x1, L.under.x1 + (L.under.x2 - L.under.x1) * p, L.under.y, { p: 1, boilT: b, w: 5, color: C.orange });
    const dip = f < 200 ? 10 * Math.sin(Math.PI * prog(f, 190, 200)) : 0;       // anticipation
    const lift = f >= 250 ? 60 * ease.out(prog(f, 250, 262)) : 0;
    drawPencil(c, L.under.x1 + (L.under.x2 - L.under.x1) * p, L.under.y + dip - lift, -32, b);
  }

  // 5. the end: the name stamps in with emphasis marks, the command under it
  if (f >= 280) {
    const age = f - 280;
    const w = K.measure(c, 'motigen', { kind: 'heavy', size: L.end.size, track: -0.055 });
    stampLine(c, 'motigen', L.end.x - w / 2, L.end.y, 'heavy', L.end.size, age);
    emphasis(c, L.end.x + w / 2 + 24, L.end.y - L.end.size * 0.7, -28, age, 1.3, 9);
    if (age >= 8) K.text(c, 'npx motigen init canvas my-film', L.cmd.x, L.cmd.y, { kind: 'mono', size: L.cmd.size, weight: 500, color: C.muted, align: 'center', alpha: clamp((age - 8) / 6) });
  }
  label(c, 'Illustrative example', L.note);
}

// ================================================================================================ sound
// Voice cues: the first word of a line lands on the frame. Lines come from audio/lines.txt via `motigen vo`.
const VO_CUES = { L01: 10, L02: 160, L03: 284 };
const mixSpec = () => ({
  music: null,                                  // { file: 'audio/bed.wav', lufs: -18.5 } when you have a bed
  duck: () => -8,
  vo: { json: VO, cues: VO_CUES },
  sfx: [],                                      // [[id, frame, dB]] from audio/sfx/sfx.json
});

await kit.boot({ id: 'hello-canvas', load, render, mix: mixSpec });
