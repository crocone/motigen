# The canvas template: ink.js and kit.js

`motigen init canvas <dir>` makes a film on a 2D canvas. `film.js` imports two modules served by motigen:

```js
import * as K from '/_motigen/canvas/ink.js';     // drawing primitives
import * as kit from '/_motigen/canvas/kit.js';   // the stage, cards, the mix, the contract
await kit.boot({ id, load, render, mix, logo, fonts, paper, maxDur });
```

`load()` returns `{ dur }` after loading what the film needs; `render(ctx, f)` draws frame `f` (30 fps, so
`f = t · 30`) and must be a pure function of `f`; `mix()` returns the sound spec. `boot` loads the fonts (Geist from
the package by default), the optional logo, the sound library (`audio/sfx/sfx.json`), registers `window.__film` and
draws frame 0. Formats: `?fmt=h` is 1920×1080, `?fmt=v` is 1080×1920 (`kit.FMT`, `kit.W`, `kit.H`); keep one
`LAYOUTS` table per format.

## ink.js

Everything is a pure function of its inputs; strokes wobble by a seed, so a frame is the same every time.

- Math: `clamp`, `lerp`, `prog(t, a, b)`, `ease.{out, inOut, outBack, …}`, `keys(t, ks)`, `mulberry32(seed)`, `noise1`.
- Paths: `linePts`, `bezierPts`, `splinePts(pts, perSeg, tension)`, `ellipsePts`, `resample`, `pointAt(pts, u)` → `{x, y, a}`, `pathLength`.
- Strokes: `inkStroke(ctx, pts, {w, seed, boilT, taper, alpha, color, wobble})`, `inkLine`, `inkRect`, `inkEllipse`, `hatch`.
- The thread: `thread(ctx, pts, {to, w, color})`, `needle(ctx, x, y, a)`.
- Paper and marks: `paperTexture(w, h, base, seed)`, `card(ctx, x, y, w, h, {r, seed, boilT, lw, shadow})`, `underline`, `highlight(ctx, x, y, w, h, {p, color, seed})`, `checkBadge`, `tally(ctx, x, y, n)`.
- Type: `text(ctx, str, x, y, {kind: 'heavy'|'sans'|'serif'|'mono'|'hand', size, weight, color, align, track, alpha, spread})`, `measure`, `typed(str, t, cps)`, `typedTimes`, `stampWords`.
- Images and camera: `drawImage`, `camera(ctx, W, H, {cx, cy, z, rot})`.
- Colours `C` (paper, ink, muted, orange, yellow, blue, card, …) and fonts `F`.

## kit.js

- Stage: `bg(ctx, color)`, `label(ctx, text, {x, y, fs})`, `superLines(ctx, lines, x, y, f, f0, f1, {size, maxW, lift})` (letterpress landing, optional lift-off), `stampLine`, `stampScale(age)`, `fitSize`, `emphasis(ctx, x, y, angle, age, size, seed)`, `deckle`.
- Images: `loadImg`, `tryImg`, `loadSvg`, `tryJson`, `feather(img, px)` (no rectangle edge), `inkLayer` / `drawInk` (art as ink on the paper, whatever its background), `warpImage(ctx, img, w, h, quad)`.
- Logo: `drawLogo(ctx, x, y, w)`, `stampLogo(ctx, x, y, w, age)`, `logoH(w)` — when `boot({ logo })` was given an image.
- Geometry: `place(ctx, {cx, cy, s, rot})`, `mapPt`, `lerpT`, `toScreen`, `applyCam`, `camPt`, `keyPose(f, ks)`.
- Props and cards: `drawPencil(ctx, x, y, angle, boilT)`, `successChip`, `ruleCard(ctx, rect, age, f, label, body, {hl, hlText})`, `wordGroups`.
- Sound: `mix(spec)` (below), `keyClicks`, `enterClick`; `boot` exposes `__film.buildMix()`, `__film.wav()` (what `motigen mix` saves when `"mix": {"engine": "page"}`), `__film.exportMP4()` (in-browser, WebCodecs through mediabunny) and `__film.events()` (derived from the spec: voice cues and effects on the output clock).

### The mix spec

```js
const mixSpec = () => ({
  music: { file: 'audio/bed.wav', lufs: -18.5 },     // levelled before ducking; null for none
  duck: t => (t < 14 ? -6 : -10),                     // duck depth under the voice at that time
  vo: { json: VO, cues: { L01: 10, L02: { end: 261 }, L03: { f: 280, db: 4 } } },   // frames: first word on it, or last sound ends on it
  sfx: [['FX4', 130, -8, { align: 'enter', rate: 1, maxDur: 1, fadeIn: 0, fadeOut: 0, at0: false }]],
  extra: async ({ ac, sfxBus, voBus, decode, lib }) => {},   // film-specific sound
  target: { lufs: -14, dbtp: -1 },
});
```

`VO` is `audio/vo/vo.json` from `motigen vo` (or the older `{ voices: { name: { lines } } }` shape); `speechStart`
and `speechEnd` in it put the first word on the frame. The effects library `audio/sfx/sfx.json` maps an id to
`{ file, hit, dur, keys?, enter? }`, where `hit` is the transient's position inside the file so it lands on the cue.
