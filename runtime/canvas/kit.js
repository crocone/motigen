// The canvas film engine: a film is one module that draws its frames on a 2D canvas and lists its sound cues;
// this module gives it the stage (paper, type, marks, props, cards), the camera helpers, the offline mix and the
// window.__film contract. Drawing primitives live in ./ink.js. Nothing here is specific to one brand: load your own
// logo through boot({ logo }) and keep your series' rules in your own STYLE.md.
//
//   import * as K from '/_motigen/canvas/ink.js';
//   import * as kit from '/_motigen/canvas/kit.js';
//   await kit.boot({ id, load, render, mix, logo?, fonts? });
import * as K from './ink.js';
import { measure as loudness, normalize } from '../lib/audio/loudness.js';
const { C, clamp, lerp, ease } = K;

export const FPS = 30, SR = 48000, D2R = Math.PI / 180;
export const Q = new URLSearchParams(location.search);
export const FMT = Q.get('fmt') === 'v' ? 'v' : 'h';
export const W = +Q.get('w') || (FMT === 'h' ? 1920 : 1080), H = +Q.get('h') || (FMT === 'h' ? 1080 : 1920);
export const canvas = document.getElementById('film');
canvas.width = W; canvas.height = H;
export const ctx = canvas.getContext('2d', { alpha: false });
export const off = (w, h) => { const c = new OffscreenCanvas(w, h); return [c, c.getContext('2d')]; };

// Line boil (hand-drawn strokes re-seeded 12 times a second) reads as jitter on video, so it is off: every stroke
// keeps one seed for the whole film and a still shot repeats the same pixels. ?boil=1 turns it on for experiments.
export const BOIL = Q.get('boil') === '1';
export const bt = f => (BOIL ? Math.floor(f / 2) : 0);
export const on2 = f => Math.floor(f / 2) * 2;               // quantise a frame to twos
export const dbg = d => Math.pow(10, d / 20);

// ================================================================================================ loading
export const loadImg = async src => { const r = await fetch(src); if (!r.ok) throw new Error(src + ' ' + r.status); const b = await r.blob(); return createImageBitmap(b); };
export const tryImg = async (...srcs) => { for (const s of srcs) { try { return await loadImg(s); } catch { /* next */ } } return null; };
export const loadSvg = src => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error(src)); i.src = src; });
export const tryJson = async (u, fb = null) => { try { const r = await fetch(u); if (!r.ok) throw 0; return await r.json(); } catch { return fb; } };
/** Shared assets (filled by boot): logo (ImageBitmap | null), sfx (the sound library). */
export const A = { logo: null, sfx: {} };
const V = '/_motigen/vendor';
/** The default type: Geist (400–700 as "Geist", 900 as "GeistHeavy"), Geist Mono, and Georgia for the serif line. */
export const DEFAULT_FONTS = [
  ['GeistHeavy', `${V}/geist-sans/files/geist-sans-latin-900-normal.woff2`, '900'],
  ['Geist', `${V}/geist-sans/files/geist-sans-latin-400-normal.woff2`, '400'], ['Geist', `${V}/geist-sans/files/geist-sans-latin-500-normal.woff2`, '500'],
  ['Geist', `${V}/geist-sans/files/geist-sans-latin-600-normal.woff2`, '600'], ['Geist', `${V}/geist-sans/files/geist-sans-latin-700-normal.woff2`, '700'],
  ['GeistMono', `${V}/geist-mono/files/geist-mono-latin-400-normal.woff2`, '400'], ['GeistMono', `${V}/geist-mono/files/geist-mono-latin-500-normal.woff2`, '500'],
];
export async function loadFonts(fonts = DEFAULT_FONTS) {
  await Promise.all(fonts.map(async ([f, u, w]) => { const ff = new FontFace(f, `url(${u})`, { weight: w }); await ff.load(); document.fonts.add(ff); }));
  await document.fonts.load('italic 40px Georgia'); await document.fonts.load('40px Georgia');
}

