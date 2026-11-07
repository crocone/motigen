// Hand-drawn editorial drawing kit for Canvas 2D. Everything is a pure function of its inputs (time comes in as
// numbers), so a frame can be rendered at any t in any order. Strokes "boil" on twos: the wobble seed changes
// 12 times a second, like hand-drawn animation, while the thread and the camera move smoothly.

export const C = {
  paper: '#fdfcf5', ink: '#20211e', muted: '#64645d', orange: '#ee4c0b', orangeDeep: '#c93a05', yellow: '#fff6c7',
  yellowInk: '#f5d76e', blue: '#daeefe', card: '#fffdf7', ochre: '#A66A12', graphite: '#242522', green: '#2f7d4f', greenTint: '#e3f1e6',
};
export const F = { heavy: 'GeistHeavy', sans: 'Geist', mono: 'GeistMono', serif: 'Georgia', hand: 'Ink Free' };

// ---------------------------------------------------------------------------------------------------- math
export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const prog = (t, a, b) => clamp((t - a) / (b - a));
export const ease = {
  lin: t => t,
  in: t => t * t * t,
  out: t => 1 - Math.pow(1 - t, 3),
  out2: t => 1 - (1 - t) * (1 - t),
  out5: t => 1 - Math.pow(1 - t, 5),
  inOut: t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  inOut2: t => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  outBack: (t, s = 1.70158) => 1 + (s + 1) * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2),
  outExpo: t => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  inExpo: t => (t <= 0 ? 0 : Math.pow(2, 10 * t - 10)),
  inOutExpo: t => (t <= 0 ? 0 : t >= 1 ? 1 : t < 0.5 ? Math.pow(2, 20 * t - 10) / 2 : (2 - Math.pow(2, -20 * t + 10)) / 2),
  // damped spring that settles at 1; k = stiffness-ish, z = damping
  spring: (t, k = 9, z = 0.42) => (t <= 0 ? 0 : 1 - Math.exp(-z * k * t) * Math.cos(k * Math.sqrt(1 - z * z) * t)),
};
/** Value of an animated property between keys [[t, v, easeFn?], ...] (ease applies to the segment ending at that key). */
export function keys(t, ks) {
  if (t <= ks[0][0]) return ks[0][1];
  for (let i = 1; i < ks.length; i++) {
    if (t <= ks[i][0]) { const [t0, v0] = ks[i - 1], [t1, v1, e = ease.inOut] = ks[i]; return lerp(v0, v1, e((t - t0) / (t1 - t0))); }
  }
  return ks[ks.length - 1][1];
}
export function mulberry32(a) {
  return function () { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export function hash(...n) { let h = 2166136261; for (const v of n) { h ^= Math.round(v * 977) | 0; h = Math.imul(h, 16777619); } return h >>> 0; }
export const boil = (t, fps = 12) => Math.floor(t * fps + 1e-6);
/** smooth 1D value noise in [-1, 1] */
export function noise1(seed, x) {
  const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
  const r = k => (mulberry32(hash(seed, k))() * 2 - 1);
  return lerp(r(i), r(i + 1), u);
}

// ---------------------------------------------------------------------------------------------------- paths
export function linePts(x1, y1, x2, y2, bow = 0, n = 0) {
  const L = Math.hypot(x2 - x1, y2 - y1), m = n || Math.max(2, Math.ceil(L / 8)), nx = -(y2 - y1) / (L || 1), ny = (x2 - x1) / (L || 1), out = [];
  for (let i = 0; i <= m; i++) { const u = i / m, b = Math.sin(Math.PI * u) * bow; out.push([lerp(x1, x2, u) + nx * b, lerp(y1, y2, u) + ny * b]); }
  return out;
}
export function bezierPts(p0, p1, p2, p3, n = 48) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n, a = (1 - u) ** 3, b = 3 * (1 - u) ** 2 * u, c = 3 * (1 - u) * u * u, d = u ** 3;
    out.push([a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]]);
  }
  return out;
}
/** Catmull-Rom spline through points (centripetal-ish via uniform with tension). */
export function splinePts(pts, perSeg = 20, tension = 0.5) {
  const out = [], P = [pts[0], ...pts, pts[pts.length - 1]];
  for (let i = 1; i < P.length - 2; i++) {
    const [p0, p1, p2, p3] = [P[i - 1], P[i], P[i + 1], P[i + 2]];
    for (let k = 0; k < perSeg; k++) {
      const u = k / perSeg, u2 = u * u, u3 = u2 * u, s = tension;
      const f = (a, b, c, d) => (2 * b + (-a + c) * s * u + (2 * s * a + (s - 3) * b + (3 - 2 * s) * c - s * d) * u2 + (-s * a + (2 - s) * b + (s - 2) * c + s * d) * u3) / 2 * 1;
      // standard Catmull-Rom (s = 0.5 → classic form scaled)
      const cr = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * u2 + (-a + 3 * b - 3 * c + d) * u3);
      out.push([s === 0.5 ? cr(p0[0], p1[0], p2[0], p3[0]) : f(p0[0], p1[0], p2[0], p3[0]), s === 0.5 ? cr(p0[1], p1[1], p2[1], p3[1]) : f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}
export function ellipsePts(cx, cy, rx, ry, a0 = 0, a1 = Math.PI * 2, n = 0) {
  const m = n || Math.max(12, Math.ceil(Math.abs(a1 - a0) * Math.max(rx, ry) / 8)), out = [];
  for (let i = 0; i <= m; i++) { const a = lerp(a0, a1, i / m); out.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]); }
  return out;
}
export function pathLength(pts) { let L = 0; for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return L; }
/** Resample to even spacing; returns {pts, s (arc length per point), L}. */
export function resample(pts, step = 5) {
  const out = [pts[0]], s = [0]; let acc = 0, need = step;
  for (let i = 1; i < pts.length; i++) {
    let [ax, ay] = pts[i - 1]; const [bx, by] = pts[i]; let seg = Math.hypot(bx - ax, by - ay);
    while (seg >= need) { const u = need / seg; ax = lerp(ax, bx, u); ay = lerp(ay, by, u); out.push([ax, ay]); acc += need; s.push(acc); seg -= need; need = step; }
    need -= seg; acc += 0; // carry
    if (i === pts.length - 1) { out.push([bx, by]); s.push(s[s.length - 1] + Math.hypot(bx - out[out.length - 2][0], by - out[out.length - 2][1])); }
  }
  return { pts: out, s, L: s[s.length - 1] };
}
/** Point and tangent angle at fraction u of a polyline. */
export function pointAt(pts, u) {
  const L = pathLength(pts), target = clamp(u) * L; let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const seg = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (acc + seg >= target || i === pts.length - 1) { const k = seg ? (target - acc) / seg : 0; return { x: lerp(pts[i - 1][0], pts[i][0], k), y: lerp(pts[i - 1][1], pts[i][1], k), a: Math.atan2(pts[i][1] - pts[i - 1][1], pts[i][0] - pts[i - 1][0]) }; }
    acc += seg;
  }
  return { x: pts[0][0], y: pts[0][1], a: 0 };
}

