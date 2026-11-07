// Loudness tools, no ffmpeg: ITU-R BS.1770-4 / EBU R128 integrated loudness (LUFS), max momentary (400 ms) and
// short-term (3 s) loudness, loudness range, sample peak and an oversampled true-peak estimate, plus gain
// normalisation and a look-ahead peak limiter. Any sample rate (K-weighting coefficients are derived per rate,
// matching libebur128 / pyloudnorm). Works on PCM (src/audio/pcm.js) and on a Web Audio AudioBuffer alike.

const dB = x => 20 * Math.log10(Math.max(x, 1e-12));

function kWeightCoeffs(sr) {
  // stage 1: high shelf (+4 dB above ~1.7 kHz)
  let f0 = 1681.974450955533, G = 3.999843853973347, Q = 0.7071752369554196;
  let K = Math.tan(Math.PI * f0 / sr);
  const Vh = Math.pow(10, G / 20), Vb = Math.pow(Vh, 0.4996667741545416);
  let a0 = 1 + K / Q + K * K;
  const shelf = { b: [(Vh + Vb * K / Q + K * K) / a0, 2 * (K * K - Vh) / a0, (Vh - Vb * K / Q + K * K) / a0], a: [2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0] };
  // stage 2: RLB high-pass (~38 Hz)
  f0 = 38.13547087602444; Q = 0.5003270373238773; K = Math.tan(Math.PI * f0 / sr);
  a0 = 1 + K / Q + K * K;
  const hp = { b: [1, -2, 1], a: [2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0] };
  return [shelf, hp];
}

function biquad(x, { b, a }) {
  const y = new Float64Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const xi = x[i], yi = b[0] * xi + b[1] * x1 + b[2] * x2 - a[0] * y1 - a[1] * y2;
    x2 = x1; x1 = xi; y2 = y1; y1 = yi; y[i] = yi;
  }
  return y;
}

/** Prefix sums of the summed (over channels) K-weighted power, so any window's mean square is O(1). */
function powerPrefix(buffer) {
  const sr = buffer.sampleRate, n = buffer.length, [shelf, hp] = kWeightCoeffs(sr);
  const pre = new Float64Array(n + 1);
  for (let c = 0; c < Math.min(buffer.numberOfChannels, 3); c++) {
    const y = biquad(biquad(buffer.getChannelData(c), shelf), hp);
    let acc = 0;
    for (let i = 0; i < n; i++) { acc += y[i] * y[i]; pre[i + 1] += acc; }
  }
  return pre;
}

const blockLoud = z => -0.691 + 10 * Math.log10(Math.max(z, 1e-20));

/** Mean squares of windows of `win` seconds every `hop` seconds. */
function windows(pre, sr, win, hop) {
  const W = Math.round(win * sr), H = Math.round(hop * sr), n = pre.length - 1, out = [];
  for (let s = 0; s + W <= n; s += H) out.push((pre[s + W] - pre[s]) / W);
  return out;
}

/** { integrated, momentaryMax, shortTermMax, lra, samplePeakDb, truePeakDb? } */
export function measure(buffer, { truePeak = true } = {}) {
  const sr = buffer.sampleRate, pre = powerPrefix(buffer);
  // integrated: 400 ms blocks, 75 % overlap, absolute gate -70 LUFS, relative gate -10 LU
  const z = windows(pre, sr, 0.4, 0.1);
  const abs = z.filter(v => blockLoud(v) > -70);
  const mean = a => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);
  const rel = blockLoud(mean(abs)) - 10;
  const gated = abs.filter(v => blockLoud(v) > rel);
  const integrated = gated.length ? blockLoud(mean(gated)) : -Infinity;
  const momentaryMax = z.length ? Math.max(...z.map(blockLoud)) : -Infinity;
  const st = windows(pre, sr, 3, 0.1);
  const shortTermMax = st.length ? Math.max(...st.map(blockLoud)) : momentaryMax;
  // loudness range (EBU Tech 3342): 3 s windows, abs gate -70, relative gate -20 LU, 10th..95th percentile
  const stAbs = st.filter(v => blockLoud(v) > -70), stRel = blockLoud(mean(stAbs)) - 20;
  const lra = (() => { const l = stAbs.filter(v => blockLoud(v) > stRel).map(blockLoud).sort((a, b) => a - b); if (l.length < 2) return 0; const q = p => l[Math.min(l.length - 1, Math.round(p * (l.length - 1)))]; return q(0.95) - q(0.10); })();
  let peak = 0;
  for (let c = 0; c < buffer.numberOfChannels; c++) { const d = buffer.getChannelData(c); for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > peak) peak = a; } }
  const res = { integrated, momentaryMax, shortTermMax, lra, samplePeakDb: dB(peak) };
  return truePeak ? { ...res, truePeakDb: truePeakDb(buffer) } : res;
}

/**
 * True-peak estimate (BS.1770 Annex 2 style): 4x oversampling by windowed-sinc interpolation of the points between
 * samples, 32 taps per phase, Hann window, each phase normalised to unit DC gain.
 */