// ================================================================================================ geometry helpers
/** Apply a placement {cx, cy, s, rot(deg)} for drawing in local coordinates. */
export function place(c, T) { c.translate(T.cx, T.cy); c.rotate((T.rot || 0) * D2R); c.scale(T.s, T.s); }
export function mapPt(T, x, y) { const r = (T.rot || 0) * D2R, cs = Math.cos(r), sn = Math.sin(r); return [T.cx + T.s * (x * cs - y * sn), T.cy + T.s * (x * sn + y * cs)]; }
export const lerpT = (a, b, u) => ({ cx: lerp(a.cx, b.cx, u), cy: lerp(a.cy, b.cy, u), s: lerp(a.s, b.s, u), rot: lerp(a.rot || 0, b.rot || 0, u) });
/** An image placement {ox, oy, s}: source pixel p lands at o + s·p. */
export const toScreen = (pl, p) => [pl.ox + pl.s * p[0], pl.oy + pl.s * p[1]];
export function applyCam(c, cam) { c.translate(cam.tx, cam.ty); c.scale(cam.z, cam.z); }
export const camPt = (cam, p) => [p[0] * cam.z + cam.tx, p[1] * cam.z + cam.ty];
/** Keyframed pose: ks = [[frame, [x, y], angle, easeFn?], ...] → {x, y, a}. */
export function keyPose(f, ks) {
  if (f <= ks[0][0]) return { x: ks[0][1][0], y: ks[0][1][1], a: ks[0][2] };
  for (let i = 1; i < ks.length; i++) if (f <= ks[i][0]) { const [f0, p0, a0] = ks[i - 1], [f1, p1, a1, e = ease.inOut] = ks[i]; const u = e((f - f0) / (f1 - f0)); return { x: lerp(p0[0], p1[0], u), y: lerp(p0[1], p1[1], u), a: lerp(a0, a1, u) }; }
  const k = ks[ks.length - 1]; return { x: k[1][0], y: k[1][1], a: k[2] };
}

// ================================================================================================ paper, type, marks
export function bg(c, color = C.paper) { c.drawImage(K.paperTexture(W, H, color), 0, 0); }
/** A small note in a corner (l = {x, y, fs}), e.g. "Illustrative example". */
export function label(c, text, l) { K.text(c, text, l.x, l.y, { kind: 'sans', size: l.fs, weight: 500, color: C.ink, alpha: 0.5, align: 'right' }); }
export function stampScale(age) { return age < 1 ? 1.06 : age < 2 ? 0.98 : 1; }
export function fitSize(lines, maxW, size) {
  let s = size;
  for (const [str, kind] of lines) { const k = kind === 'serif' ? 1.08 : 1; const w = K.measure(ctx, str, { kind, size: s * k, track: kind === 'heavy' ? -0.055 : -0.035 }); if (w > maxW) s = Math.min(s, s * maxW / w); }
  return s;
}
/** Feather an image's borders into the paper so no rectangle edge shows (cached per bitmap). */
const feathered = new Map();
export function feather(img, px = 40) {
  if (!img) return img; if (feathered.has(img)) return feathered.get(img);
  const [cv, x] = off(img.width, img.height); x.drawImage(img, 0, 0);
  x.globalCompositeOperation = 'destination-in';
  const [mc, m] = off(img.width, img.height); m.fillStyle = '#000';
  for (let i = 0; i < px; i++) { m.globalAlpha = 1 / px * 1.6; m.fillRect(i, i, img.width - 2 * i, img.height - 2 * i); }
  m.globalAlpha = 1; m.fillRect(px, px, img.width - 2 * px, img.height - 2 * px);
  x.drawImage(mc, 0, 0); feathered.set(img, cv); return cv;
}
/**
 * Art as ink on our paper: the image's own background (median of its border) is divided out so it becomes white,
 * then the result is drawn with 'multiply'. No rectangle, no colour step at the edges, whatever the paper tint.
 */
const inked = new Map();
export function inkLayer(img) {
  if (!img) return img; if (inked.has(img)) return inked.get(img);
  const [cv, x] = off(img.width, img.height); x.drawImage(img, 0, 0);
  const d = x.getImageData(0, 0, img.width, img.height), p = d.data, w = img.width, h = img.height, s = [[], [], []];
  for (let i = 0; i < w; i += 7) for (const y of [2, h - 3]) { const k = (y * w + i) * 4; for (let ch = 0; ch < 3; ch++) s[ch].push(p[k + ch]); }
  for (let j = 0; j < h; j += 7) for (const xx of [2, w - 3]) { const k = (j * w + xx) * 4; for (let ch = 0; ch < 3; ch++) s[ch].push(p[k + ch]); }
  const bgc = s.map(a => a.sort((m, n) => m - n)[a.length >> 1] || 255);
  for (let k = 0; k < p.length; k += 4) for (let ch = 0; ch < 3; ch++) p[k + ch] = Math.min(255, p[k + ch] * 255 / bgc[ch]);
  x.putImageData(d, 0, 0); inked.set(img, cv); return cv;
}
/** Draw an image as ink (see inkLayer); src rect optional: drawInk(c, img, dx, dy, dw, dh) or (c, img, sx, sy, sw, sh, dx, dy, dw, dh). */
export function drawInk(c, img, ...a) {
  if (!img) return; c.save(); c.globalCompositeOperation = 'multiply'; c.drawImage(inkLayer(img), ...a); c.restore();
}
/**
 * Letterpress super: lands with scaleY 0.94 → 1.02 → 1 and a 1 px ink spread for 2 frames; optional lift-off.
 * lines = [[text, 'heavy' | 'serif' | 'sans' | 'mono', color?], ...]; the serif line is set 1.08× like an italic second line.
 */