// ---------------------------------------------------------------------------------------------------- strokes
/**
 * A brush-ink stroke along a polyline: tapered ends, slight pressure variation, and a low-frequency wobble whose
 * seed changes with `boilT` (boil(t)) so the line lives on twos. `from`/`to` (0..1) draw a part of it.
 */
export function inkStroke(ctx, pts, o = {}) {
  const { w = 3, color = C.ink, seed = 1, wobble = 1.1, boilT = 0, taper = 18, from = 0, to = 1, alpha = 1, freq = 70, rough = 0.18 } = o;
  if (to <= from || pts.length < 2) return;
  const { pts: P, s, L } = resample(pts, 4);
  const a = from * L, b = to * L, sd = hash(seed, boilT * 7.3);
  const left = [], right = [];
  for (let i = 0; i < P.length; i++) {
    if (s[i] < a - 4 || s[i] > b + 4) continue;
    const i0 = Math.max(0, i - 1), i1 = Math.min(P.length - 1, i + 1);
    let tx = P[i1][0] - P[i0][0], ty = P[i1][1] - P[i0][1]; const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
    const nx = -ty, ny = tx, off = wobble * noise1(sd, s[i] / freq) + wobble * 0.35 * noise1(sd + 11, s[i] / 14);
    const local = s[i] - a, rem = b - s[i], tp = Math.min(1, Math.sqrt(Math.max(0, Math.min(local, rem)) / Math.max(1, taper)));
    const ww = Math.max(0.35, w * (0.25 + 0.75 * tp) * (1 + rough * noise1(sd + 5, s[i] / 22))) / 2;
    const x = P[i][0] + nx * off, y = P[i][1] + ny * off;
    left.push([x + nx * ww, y + ny * ww]); right.push([x - nx * ww, y - ny * ww]);
  }
  if (left.length < 2) return;
  ctx.save(); ctx.globalAlpha *= alpha; ctx.fillStyle = color; ctx.beginPath();
  ctx.moveTo(left[0][0], left[0][1]);
  for (let i = 1; i < left.length; i++) ctx.lineTo(left[i][0], left[i][1]);
  for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i][0], right[i][1]);
  ctx.closePath(); ctx.fill(); ctx.restore();
}
export function inkLine(ctx, x1, y1, x2, y2, o = {}) { inkStroke(ctx, linePts(x1, y1, x2, y2, o.bow || 0), o); }
/** Rectangle drawn as four slightly overshooting strokes, revealed in order by `p`. */
export function inkRect(ctx, x, y, w, h, o = {}) {
  const { p = 1, over = 6, seed = 3 } = o, r = mulberry32(seed), j = () => (r() - 0.5) * 3;
  const sides = [
    [x - over * 0.5, y + j(), x + w + over, y + j()], [x + w + j(), y - over * 0.4, x + w + j(), y + h + over],
    [x + w + over * 0.4, y + h + j(), x - over, y + h + j()], [x + j(), y + h + over * 0.3, x + j(), y - over],
  ];
  sides.forEach((sd, i) => { const q = clamp(p * 4 - i); if (q > 0) inkStroke(ctx, linePts(...sd, (r() - 0.5) * 2), { ...o, seed: seed * 13 + i, to: q }); });
}
export function inkEllipse(ctx, cx, cy, rx, ry, o = {}) {
  const { p = 1, start = -Math.PI / 2 - 0.3, overshoot = 0.35 } = o;
  inkStroke(ctx, ellipsePts(cx, cy, rx, ry, start, start + (Math.PI * 2 + overshoot) * p), { ...o, to: 1 });
}
/** Hatching inside a rectangle (shadows of the ink drawings). */
export function hatch(ctx, x, y, w, h, o = {}) {
  const { gap = 9, angle = -0.9, seed = 9, p = 1 } = o, r = mulberry32(seed);
  ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  const d = Math.hypot(w, h), cx = x + w / 2, cy = y + h / 2, ca = Math.cos(angle), sa = Math.sin(angle), n = Math.ceil(d / gap);
  for (let i = 0; i < n * p; i++) {
    const k = (i - n / 2) * gap, px = cx - sa * k, py = cy + ca * k;
    inkStroke(ctx, linePts(px - ca * d / 2, py - sa * d / 2, px + ca * d / 2, py + sa * d / 2), { w: 1.2, wobble: 0.6, ...o, seed: seed + i, alpha: (o.alpha ?? 0.5) * (0.7 + r() * 0.3) });
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------------------------------- the thread
/**
 * The orange thread: smooth (no boil), with a darker underside and a soft highlight so it reads as a cord, not a
 * vector line. `to` reveals it along its length; `from` lets the tail run away.
 */
export function thread(ctx, pts, o = {}) {
  const { w = 7, from = 0, to = 1, color = C.orange, alpha = 1, shadow = true } = o;
  if (to <= from) return;
  const { pts: P, s, L } = resample(pts, 3), a = from * L, b = to * L;
  const seg = P.filter((_, i) => s[i] >= a && s[i] <= b);
  if (seg.length < 2) return;
  ctx.save(); ctx.globalAlpha *= alpha; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const path = () => { ctx.beginPath(); ctx.moveTo(seg[0][0], seg[0][1]); for (let i = 1; i < seg.length; i++) ctx.lineTo(seg[i][0], seg[i][1]); };
  if (shadow) { ctx.save(); ctx.translate(2, 3); path(); ctx.strokeStyle = 'rgba(32,33,30,0.14)'; ctx.lineWidth = w; ctx.stroke(); ctx.restore(); }
  path(); ctx.strokeStyle = C.orangeDeep; ctx.lineWidth = w; ctx.stroke();
  ctx.translate(-w * 0.12, -w * 0.12); path(); ctx.strokeStyle = color; ctx.lineWidth = w * 0.78; ctx.stroke();
  ctx.translate(-w * 0.1, -w * 0.14); path(); ctx.strokeStyle = 'rgba(255,190,150,0.55)'; ctx.lineWidth = Math.max(1, w * 0.18); ctx.stroke();
  ctx.restore();
  return { head: seg[seg.length - 1], tail: seg[0] };
}
/** A small sewing needle drawn in ink at (x, y), pointing along angle a. */
export function needle(ctx, x, y, a, o = {}) {
  const { len = 70, boilT = 0, seed = 21 } = o;
  ctx.save(); ctx.translate(x, y); ctx.rotate(a);
  ctx.fillStyle = '#e9e7df'; ctx.beginPath(); ctx.moveTo(len * 0.5, 0); ctx.lineTo(-len * 0.5, -3.2); ctx.lineTo(-len * 0.5, 3.2); ctx.closePath(); ctx.fill();
  inkStroke(ctx, [[len * 0.52, 0], [-len * 0.5, -3.4]], { w: 1.8, boilT, seed, wobble: 0.4, taper: 6 });
  inkStroke(ctx, [[len * 0.52, 0], [-len * 0.5, 3.4]], { w: 1.8, boilT, seed: seed + 1, wobble: 0.4, taper: 6 });
  inkEllipse(ctx, -len * 0.38, 0, 6, 1.8, { w: 1.4, boilT, seed: seed + 2, wobble: 0.2 });
  ctx.restore();
}

// ---------------------------------------------------------------------------------------------------- paper, cards, marks
const texCache = new Map();
/** Static paper texture (seeded fibres and tooth), cached per size. */
export function paperTexture(w, h, base = C.paper, seed = 7) {
  const key = `${w}x${h}${base}${seed}`; if (texCache.has(key)) return texCache.get(key);
  const cv = new OffscreenCanvas(w, h), x = cv.getContext('2d'), r = mulberry32(seed);
  x.fillStyle = base; x.fillRect(0, 0, w, h);
  const img = x.getImageData(0, 0, w, h), d = img.data;
  for (let i = 0; i < d.length; i += 4) { const n = (r() - 0.5) * 7; d[i] += n; d[i + 1] += n; d[i + 2] += n * 0.9; }
  x.putImageData(img, 0, 0);
  x.globalAlpha = 0.05; x.strokeStyle = '#8a836c'; x.lineWidth = 0.7;
  for (let i = 0; i < (w * h) / 5000; i++) { const px = r() * w, py = r() * h, a = r() * Math.PI, l = 6 + r() * 22; x.beginPath(); x.moveTo(px, py); x.quadraticCurveTo(px + Math.cos(a) * l * 0.5 + (r() - 0.5) * 6, py + Math.sin(a) * l * 0.5 + (r() - 0.5) * 6, px + Math.cos(a) * l, py + Math.sin(a) * l); x.stroke(); }
  // soft vignette
  x.globalAlpha = 1; const g = x.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75);
  g.addColorStop(0, 'rgba(120,110,80,0)'); g.addColorStop(1, 'rgba(120,110,80,0.07)'); x.fillStyle = g; x.fillRect(0, 0, w, h);
  texCache.set(key, cv); return cv;
}
export function roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }
/** A paper card like the site's: warm white, ink outline that boils, hard offset shadow. Drawn around (0,0) = top-left. */
export function card(ctx, x, y, w, h, o = {}) {
  const { r = 16, fill = C.card, outline = true, shadow = 0.12, boilT = 0, seed = 5, lw = 2.4, p = 1, tint = null } = o;
  if (shadow) { ctx.fillStyle = `rgba(32,33,30,${shadow})`; roundRect(ctx, x + 5, y + 7, w, h, r); ctx.fill(); }
  ctx.fillStyle = fill; roundRect(ctx, x, y, w, h, r); ctx.fill();
  if (tint) { ctx.fillStyle = tint; roundRect(ctx, x, y, w, h, r); ctx.fill(); }
  if (outline) inkRect(ctx, x, y, w, h, { w: lw, boilT, seed, p, over: 3, wobble: 0.7 });
}
/** Hand-drawn orange underline (the site's 5 px arc rotated -1.1°), revealed left to right. */
export function underline(ctx, x1, x2, y, o = {}) {
  const { p = 1, w = 9, color = C.orange, boilT = 0, seed = 31, sag = 7 } = o;
  const pts = []; for (let i = 0; i <= 40; i++) { const u = i / 40; pts.push([lerp(x1, x2, u), y - Math.sin(Math.PI * u) * sag + (u - 0.5) * (x2 - x1) * -0.019]); }
  inkStroke(ctx, pts, { w, color, boilT, seed, to: p, taper: 40, wobble: 0.8, rough: 0.1 });
}
/** Yellow highlighter swipe behind text, ragged ends, multiplied onto the paper. */
export function highlight(ctx, x, y, w, h, o = {}) {
  const { p = 1, color = '#ffe36e', seed = 41, alpha = 0.75 } = o; if (p <= 0) return;
  const r = mulberry32(seed), ww = w * p; ctx.save(); ctx.globalCompositeOperation = 'multiply'; ctx.globalAlpha = alpha; ctx.fillStyle = color; ctx.beginPath();
  ctx.moveTo(x + r() * 4, y + r() * 4);
  for (let i = 1; i <= 10; i++) ctx.lineTo(x + ww * i / 10, y + (r() - 0.5) * 3 - 1);
  ctx.lineTo(x + ww + 3, y + h * 0.5); ctx.lineTo(x + ww, y + h + (r() - 0.5) * 3);
  for (let i = 9; i >= 0; i--) ctx.lineTo(x + ww * i / 10, y + h + (r() - 0.5) * 3 + 1);
  ctx.closePath(); ctx.fill(); ctx.restore();
}
/** Orange check badge: circle pops (spring), then the tick draws. */
export function checkBadge(ctx, x, y, rad, p, o = {}) {
  if (p <= 0) return; const s = ease.spring(clamp(p * 1.6), 11, 0.45), q = clamp(p * 2 - 0.55);
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
  ctx.fillStyle = o.color || C.orange; ctx.beginPath(); ctx.arc(0, 0, rad, 0, Math.PI * 2); ctx.fill();
  if (q > 0) { ctx.strokeStyle = '#fff'; ctx.lineWidth = rad * 0.22; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.beginPath(); const pts = [[-rad * 0.42, 0.02 * rad], [-rad * 0.1, rad * 0.32], [rad * 0.45, -rad * 0.3]]; const L1 = 0.4, k = q; ctx.moveTo(...pts[0]); if (k < L1) ctx.lineTo(lerp(pts[0][0], pts[1][0], k / L1), lerp(pts[0][1], pts[1][1], k / L1)); else { ctx.lineTo(...pts[1]); const k2 = (k - L1) / (1 - L1); ctx.lineTo(lerp(pts[1][0], pts[2][0], k2), lerp(pts[1][1], pts[2][1], k2)); } ctx.stroke(); }
  ctx.restore();
}
/** Tally marks in groups of five, n marks drawn (fractional n draws the last one partly). */
export function tally(ctx, x, y, n, o = {}) {
  const { h = 54, gap = 17, group = 26, boilT = 0, seed = 51, w = 4.2, color = C.ink } = o;
  for (let i = 0; i < Math.ceil(n); i++) {
    const g = Math.floor(i / 5), k = i % 5, p = clamp(n - i), gx = x + g * (gap * 4 + group);
    if (k < 4) inkStroke(ctx, linePts(gx + k * gap, y + 2, gx + k * gap + 3, y + h, 1.5), { w, boilT, seed: seed + i, to: p, color });
    else inkStroke(ctx, linePts(gx - 10, y + h * 0.78, gx + gap * 3 + 12, y + h * 0.2, -3), { w, boilT, seed: seed + i, to: p, color });
  }
}