export function truePeakDb(buffer, os = 4, half = 16) {
  const phases = [];
  for (let p = 1; p < os; p++) {
    const f = p / os, c = new Float64Array(2 * half); let s = 0;
    for (let k = 0; k < 2 * half; k++) {
      const i = k - half + 1, t = f - i; // weight of x[n + i] for the point at n + f
      const sinc = t === 0 ? 1 : Math.sin(Math.PI * t) / (Math.PI * t);
      const w = 0.5 * (1 + Math.cos(Math.PI * t / half));
      c[k] = sinc * w; s += c[k];
    }
    for (let k = 0; k < c.length; k++) c[k] /= s;
    phases.push(c);
  }
  let peak = 0;
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const x = buffer.getChannelData(ch), n = x.length;
    for (let i = 0; i < n; i++) { const a = Math.abs(x[i]); if (a > peak) peak = a; }
    for (let i = 0; i < n - 1; i++) {
      // cheap skip: in-between peaks are at most a few dB above their neighbours
      if (Math.max(Math.abs(x[i]), Math.abs(x[i + 1])) * 2.2 < peak) continue;
      for (const c of phases) {
        let y = 0;
        for (let k = 0; k < c.length; k++) { const j = i + k - half + 1; if (j >= 0 && j < n) y += x[j] * c[k]; }
        const a = Math.abs(y); if (a > peak) peak = a;
      }
    }
  }
  return dB(peak);
}

export function applyGain(buffer, gainDb) {
  const g = Math.pow(10, gainDb / 20);
  for (let c = 0; c < buffer.numberOfChannels; c++) { const d = buffer.getChannelData(c); for (let i = 0; i < d.length; i++) d[i] *= g; }
  return buffer;
}

/**
 * Look-ahead brickwall limiter, in place. The gain never exceeds what each sample needs (sliding minimum over the
 * look-ahead, then a box average of the same length, which can only lower it), and recovers with a one-pole release.
 */
export function limit(buffer, { ceilingDb = -1.5, lookaheadMs = 5, releaseMs = 120 } = {}) {
  const sr = buffer.sampleRate, n = buffer.length, ch = buffer.numberOfChannels, ceil = Math.pow(10, ceilingDb / 20);
  const L = Math.max(1, Math.round(lookaheadMs * sr / 1000));
  const data = [...Array(ch)].map((_, c) => buffer.getChannelData(c));
  const need = new Float32Array(n);
  for (let i = 0; i < n; i++) { let p = 0; for (let c = 0; c < ch; c++) { const a = Math.abs(data[c][i]); if (a > p) p = a; } need[i] = p > ceil ? ceil / p : 1; }
  // t[i] = min(need[i .. i+L]) with a monotonic deque
  const t = new Float32Array(n), dq = new Int32Array(n + L + 1); let h = 0, e = 0;
  for (let j = 0; j < n + L; j++) {
    if (j < n) { while (e > h && need[dq[e - 1]] >= need[j]) e--; dq[e++] = j; }
    const i = j - L;
    if (i >= 0) { while (dq[h] < i) h++; t[i] = need[dq[h]]; }
  }
  // g[i] = mean(t[i-L .. i]) <= need[i]
  const g = new Float32Array(n); let acc = 0;
  for (let i = 0; i < n; i++) { acc += t[i]; if (i - L - 1 >= 0) acc -= t[i - L - 1]; g[i] = acc / Math.min(i + 1, L + 1); }
  // release smoothing (only lets the gain rise slowly; never above g)
  const r = 1 - Math.exp(-1 / (releaseMs * sr / 1000));
  let gs = 1, reduced = 0, minGain = 1;
  for (let i = 0; i < n; i++) {
    gs = Math.min(g[i], gs + (g[i] - gs) * r);
    if (gs < 0.999) reduced++;
    if (gs < minGain) minGain = gs;
    for (let c = 0; c < ch; c++) data[c][i] *= gs;
  }
  return { limitedShare: reduced / n, maxReductionDb: -dB(minGain) };
}

/** Normalise in place to a target integrated loudness with a true-peak ceiling: gain, limit, re-measure, trim. */
export function normalize(buffer, { targetLufs = -14, ceilingDbtp = -1, lookaheadMs = 5, releaseMs = 120 } = {}) {
  const before = measure(buffer);
  applyGain(buffer, targetLufs - before.integrated);
  let lim = limit(buffer, { ceilingDb: ceilingDbtp - 0.5, lookaheadMs, releaseMs });
  let after = measure(buffer);
  // limiting removed a little loudness: nudge once more (small), then limit again
  if (Math.abs(after.integrated - targetLufs) > 0.2) {
    applyGain(buffer, targetLufs - after.integrated);
    lim = limit(buffer, { ceilingDb: ceilingDbtp - 0.5, lookaheadMs, releaseMs });
    after = measure(buffer);
  }
  if (after.truePeakDb > ceilingDbtp) { applyGain(buffer, ceilingDbtp - after.truePeakDb - 0.05); after = measure(buffer); }
  return { before, after, limitedShare: lim.limitedShare, maxReductionDb: lim.maxReductionDb };
}