export function superLines(c, lines, x, y, f, f0, f1, o = {}) {
  if (f < f0 || f >= f1) return;
  const age = f - f0, sy = age < 1 ? 0.94 : age < 2 ? 1.02 : 1;
  let dy = 0, a = 1;
  if (o.lift && f >= f1 - 4) { const p = (on2(f - (f1 - 4)) + 2) / 4; dy = -6 * p; a = 1 - p; }
  const size = o.maxW ? fitSize(lines.map(([s, k]) => [s, k]), o.maxW, o.size) : o.size;
  c.save(); c.translate(x, y); c.scale(1, sy); c.translate(-x, -y);
  let yy = y;
  lines.forEach(([str, kind, color], i) => {
    const sz = kind === 'serif' ? size * 1.08 : size;
    yy += sz * (i === 0 ? 0.82 : kind === 'serif' ? 1.06 : 1.01);
    K.text(c, str, x, yy + dy, { kind, size: sz, color: color || C.ink, track: kind === 'heavy' ? -0.055 : -0.035, alpha: a, spread: age < 2 ? 0.6 : 0 });
  });
  c.restore();
  return yy;
}
/** One headline line stamped at a baseline. */
export function stampLine(c, str, x, base, kind, size, age, track = kind === 'heavy' ? -0.055 : -0.045) {
  if (age < 0) return;
  c.save(); c.translate(x, base); c.scale(1, age < 1 ? 0.94 : age < 2 ? 1.02 : 1); K.text(c, str, 0, 0, { kind, size, track, spread: age < 2 ? 0.6 : 0 }); c.restore();
}
/** Height of the logo drawn w wide. */
export const logoH = w => (A.logo ? w * A.logo.height / A.logo.width : 0);
export function drawLogo(c, x, y, w, alpha = 1, scale = 1) {
  if (!A.logo) return;
  const h = logoH(w); c.save(); c.globalAlpha *= alpha; c.imageSmoothingQuality = 'high'; c.translate(x + w / 2, y + h / 2); c.scale(scale, scale);
  c.drawImage(A.logo, -w / 2, -h / 2, w, h); c.restore();
}
/** The brand moment: the logo stamps in (squash + ink ghost) with emphasis marks. */
export function stampLogo(c, x, y, w, age, o = {}) {
  if (age < 0) return;
  drawLogo(c, x, y, w, 1, stampScale(age));
  if (age < 2) { const g = o.ghost ?? 1; c.save(); c.globalAlpha = 0.25; drawLogo(c, x - g, y + g, w, 1, 1 + (o.ghostScale ?? 0.004)); c.restore(); }
  emphasis(c, x + w + (o.ex ?? 14), y + (o.ey ?? 16), -28, age, o.size ?? 1.1, o.seed ?? 5);
}
export function vecCheck(c, x, y, s, color = '#fff', lw = 0.2) {
  c.save(); c.strokeStyle = color; c.lineWidth = s * lw; c.lineCap = 'round'; c.lineJoin = 'round';
  c.beginPath(); c.moveTo(x - s * 0.42, y + s * 0.02); c.lineTo(x - s * 0.1, y + s * 0.32); c.lineTo(x + s * 0.45, y - s * 0.3); c.stroke(); c.restore();
}
export function vecArrowNE(c, x, y, s, color) {
  c.save(); c.strokeStyle = color; c.lineWidth = s * 0.13; c.lineCap = 'round'; c.lineJoin = 'round';
  c.beginPath(); c.moveTo(x, y + s); c.lineTo(x + s, y); c.moveTo(x + s * 0.3, y); c.lineTo(x + s, y); c.lineTo(x + s, y + s * 0.7); c.stroke(); c.restore();
}
/** Emphasis marks: three short ink strokes radiating from (x, y) towards angle a (deg). */
export function emphasis(c, x, y, a, age, size = 1, seed = 1) {
  if (age < 0 || age > 14) return;
  const grow = ease.out(clamp(age / 3)), fade = age > 10 ? 1 - (age - 10) / 4 : 1;
  for (let i = -1; i <= 1; i++) {
    const ang = (a + i * 26) * D2R, r0 = 18 * size, r1 = r0 + (34 + (i === 0 ? 10 : 0)) * size * grow;
    K.inkStroke(c, [[x + Math.cos(ang) * r0, y + Math.sin(ang) * r0], [x + Math.cos(ang) * r1, y + Math.sin(ang) * r1]], { w: 3.4 * size, seed: seed * 7 + i, boilT: bt(age), taper: 8, alpha: fade });
  }
}
/** Torn-paper (deckled) rectangle path. */
export function deckle(c, r, seed, amp = 5) {
  const rnd = K.mulberry32(seed), pts = [];
  const edge = (x0, y0, x1, y1) => { const n = Math.max(8, Math.round(Math.hypot(x1 - x0, y1 - y0) / 14)); for (let i = 0; i < n; i++) { const u = i / n; pts.push([lerp(x0, x1, u) + (rnd() - 0.5) * amp * (y0 === y1 ? 0.3 : 2), lerp(y0, y1, u) + (rnd() - 0.5) * amp * (x0 === x1 ? 0.3 : 2)]); } };
  edge(r.x, r.y, r.x + r.w, r.y); edge(r.x + r.w, r.y, r.x + r.w, r.y + r.h); edge(r.x + r.w, r.y + r.h, r.x, r.y + r.h); edge(r.x, r.y + r.h, r.x, r.y);
  c.beginPath(); c.moveTo(pts[0][0], pts[0][1]); for (const p of pts) c.lineTo(p[0], p[1]); c.closePath();
}
/** Draw img (w×h) into the quad q = [TL, TR, BR, BL] with a two-triangle affine warp. */
export function warpImage(c, img, w, h, q) {
  const tri = (s0, s1, s2, d0, d1, d2) => {
    c.save(); c.beginPath(); const cx = (d0[0] + d1[0] + d2[0]) / 3, cy = (d0[1] + d1[1] + d2[1]) / 3, grow = p => [p[0] + (p[0] - cx) * 0.012, p[1] + (p[1] - cy) * 0.012];
    const [g0, g1, g2] = [grow(d0), grow(d1), grow(d2)]; c.moveTo(...g0); c.lineTo(...g1); c.lineTo(...g2); c.closePath(); c.clip();
    const den = s0[0] * (s1[1] - s2[1]) + s1[0] * (s2[1] - s0[1]) + s2[0] * (s0[1] - s1[1]);
    const a = (d0[0] * (s1[1] - s2[1]) + d1[0] * (s2[1] - s0[1]) + d2[0] * (s0[1] - s1[1])) / den;
    const b = (d0[1] * (s1[1] - s2[1]) + d1[1] * (s2[1] - s0[1]) + d2[1] * (s0[1] - s1[1])) / den;
    const cc = (d0[0] * (s2[0] - s1[0]) + d1[0] * (s0[0] - s2[0]) + d2[0] * (s1[0] - s0[0])) / den;
    const d = (d0[1] * (s2[0] - s1[0]) + d1[1] * (s0[0] - s2[0]) + d2[1] * (s1[0] - s0[0])) / den;
    const e = (d0[0] * (s1[0] * s2[1] - s2[0] * s1[1]) + d1[0] * (s2[0] * s0[1] - s0[0] * s2[1]) + d2[0] * (s0[0] * s1[1] - s1[0] * s0[1])) / den;
    const ff = (d0[1] * (s1[0] * s2[1] - s2[0] * s1[1]) + d1[1] * (s2[0] * s0[1] - s0[0] * s2[1]) + d2[1] * (s0[0] * s1[1] - s1[0] * s0[1])) / den;
    c.transform(a, b, cc, d, e, ff); c.drawImage(img, 0, 0, w, h, 0, 0, w, h); c.restore();
  };
  tri([0, 0], [w, 0], [w, h], q[0], q[1], q[2]);
  tri([0, 0], [w, h], [0, h], q[0], q[2], q[3]);
}

