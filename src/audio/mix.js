// The mix: voice lines, sound effects and a music bed laid out by the timeline's events, the bed ducked under the
// voice, the master normalised to a loudness target. Everything is read from the project's audio folder:
//   events.json   from `motigen events`: { dur, vo: [{id, t}], clicks: [t], keys: [t], enters: [t], sfx: [{id, t, db?}] }
//   vo/<id>.wav   one file per voice line (+ vo.json from `motigen vo`)
//   sfx/<id>.wav  click.wav / key.wav / enter.wav and any id used in events.sfx; sfx.json may give each a `hit`
//                 (seconds of the transient inside the file) so the transient lands on the event. Missing click /
//                 key / enter are synthesised.
//   bed.wav       the music (any format), optional
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { PCM, gain, dB } from './pcm.js';
import { decode } from './decode.js';
import { writeWav } from './wav.js';
import { measure, normalize } from './loudness.js';

export const SR = 48000;

export const MIX_DEFAULTS = {
  tail: 0.5,             // seconds of room after the last frame
  voiceDb: -3,           // each line peak-normalised to this
  clickDb: -14, keyDb: -27, keyJitterDb: [-3, 2], enterDb: -18,
  bedRmsDb: -36,         // the bed's level before ducking (RMS)
  bedLoopFrom: 8,        // when the bed is shorter than the film it loops from this second on, with a crossfade
  bedCrossfade: 2, bedFadeOut: 3,
  duckDb: -9, duckAttack: 0.12, duckRelease: 0.45, duckGate: 0.01,
  target: { lufs: -14, dbtp: -1, lra: 11 },
  master: 'loudnorm',    // 'loudnorm': ffmpeg's two-pass EBU R128 normaliser (dynamic when a linear gain cannot
                         // reach the target under the peak ceiling); 'limiter': a linear gain and a look-ahead limiter
};

function ffmpegRun(ffmpeg, args) {
  return new Promise((res, rej) => {
    let err = '';
    const p = spawn(ffmpeg, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    p.stderr.on('data', d => { err += d; });
    p.on('error', e => rej(e.code === 'ENOENT' ? new Error(`${ffmpeg} not found: install ffmpeg and put it in PATH (or set $MOTIGEN_FFMPEG)`) : e));
    p.on('close', code => (code === 0 ? res(err) : rej(new Error(`ffmpeg exited with ${code}\n${err.trim()}`))));
  });
}

/** ffmpeg loudnorm in two passes (measure, then normalise with the measured values). */
export async function loudnorm(input, output, { lufs = -14, dbtp = -1, lra = 11, ffmpeg = process.env.MOTIGEN_FFMPEG || 'ffmpeg' } = {}) {
  const base = `loudnorm=I=${lufs}:TP=${dbtp}:LRA=${lra}`;
  const err = await ffmpegRun(ffmpeg, ['-hide_banner', '-nostats', '-i', input, '-af', `${base}:print_format=json`, '-f', 'null', '-']);
  const m = JSON.parse(err.slice(err.lastIndexOf('{'), err.lastIndexOf('}') + 1));
  const af = `${base}:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`;
  await ffmpegRun(ffmpeg, ['-v', 'error', '-y', '-i', input, '-af', af, '-ar', String(SR), output]);
  return m;
}

// Deterministic jitter for key presses (an LCG; the numbers only need to differ from one another).
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }

const norm = p => (p.peak() > 1e-6 ? p.scale(1 / p.peak()) : p);

/** Procedural click / key / enter sounds for projects without recorded ones. */
export function synthSfx(id, sr = SR) {
  const r = rng(id === 'enter' ? 11 : id === 'key' ? 5 : 3);
  const dur = id === 'enter' ? 0.09 : id === 'key' ? 0.05 : 0.06, n = Math.round(dur * sr), x = new Float32Array(n);
  const f0 = id === 'enter' ? 1400 : id === 'key' ? 2600 : 3200, decay = id === 'enter' ? 40 : 90;
  for (let i = 0; i < n; i++) { const t = i / sr; x[i] = (0.6 * Math.sin(2 * Math.PI * f0 * t) + 0.8 * (r() * 2 - 1)) * Math.exp(-decay * t); }
  return norm(new PCM([x], sr).toStereo());
}

