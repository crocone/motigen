// Motion helpers for pages that draw frame t: easing, progress, staggers, a seeded random source, a typewriter
// with a human rhythm, number formatting. Everything is a pure function of its inputs.
export const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, k) => a + (b - a) * k;
/** 0 → 1 as t goes from a to b, clamped. */
export const prog = (t, a, b) => (b <= a ? (t >= b ? 1 : 0) : clamp((t - a) / (b - a)));

export const ease = {
  linear: k => k,
  in: k => k * k * k,
  out: k => 1 - Math.pow(1 - k, 3),
  inOut: k => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2),
  outExpo: k => (k >= 1 ? 1 : 1 - Math.pow(2, -10 * k)),
  outQuart: k => 1 - Math.pow(1 - k, 4),
  outBack: (k, s = 1.70158) => 1 + (s + 1) * Math.pow(k - 1, 3) + s * Math.pow(k - 1, 2),
  outElastic: k => (k <= 0 ? 0 : k >= 1 ? 1 : Math.pow(2, -10 * k) * Math.sin((k * 10 - 0.75) * (2 * Math.PI / 3)) + 1),
  /** A critically damped spring settling from 0 to 1 over about one unit of k. */
  spring: (k, w = 9) => (k >= 1 ? 1 : 1 - (1 + w * k) * Math.exp(-w * k)),
};

/** The start of item i in a stagger. */
export const stagger = (i, step, start = 0) => start + i * step;

/** mulberry32: a small seeded random source. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Times (seconds from the start) at which each character of `str` is typed at `cps`, with a human rhythm. */
export function typedTimes(str, cps = 22, seed = 3) {
  const r = rng(seed); let acc = 0; const out = [];
  for (let i = 0; i < str.length; i++) {
    acc += (1 / cps) * (0.55 + r() * 0.9) * (str[i] === ' ' ? 1.25 : 1) * (',.?'.includes(str[i]) ? 2.2 : 1);
    out.push(acc);
  }
  return out;
}
/** The part of `str` typed by `t`, given its times. */
export function typedAt(str, times, t) { let n = 0; while (n < times.length && times[n] <= t) n++; return str.slice(0, n); }

/** 1234567.891 → "1,234,567.89"; `sep` and `decimals` adjustable. */
export function fmtNumber(v, { decimals = 0, sep = ',', point = '.' } = {}) {
  const [i, f] = Math.abs(v).toFixed(decimals).split('.');
  return (v < 0 ? '-' : '') + i.replace(/\B(?=(\d{3})+(?!\d))/g, sep) + (f ? point + f : '');
}

/** Split text into words, keeping each space with the word before it. */
export const splitWords = text => text.split(/(?<=\S)\s+(?=\S)/);