// ================================================================================================ props
/** A yellow pencil (no hand), tip at (x, y), body along angle a (deg). */
export function drawPencil(c, x, y, a, b) {
  c.save(); c.translate(x, y); c.rotate(a * D2R);
  const ink = { boilT: b, wobble: 0.5, taper: 6 };
  c.fillStyle = '#f2dfb8'; c.beginPath(); c.moveTo(0, 0); c.lineTo(42, -11); c.lineTo(42, 11); c.closePath(); c.fill();
  c.fillStyle = C.ink; c.beginPath(); c.moveTo(0, 0); c.lineTo(13, -3.5); c.lineTo(13, 3.5); c.closePath(); c.fill();
  c.fillStyle = '#f5d76e'; c.fillRect(42, -11, 175, 22);
  c.fillStyle = 'rgba(0,0,0,0.06)'; c.fillRect(42, 3.5, 175, 7.5);
  c.fillStyle = '#cfcabc'; c.fillRect(217, -11.5, 22, 23);
  c.fillStyle = '#e8a595'; c.beginPath(); c.roundRect(239, -10.5, 22, 21, [0, 6, 6, 0]); c.fill();
  K.inkStroke(c, [[0, 0], [42, -11]], { ...ink, w: 1.8, seed: 61 }); K.inkStroke(c, [[0, 0], [42, 11]], { ...ink, w: 1.8, seed: 62 });
  K.inkStroke(c, [[42, -11], [262, -11]], { ...ink, w: 2, seed: 63 }); K.inkStroke(c, [[42, 11], [262, 11]], { ...ink, w: 2, seed: 64 });
  K.inkStroke(c, [[42, -3.5], [217, -3.5]], { ...ink, w: 1, seed: 65, alpha: 0.6 }); K.inkStroke(c, [[42, 3.5], [217, 3.5]], { ...ink, w: 1, seed: 66, alpha: 0.6 });
  K.inkStroke(c, [[217, -12], [217, 12]], { ...ink, w: 1.6, seed: 67 }); K.inkStroke(c, [[239, -12], [239, 12]], { ...ink, w: 1.6, seed: 68 });
  for (let k = 0; k < 3; k++) K.inkStroke(c, [[222 + k * 6, -11], [222 + k * 6, 11]], { ...ink, w: 0.9, seed: 69 + k, alpha: 0.5 });
  K.inkStroke(c, [[262, -10], [264, 0], [262, 10]], { ...ink, w: 1.8, seed: 72 });
  c.restore();
}

