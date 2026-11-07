// A sound in memory: planar Float32 channels at one sample rate. The same shape as a Web Audio AudioBuffer
// (sampleRate, length, numberOfChannels, getChannelData), so the loudness code runs on both.
export class PCM {
  /** @param {Float32Array[]} channels @param {number} sampleRate */
  constructor(channels, sampleRate) {
    if (!channels.length) throw new Error('PCM: no channels');
    this.channels = channels; this.sampleRate = sampleRate;
  }
  static silent(length, numberOfChannels = 2, sampleRate = 48000) {
    return new PCM([...Array(numberOfChannels)].map(() => new Float32Array(length)), sampleRate);
  }
  get length() { return this.channels[0].length; }
  get numberOfChannels() { return this.channels.length; }
  get duration() { return this.length / this.sampleRate; }
  getChannelData(c) { return this.channels[c]; }
  /** Stereo: mono is duplicated (a copy, so in-place edits stay per channel), extra channels are dropped. */
  toStereo() { return this.numberOfChannels === 2 ? this : new PCM([this.channels[0], this.channels[1] || this.channels[0].slice()], this.sampleRate); }
  toMono() { if (this.numberOfChannels === 1) return this; const n = this.length, m = new Float32Array(n); for (const ch of this.channels) for (let i = 0; i < n; i++) m[i] += ch[i] / this.numberOfChannels; return new PCM([m], this.sampleRate); }
  slice(from, to = this.length) { return new PCM(this.channels.map(c => c.slice(from, to)), this.sampleRate); }
  clone() { return new PCM(this.channels.map(c => c.slice()), this.sampleRate); }
  peak() { let p = 0; for (const c of this.channels) for (let i = 0; i < c.length; i++) { const a = Math.abs(c[i]); if (a > p) p = a; } return p; }
  rms() { let s = 0, n = 0; for (const c of this.channels) { for (let i = 0; i < c.length; i++) s += c[i] * c[i]; n += c.length; } return Math.sqrt(s / Math.max(1, n)); }
  scale(g) { for (const c of this.channels) for (let i = 0; i < c.length; i++) c[i] *= g; return this; }
  /** Add `src` (same rate) into this at `at` seconds, with a gain. */
  add(src, at = 0, gain = 1) {
    const i0 = Math.floor(at * this.sampleRate), n = Math.min(src.length, this.length - i0);
    if (n <= 0 || i0 < 0) return this;
    for (let c = 0; c < this.numberOfChannels; c++) {
      const d = this.channels[c], s = src.channels[Math.min(c, src.numberOfChannels - 1)];
      for (let i = 0; i < n; i++) d[i0 + i] += s[i] * gain;
    }
    return this;
  }
}

export const dB = v => 20 * Math.log10(Math.max(v, 1e-12));
export const gain = db => Math.pow(10, db / 20);

/** Box-filtered absolute value (moving average of |x| over `win` samples, centred), like numpy convolve 'same'. */
export function envelope(x, win) {
  const n = x.length, out = new Float32Array(n), h = Math.floor(win / 2);
  const pre = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + Math.abs(x[i]);
  for (let i = 0; i < n; i++) { const a = Math.max(0, i - h), b = Math.min(n, i - h + win); out[i] = (pre[b] - pre[a]) / win; }
  return out;
}

/** Speech span [start, end] in seconds from a 10 ms RMS envelope with a threshold relative to the clip's peak. */
export function speechSpan(pcm, { belowPeakDb = 36 } = {}) {
  const x = pcm.toMono().channels[0], sr = pcm.sampleRate, hop = Math.round(sr * 0.01);
  const r = [];
  for (let i = 0; i + hop <= x.length; i += hop) { let s = 0; for (let k = i; k < i + hop; k++) s += x[k] * x[k]; r.push(Math.sqrt(s / hop)); }
  const th = Math.max(...r) * gain(-belowPeakDb);
  let a = r.findIndex(v => v > th), b = r.length - 1; while (b > 0 && r[b] <= th) b--;
  if (a < 0) return { speechStart: 0, speechEnd: pcm.duration };
  return { speechStart: +(a * hop / sr).toFixed(3), speechEnd: +Math.min(pcm.duration, (b + 1) * hop / sr).toFixed(3) };
}