/**
 * @param {object} o
 * @param {string} o.dir        the audio folder
 * @param {object} [o.events]   parsed events.json (default: read from dir)
 * @param {string} [o.out]      default <dir>/mix.wav
 * @param {object} [o.cfg]      overrides of MIX_DEFAULTS
 * @param {(line: string) => void} [o.log]
 */
export async function mix({ dir, events, out, cfg = {}, log = () => {}, ffmpeg = process.env.MOTIGEN_FFMPEG || 'ffmpeg' }) {
  const C = { ...MIX_DEFAULTS, ...cfg, target: { ...MIX_DEFAULTS.target, ...(cfg.target || {}) } };
  events ||= JSON.parse(await readFile(join(dir, 'events.json'), 'utf8'));
  out ||= join(dir, 'mix.wav');
  const N = Math.ceil((events.dur + C.tail) * SR);
  const voice = PCM.silent(N), fx = PCM.silent(N);
  const report = { dur: events.dur, vo: [], sfx: 0, bed: null, missing: [] };

  // voice: each line peak-normalised
  for (const v of events.vo || []) {
    const f = join(dir, 'vo', `${v.id}.wav`);
    if (!existsSync(f)) { report.missing.push(`vo/${v.id}.wav`); continue; }
    const x = await decode(f);
    voice.add(x, v.t, gain(C.voiceDb) / Math.max(1e-6, x.peak()));
    report.vo.push({ id: v.id, t: v.t, dur: +x.duration.toFixed(3) });
  }

  // effects: a library by id (file + the transient's position), click / key / enter synthesised when missing
  const lib = existsSync(join(dir, 'sfx', 'sfx.json')) ? JSON.parse(await readFile(join(dir, 'sfx', 'sfx.json'), 'utf8')) : {};
  const cache = new Map();
  const sfx = async id => {
    if (cache.has(id)) return cache.get(id);
    const meta = lib[id] || {};
    const f = meta.file ? join(dir, 'sfx', meta.file) : join(dir, 'sfx', `${id}.wav`);
    let entry = null;
    if (existsSync(f)) entry = { pcm: norm(await decode(f)), hit: meta.hit || 0 };
    else if (['click', 'key', 'enter'].includes(id)) { entry = { pcm: synthSfx(id), hit: 0 }; if (!cache.has('__synth')) { log('sfx: no sfx/click.wav, key.wav, enter.wav: synthesised'); cache.set('__synth', 1); } }
    else report.missing.push(`sfx/${id}.wav`);
    cache.set(id, entry);
    return entry;
  };
  // the transient at `hit` lands on the event; a hit later than the event itself cuts the head of the file
  const place = async (id, t, db) => { const e = await sfx(id); if (!e) return; const at = t - e.hit; if (at >= 0) fx.add(e.pcm, at, gain(db)); else fx.add(e.pcm.slice(Math.round(-at * SR)), 0, gain(db)); report.sfx++; };
  const jitter = rng(7);
  for (const t of events.clicks || []) await place('click', t, C.clickDb);
  for (const t of events.keys || []) await place('key', t, C.keyDb + C.keyJitterDb[0] + jitter() * (C.keyJitterDb[1] - C.keyJitterDb[0]));
  for (const t of events.enters || []) await place('enter', t, C.enterDb);
  for (const s of events.sfx || []) await place(s.id, s.t, s.db ?? -12);

  // music: the bed, looped with a crossfade if the film is longer, faded out at the end, ducked under the voice
  let music = null;
  const bedFile = ['bed.wav', 'bed.mp3', 'bed.m4a', 'bed.ogg', 'bed.flac'].map(f => join(dir, f)).find(existsSync);
  if (bedFile) {
    const bed = await decode(bedFile);
    let m = bed.clone();
    // the crossfade never exceeds half the bed, and the loop point leaves at least that much tail, so every pass
    // appends something even for a short sting
    const xf = Math.min(Math.round(C.bedCrossfade * SR), Math.floor(bed.length / 2));
    const loopFrom = Math.round(C.bedLoopFrom * SR);
    const from = loopFrom + 2 * xf <= bed.length ? loopFrom : 0;   // a bed shorter than that loops as a whole
    let guard = 0;
    while (m.length < N && guard++ < 1000) {
      const tail = bed.slice(from), len = m.length;
      const next = PCM.silent(len - xf + tail.length);
      for (let c = 0; c < 2; c++) {
        next.channels[c].set(m.channels[c].subarray(0, len - xf));
        for (let i = 0; i < xf; i++) { const k = i / xf; next.channels[c][len - xf + i] = m.channels[c][len - xf + i] * (1 - k) + tail.channels[c][i] * k; }
        next.channels[c].set(tail.channels[c].subarray(xf), len);
      }
      m = next;
    }
    music = m.slice(0, N);
    if (music.length < N) { const p = PCM.silent(N); p.add(music, 0); music = p; }
    const fade = Math.min(N, Math.round(C.bedFadeOut * SR));
    for (let c = 0; c < 2; c++) for (let i = 0; i < fade; i++) music.channels[c][N - fade + i] *= 1 - i / fade;
    music.scale(gain(C.bedRmsDb) / Math.max(1e-6, music.rms()));
    // duck under the voice: a gate from the voice envelope, then attack / release smoothing
    const env = new Float32Array(N);
    for (let i = 0; i < N; i++) env[i] = Math.max(Math.abs(voice.channels[0][i]), Math.abs(voice.channels[1][i]));
    const win = Math.round(0.05 * SR), h = Math.floor(win / 2), pre = new Float64Array(N + 1);
    for (let i = 0; i < N; i++) pre[i + 1] = pre[i] + env[i];
    const low = gain(C.duckDb), a = 1 - Math.exp(-1 / (C.duckAttack * SR)), r = 1 - Math.exp(-1 / (C.duckRelease * SR));
    let cur = 1;
    for (let i = 0; i < N; i++) {
      const lo = Math.max(0, i - h), hi = Math.min(N, i - h + win);
      const target = (pre[hi] - pre[lo]) / win > C.duckGate ? low : 1;
      cur += (target - cur) * (target < cur ? a : r);
      music.channels[0][i] *= cur; music.channels[1][i] *= cur;
    }
    report.bed = { file: bedFile, dur: +bed.duration.toFixed(2), looped: bed.length < N };
  }

  const master = PCM.silent(N);
  master.add(voice).add(fx); if (music) master.add(music);
  const raw = join(dir, 'mix-raw.wav');
  await writeWav(raw, master);
  const before = measure(master, { truePeak: false });
  report.out = out; report.inputLufs = +before.integrated.toFixed(2); report.master = C.master;
  if (C.master === 'limiter') {
    const nr = normalize(master, { targetLufs: C.target.lufs, ceilingDbtp: C.target.dbtp });
    await writeWav(out, master);
    report.lufs = +nr.after.integrated.toFixed(2); report.truePeakDb = +nr.after.truePeakDb.toFixed(2); report.limited = +(nr.limitedShare * 100).toFixed(2);
  } else {
    await loudnorm(raw, out, { lufs: C.target.lufs, dbtp: C.target.dbtp, lra: C.target.lra, ffmpeg });
    const m = measure(await decode(out, { ffmpeg }));
    report.lufs = +m.integrated.toFixed(2); report.truePeakDb = +m.truePeakDb.toFixed(2); report.lra = +m.lra.toFixed(1);
  }
  return report;
}

export { measure, dB };