// ================================================================================================ UI cards on paper
/** Green success chip (rect {x, y, w, h}); p (0..1) draws the tick; age drives the stamp squash. */
export function successChip(c, r, p, age, title, sub, o = {}) {
  const sq = age < 1 ? 1.08 : age < 2 ? 0.97 : 1, fs = o.fs ?? 32, fs2 = o.fs2 ?? 28;
  c.save(); c.translate(r.x + r.w / 2, r.y + r.h / 2); c.scale(sq, sq); c.translate(-r.w / 2, -r.h / 2);
  c.fillStyle = '#e5efdf'; c.beginPath(); c.roundRect(0, 0, r.w, r.h, 14); c.fill();
  c.strokeStyle = 'rgba(60,105,74,0.35)'; c.lineWidth = 1.5; c.stroke();
  c.fillStyle = '#3c694a'; c.beginPath(); c.arc(42, r.h / 2, 20, 0, Math.PI * 2); c.fill();
  const q = clamp(p * 1.4); if (q > 0) { c.save(); c.beginPath(); c.rect(0, 0, 42 - 20 + 40 * q, r.h); c.clip(); vecCheck(c, 42, r.h / 2, 22, '#fff', 0.2); c.restore(); }
  K.text(c, title, 80, sub ? r.h * 0.46 : r.h * 0.6, { kind: 'sans', size: fs, weight: 600, color: '#243b25' });
  if (sub) K.text(c, sub, 80, r.h * 0.46 + 36, { kind: 'sans', size: fs2, weight: 500, color: '#243b25', alpha: 0.75 });
  c.restore();
}
/** Paper card with a mono label and one line; hl = highlighter progress over hlText. */
export function ruleCard(c, r, age, f, labelText, body, o = {}) {
  const sq = age < 1 ? 1.06 : age < 2 ? 0.98 : 1;
  c.save(); c.translate(r.x + r.w / 2, r.y + r.h / 2); c.scale(sq, sq); c.translate(-r.w / 2, -r.h / 2);
  K.card(c, 0, 0, r.w, r.h, { r: 12, boilT: bt(f), seed: o.seed ?? 91, lw: 1.8, shadow: 0.08 });
  K.text(c, labelText, 24, 36, { kind: 'mono', size: 20, weight: 500, color: C.ink, alpha: 0.7, track: 0.06 });
  const fs = fitSize([[body, 'sans']], r.w - 48, o.fs ?? 28);
  if (o.hl > 0 && o.hlText) { const w = K.measure(c, o.hlText, { kind: 'sans', size: fs, weight: 600 }); K.highlight(c, 20, 80 - fs * 0.85, w + 8, fs * 1.15, { p: Math.ceil(o.hl * 3) / 3, color: o.hlColor || '#ffd999', seed: o.hlSeed ?? 83 }); }
  K.text(c, body, 24, 80, { kind: 'sans', size: fs, weight: 600, color: C.ink });
  c.restore();
}
/**
 * A reply typed in word groups: lines = [[group, group, ...], ...]; shown = groups visible; hls = [{group, text, p, seed}].
 * Non-breaking spaces inside a group keep phrases together.
 */