// ---------------------------------------------------------------------------------------------------- type
export function font(kind, size, weight) {
  if (kind === 'heavy') return `900 ${size}px ${F.heavy}`;
  if (kind === 'serif') return `italic 400 ${size}px ${F.serif}`;
  if (kind === 'serifRoman') return `400 ${size}px ${F.serif}`;
  if (kind === 'mono') return `${weight || 500} ${size}px ${F.mono}`;
  if (kind === 'hand') return `400 ${size}px '${F.hand}'`;
  return `${weight || 500} ${size}px ${F.sans}`;
}
/** Draw text with tracking (em units) and alignment; returns its width. */
export function text(ctx, str, x, y, o = {}) {
  const { kind = 'sans', size = 40, weight, color = C.ink, align = 'left', base = 'alphabetic', track = 0, alpha = 1, spread = 0 } = o;
  ctx.save(); ctx.globalAlpha *= alpha; ctx.font = font(kind, size, weight); ctx.fillStyle = color; ctx.textBaseline = base;
  ctx.letterSpacing = `${track * size}px`;
  const w = ctx.measureText(str).width; const dx = align === 'center' ? -w / 2 : align === 'right' ? -w : 0;
  ctx.textAlign = 'left'; ctx.fillText(str, x + dx, y);
  if (spread) { ctx.strokeStyle = color; ctx.lineWidth = spread * 2; ctx.lineJoin = 'round'; ctx.strokeText(str, x + dx, y); }
  ctx.restore(); return w;
}
export function measure(ctx, str, o = {}) {
  const { kind = 'sans', size = 40, weight, track = 0 } = o; ctx.save(); ctx.font = font(kind, size, weight); ctx.letterSpacing = `${track * size}px`; const w = ctx.measureText(str).width; ctx.restore(); return w;
}
/** Typewriter: the visible part of str at time t (seconds since start) at cps chars/s, with a human rhythm. */
export function typed(str, t, cps = 22, seed = 3) {
  if (t <= 0) return '';
  const r = mulberry32(seed); let acc = 0;
  for (let i = 0; i < str.length; i++) { acc += (1 / cps) * (0.55 + r() * 0.9) * (str[i] === ' ' ? 1.25 : 1) * (',.?'.includes(str[i]) ? 2.2 : 1); if (acc > t) return str.slice(0, i); }
  return str;
}
/** Times (s) at which each character of `str` is typed — use them for key-click SFX. */
export function typedTimes(str, cps = 22, seed = 3) {
  const r = mulberry32(seed); let acc = 0; const out = [];
  for (let i = 0; i < str.length; i++) { acc += (1 / cps) * (0.55 + r() * 0.9) * (str[i] === ' ' ? 1.25 : 1) * (',.?'.includes(str[i]) ? 2.2 : 1); out.push(acc); }
  return out;
}
/** Word-by-word "stamp": each word lands with a small overshoot. Returns layout widths. */
export function stampWords(ctx, words, x, y, t, o = {}) {
  const { kind = 'heavy', size = 120, gap = 0.26, stagger = 0.09, color = C.ink, align = 'left', track = -0.045, colors = [] } = o;
  const ws = words.map(w => measure(ctx, w, { kind: Array.isArray(kind) ? kind[0] : kind, size, track }));
  const kinds = words.map((_, i) => (Array.isArray(kind) ? kind[i] || kind[0] : kind));
  const widths = words.map((w, i) => measure(ctx, w, { kind: kinds[i], size, track }));
  const total = widths.reduce((a, b) => a + b, 0) + gap * size * (words.length - 1);
  let cx = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x;
  words.forEach((w, i) => {
    const p = clamp((t - i * stagger) / 0.32); if (p > 0) {
      const s = 1 + (1 - ease.outBack(p, 2.2)) * 0.18, a = clamp(p * 3);
      ctx.save(); ctx.translate(cx + widths[i] / 2, y); ctx.scale(s, s); ctx.translate(-widths[i] / 2, 0);
      text(ctx, w, 0, 0, { kind: kinds[i], size, color: colors[i] || color, track, alpha: a }); ctx.restore();
    }
    cx += widths[i] + gap * size;
  });
  void ws; return { total, widths };
}

// ---------------------------------------------------------------------------------------------------- images & camera
export function drawImage(ctx, img, x, y, w, h, o = {}) {
  const { alpha = 1, sx = 0, sy = 0, sw = img.width, sh = img.height, blend } = o;
  ctx.save(); ctx.globalAlpha *= alpha; if (blend) ctx.globalCompositeOperation = blend; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h); ctx.restore();
}
/** Apply a camera: the world point (cx, cy) lands at the frame centre at zoom z, rotated by rot. */
export function camera(ctx, W, H, { cx, cy, z = 1, rot = 0 }) { ctx.translate(W / 2, H / 2); ctx.rotate(rot); ctx.scale(z, z); ctx.translate(-cx, -cy); }