export function wordGroups(c, lines, x0, y0, fs, lead, shown, hls = []) {
  const words = []; let gi = 0;
  lines.forEach((line, li) => { let x = x0; line.forEach(g => { const w = K.measure(c, g, { kind: 'sans', size: fs, weight: 500 }); words.push({ g, x, y: y0 + li * lead, w, i: gi++ }); x += w + K.measure(c, ' ', { kind: 'sans', size: fs, weight: 500 }); }); });
  for (const h of hls) {
    if (!(h.p > 0)) continue; const wd = words[h.group]; const at = wd.g.indexOf(h.text), pre = wd.g.slice(0, at);
    const x = wd.x + K.measure(c, pre, { kind: 'sans', size: fs, weight: 500 }), w = K.measure(c, h.text, { kind: 'sans', size: fs, weight: 500 });
    K.highlight(c, x - 4, wd.y - fs * 0.85, w + 8, fs * 1.15, { p: Math.ceil(h.p * 3) / 3, color: '#ffd999', seed: h.seed ?? 81 });
  }
  for (const wd of words) if (wd.i < shown) K.text(c, wd.g, wd.x, wd.y, { kind: 'sans', size: fs, weight: 500, color: C.ink });
  return words;
}

// ================================================================================================ audio
async function decodeUrl(ac, url) { const r = await fetch(url); if (!r.ok) throw new Error(url + ' ' + r.status); return ac.decodeAudioData(await r.arrayBuffer()); }
/** vo.json in either shape: { lines: [{id, dur, text, speechStart, speechEnd}] } (motigen vo) or { voices: { name: { lines: { ID: {file…} } } } }. */
function voLines(VO, voice, base = 'audio/vo/') {
  if (!VO) return {};
  if (Array.isArray(VO.lines)) return Object.fromEntries(VO.lines.map(l => [l.id, { file: `${base}${l.id}.wav`, ...l }]));
  if (Array.isArray(VO)) return Object.fromEntries(VO.map(l => [l.id, { file: `${base}${l.id}.wav`, ...l }]));
  return VO.voices?.[voice || VO.primary]?.lines || {};
}
/**
 * Offline mix. spec = {
 *   dur,                                          // seconds
 *   music: { file, lufs = -18.5 },                // the bed, levelled to `lufs` before ducking
 *   duck: t => dB,                                // duck depth under the voice at time t (e.g. -6 sparse, -10 groove)
 *   vo: { json, voice, cues, base },              // cues {ID: frame | {end: frame} | {f: frame, db}}: first word on the frame, or last sound ends on it
 *   sfx: cues,                                    // [[id, frame, dB, {align, rate, maxDur, fadeIn, fadeOut, at0}]], from A.sfx (audio/sfx/sfx.json)
 *   extra: async ({ ac, sfxBus, voBus, decode, lib }) => {},   // film-specific sound (sliced typing etc.)
 * }
 * Voice sits at about -16 LUFS as a whole, effects are relative to it, the master is normalised to -14 LUFS / -1 dBTP.
 */
export async function mix(spec) {
  const dec = new OfflineAudioContext(2, SR, SR);
  const N = Math.ceil(spec.dur * SR), ac = new OfflineAudioContext({ numberOfChannels: 2, length: N, sampleRate: SR });
  const master = ac.createGain(); master.connect(ac.destination);
  const musicBus = ac.createGain(), voBus = ac.createGain(), sfxBus = ac.createGain();
  musicBus.connect(master); sfxBus.connect(master);
  const hp = ac.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 80;
  const comp = ac.createDynamicsCompressor(); comp.threshold.value = -20; comp.knee.value = 6; comp.ratio.value = 3; comp.attack.value = 0.005; comp.release.value = 0.15;
  voBus.connect(hp); hp.connect(comp); comp.connect(master);
  const report = { vo: [], sfx: [], missing: [] };
  const cache = new Map(), decode = async url => { if (!cache.has(url)) cache.set(url, await decodeUrl(dec, url)); return cache.get(url); };
  // music
  if (spec.music) {
    let bed = null; try { bed = await decode(spec.music.file); } catch { report.missing.push(spec.music.file); }
    if (bed) { const lu = loudness(bed, { truePeak: false }).integrated; const s = ac.createBufferSource(); s.buffer = bed; const g = ac.createGain(); g.gain.value = dbg((spec.music.lufs ?? -18.5) - lu); s.connect(g); g.connect(musicBus); s.start(0); }
  }
  // voice
  const lines = voLines(spec.vo?.json, spec.vo?.voice, spec.vo?.base);
  const regions = [], voBufs = {};
  for (const [id, fcue] of Object.entries(spec.vo?.cues || {})) {
    const ln = lines[id]; if (!ln) { report.missing.push(id); continue; }
    try { voBufs[id] = { buf: await decode(ln.file), ln, fcue }; } catch { report.missing.push(ln.file); }
  }
  const voAll = Object.values(voBufs);
  let voGain = 1; if (voAll.length) { const tot = voAll.reduce((a, v) => a + v.buf.length, 0), cat = new AudioBuffer({ numberOfChannels: 1, length: tot, sampleRate: SR }); let o = 0; for (const v of voAll) { cat.getChannelData(0).set(v.buf.getChannelData(0), o); o += v.buf.length; } voGain = dbg(-16 - loudness(cat, { truePeak: false }).integrated); }
  for (const [id, v] of Object.entries(voBufs)) {
    const q = typeof v.fcue === 'object' ? v.fcue : { f: v.fcue };
    const at = Math.max(0, q.end != null ? q.end / FPS - (v.ln.speechEnd || v.buf.duration) : q.f / FPS - (v.ln.speechStart || 0));
    const s = ac.createBufferSource(); s.buffer = v.buf; const g = ac.createGain(); g.gain.value = voGain * dbg(q.db || 0); s.connect(g); g.connect(voBus); s.start(at);
    regions.push([at + (v.ln.speechStart || 0), at + (v.ln.speechEnd || v.buf.duration)]);
    report.vo.push({ id, at: +at.toFixed(3), dur: +v.buf.duration.toFixed(3), end: +(at + v.buf.duration).toFixed(3) });
  }
  // effects (transient on the cue frame, never early)
  const lib = A.sfx || {};
  for (const [id, fcue, db, o = {}] of spec.sfx || []) {
    const meta = lib[id]; let buf = null; if (meta) { try { buf = await decode(meta.file); } catch { /* reported below */ } }
    if (!buf) { report.missing.push(id); continue; }
    const rate = o.rate || 1, hit = (o.align === 'enter' ? meta.enter ?? meta.hit : meta.hit) || 0;
    const at = o.at0 ? fcue / FPS : fcue / FPS - hit / rate;
    const dur = Math.min(buf.duration / rate, o.maxDur || 1e9);
    const s = ac.createBufferSource(); s.buffer = buf; s.playbackRate.value = rate;
    const g = ac.createGain(), lvl = dbg(db - 4); g.gain.setValueAtTime(o.fadeIn ? 0 : lvl, Math.max(0, at));
    if (o.fadeIn) g.gain.linearRampToValueAtTime(lvl, at + o.fadeIn);
    if (o.fadeOut) { g.gain.setValueAtTime(lvl, at + dur - o.fadeOut); g.gain.linearRampToValueAtTime(0, at + dur); }
    s.connect(g); g.connect(sfxBus); s.start(Math.max(0, at), Math.max(0, -at)); s.stop(at + dur + 0.01);
    report.sfx.push({ id, f: fcue, at: +at.toFixed(3) });
  }
  if (spec.extra) await spec.extra({ ac, sfxBus, voBus, decode, lib });
  // ducking under the voice
  const dg = musicBus.gain; dg.setValueAtTime(1, 0);
  regions.sort((a, b) => a[0] - b[0]);
  const merged = []; for (const r of regions) { const l = merged[merged.length - 1]; if (l && r[0] - 0.14 <= l[1] + 0.4) l[1] = Math.max(l[1], r[1]); else merged.push([...r]); }
  for (const [a, b] of merged) { const depth = dbg(spec.duck ? spec.duck(a) : -10), s = Math.max(0, a - 0.06 - 0.08); dg.setValueAtTime(1, s); dg.linearRampToValueAtTime(depth, s + 0.08); dg.setValueAtTime(depth, b); dg.linearRampToValueAtTime(1, b + 0.4); }
  const out = await ac.startRendering();
  report.norm = normalize(out, { targetLufs: spec.target?.lufs ?? -14, ceilingDbtp: spec.target?.dbtp ?? -1 });
  report.duck = merged.map(r => r.map(v => +v.toFixed(2)));
  return { buffer: out, report };
}
/** Single keystrokes sliced from a typing take in the library (lib.FX1.keys): hits = [[frame, rate], ...]. */
export function keyClicks({ ac, sfxBus, lib }, buf, hits, db = -22, slice = 0.07) {
  const keys = lib.FX1?.keys || []; if (!buf || keys.length < 4) return;
  hits.forEach(([fr, rate], i) => { const k = keys[(i * 7) % (keys.length - 1)]; const s = ac.createBufferSource(); s.buffer = buf; s.playbackRate.value = rate; const g = ac.createGain(); g.gain.value = dbg(db - 4); s.connect(g); g.connect(sfxBus); s.start(fr / FPS - 0.006, Math.max(0, k - 0.006), slice); });
}
export function enterClick({ ac, sfxBus, lib }, buf, frame, db = -20) {
  const keys = lib.FX1?.keys || [], en = lib.FX1?.enter ?? keys[keys.length - 1]; if (!buf || en == null) return;
  const s = ac.createBufferSource(); s.buffer = buf; const g = ac.createGain(); g.gain.value = dbg(db - 4); s.connect(g); g.connect(sfxBus); s.start(frame / FPS - 0.006, Math.max(0, en - 0.006), 0.12);
}

// ================================================================================================ export + boot
function wavBlob(buf) {
  const n = buf.length, ch = buf.numberOfChannels, dv = new DataView(new ArrayBuffer(44 + n * ch * 2)); const w = (o, s) => [...s].forEach((c, i) => dv.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); dv.setUint32(4, 36 + n * ch * 2, true); w(8, 'WAVE'); w(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, ch, true); dv.setUint32(24, SR, true); dv.setUint32(28, SR * ch * 2, true); dv.setUint16(32, ch * 2, true); dv.setUint16(34, 16, true); w(36, 'data'); dv.setUint32(40, n * ch * 2, true);
  const d = [...Array(ch)].map((_, c) => buf.getChannelData(c)); let o = 44; for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) { const v = clamp(d[c][i], -1, 1); dv.setInt16(o, Math.max(-32768, Math.min(32767, Math.round(v * 32768))), true); o += 2; }
  return new Blob([dv], { type: 'audio/wav' });
}
/** The sound events the mix spec implies, on the output clock: voice cues and effects (for motigen events / srt). */
function eventsOf(spec, dur) {
  const lines = voLines(spec.vo?.json, spec.vo?.voice, spec.vo?.base), ev = { dur, vo: [], sfx: [] };
  for (const [id, fcue] of Object.entries(spec.vo?.cues || {})) {
    const q = typeof fcue === 'object' ? fcue : { f: fcue }, ln = lines[id] || {};
    const t = q.end != null ? q.end / FPS - (ln.speechEnd ?? ln.dur ?? 0) : q.f / FPS - (ln.speechStart || 0);
    ev.vo.push({ id, t: +Math.max(0, t).toFixed(3) });
  }
  for (const [id, f, db] of spec.sfx || []) ev.sfx.push({ id, t: +(f / FPS).toFixed(3), db });
  ev.vo.sort((a, b) => a.t - b.t);
  return ev;
}
/**
 * film = { id, load: async () => ({ dur }), render: (c, f) => void, mix?: () => spec, logo?: url, fonts?: [[family, url, weight]], maxDur? }.
 * Registers window.__film (and the older __ad name) for the preview and the headless driver.
 */
export async function boot(film) {
  await loadFonts(film.fonts);
  if (film.logo) A.logo = await tryImg(film.logo);
  A.sfx = await tryJson(film.sfx || 'audio/sfx/sfx.json', {});
  const info = (await film.load()) || {};
  const DUR = Math.min(film.maxDur || 600, info.dur || 30);
  let MIX = null, REPORT = null;
  const renderAt = t => { const f = Math.round(t * FPS * 1000) / 1000; ctx.setTransform(1, 0, 0, 1, 0, 0); bg(ctx, film.paper); film.render(ctx, f); };
  const buildMix = async () => { const r = await mix({ dur: DUR, ...film.mix() }); MIX = r.buffer; REPORT = r.report; return REPORT; };
  const exportMP4 = async (onProgress = () => {}) => {
    const mb = await import('/_motigen/vendor/mediabunny/dist/modules/src/index.js');
    if (film.mix && !MIX) await buildMix();
    const output = new mb.Output({ format: new mb.Mp4OutputFormat({ fastStart: 'in-memory' }), target: new mb.BufferTarget() });
    const video = new mb.CanvasSource(canvas, { codec: 'avc', quality: new mb.Quality({ quantizer: 18, bitrate: 24e6 }), keyFrameInterval: 2, fullCodecString: 'avc1.640028' });
    output.addVideoTrack(video, { frameRate: FPS });
    const audio = MIX ? new mb.AudioBufferSource({ codec: 'aac', bitrate: 192000 }) : null;
    if (audio) output.addAudioTrack(audio);
    await output.start();
    const n = Math.round(DUR * FPS);
    for (let i = 0; i < n; i++) { renderAt(i / FPS); await video.add(i / FPS, 1 / FPS); if (i % 30 === 0) onProgress(i / n); }
    if (audio) await audio.add(MIX);
    await output.finalize(); onProgress(1);
    return { blob: new Blob([output.target.buffer], { type: 'video/mp4' }) };
  };
  const api = {
    ready: false, id: film.id, canvas, dur: DUR, fps: FPS, renderAt, buildMix, exportMP4,
    events: () => (film.events ? film.events() : film.mix ? eventsOf(film.mix(), DUR) : { dur: DUR }),
    wav: film.mix ? async () => { if (!MIX) await buildMix(); return wavBlob(MIX); } : undefined,
    get report() { return REPORT; },
  };
  window.__film = api; window.__ad = api;
  renderAt(+(Q.get('t') || 0));
  api.ready = true;
  window.dispatchEvent(new Event('film-ready'));
  return api;
}
