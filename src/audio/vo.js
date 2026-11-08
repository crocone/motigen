// Voice lines. One file per line in <audio>/vo/ (L01.wav, L02.wav, …) plus vo.json [{id, dur, text, speechStart,
// speechEnd}]. They come from one of:
//   tts     one ElevenLabs call for the whole script (with character timestamps), split on the alignment
//   split   an ElevenLabs with-timestamps response saved earlier (resp.json) → the same split
//   import  wav files you recorded or generated elsewhere, named in order (any names, sorted)
// and `check` flags lines where the TTS went breathy or garbled (spectral flatness over the voiced frames).
import { readFile, writeFile, mkdir, readdir, unlink } from 'node:fs/promises';
import { join, basename, extname } from 'node:path';
import { PCM, envelope, speechSpan } from './pcm.js';
import { decode } from './decode.js';
import { writeWav } from './wav.js';

export const SR = 48000;
export const id = i => `L${String(i + 1).padStart(2, '0')}`;

export async function readLines(file) {
  return (await readFile(file, 'utf8')).split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith('#'));
}

export const ELEVENLABS = {
  model: 'eleven_v4',
  settings: { stability: 0.6, similarity_boost: 0.75, style: 0, use_speaker_boost: true, speed: 1.0 },
};

const NO_KEY = 'ELEVENLABS_API_KEY is not set. Get a key at elevenlabs.io (profile → API keys) and put a line\n  ELEVENLABS_API_KEY=sk_…\ninto a file named .env in the project folder (next to motigen.json), or export it in your shell.';
const NO_VOICE = 'no voice id: run `motigen vo voices` to list your voices, then put one into motigen.json: "vo": { "voice": "<id>" } (or pass --voice)';

/** The voices of the account: [{ id, name, labels }]. */
export async function listVoices({ apiKey = process.env.ELEVENLABS_API_KEY, fetchImpl = fetch } = {}) {
  if (!apiKey) throw new Error(NO_KEY);
  const r = await fetchImpl('https://api.elevenlabs.io/v1/voices', { headers: { 'xi-api-key': apiKey } });
  if (!r.ok) throw new Error(`ElevenLabs ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const { voices = [] } = await r.json();
  return voices.map(v => ({ id: v.voice_id, name: v.name, labels: Object.values(v.labels || {}).join(', ') }));
}

/** One ElevenLabs text-to-speech call with timestamps for the whole script. Returns the parsed response. */
export async function elevenlabs(text, { apiKey = process.env.ELEVENLABS_API_KEY, voice, model = ELEVENLABS.model, settings = ELEVENLABS.settings, seed, fetchImpl = fetch } = {}) {
  if (!apiKey) throw new Error(NO_KEY);
  if (!voice) throw new Error(NO_VOICE);
  const r = await fetchImpl(`https://api.elevenlabs.io/v1/text-to-speech/${voice}/with-timestamps?output_format=pcm_48000`, {
    method: 'POST', headers: { 'xi-api-key': apiKey, 'content-type': 'application/json' },
    body: JSON.stringify({ text, model_id: model, voice_settings: settings, ...(seed != null ? { seed } : {}) }),
  });
  if (!r.ok) throw new Error(`ElevenLabs ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return r.json();
}

/**
 * Split one with-timestamps response (pcm_48000) into one wav per line, cut at the quietest point between lines
 * (the alignment runs a little late), silence trimmed. Writes <out>/L01.wav… and <out>/vo.json.
 */
export async function splitResponse(resp, lines, out, { meta = {} } = {}) {
  const raw = Buffer.from(resp.audio_base64, 'base64');
  const n = Math.floor(raw.length / 2), pcm = new Float32Array(n);
  for (let i = 0; i < n; i++) pcm[i] = raw.readInt16LE(i * 2); // kept in int16 units, like the thresholds below
  const al = resp.normalized_alignment || resp.alignment;
  if (!al) throw new Error('the response has no alignment: call with-timestamps');
  const text = al.characters.join(''), st = al.character_start_times_seconds, en = al.character_end_times_seconds;
  const idx = []; let pos = 0;
  for (const l of lines) {
    const i = text.indexOf(l.slice(0, 12), pos);
    if (i < 0) throw new Error(`line not found in the alignment: "${l.slice(0, 40)}…" (the TTS text must be the lines joined by newlines)`);
    const j = i + l.length - 1; idx.push([i, Math.min(j, text.length - 1)]); pos = j;
  }
  const env = envelope(pcm, 960);
  const cuts = [0];
  for (let k = 0; k < idx.length - 1; k++) {
    // The alignment runs late (0.1-0.2 s), so the cut is searched between a little before the line's aligned end and
    // just before the next line's aligned start, never inside it.
    const lo = Math.max(0, Math.floor((en[idx[k][1]] - 0.3) * SR)), hi = Math.max(lo + 1, Math.floor((st[idx[k + 1][0]] - 0.03) * SR));
    let best = lo; for (let i = lo; i < Math.min(hi, n); i++) if (env[i] < env[best]) best = i;
    cuts.push(best);
  }
  cuts.push(n);
  await mkdir(out, { recursive: true });
  const rows = [];
  for (let k = 0; k < lines.length; k++) {
    let seg = pcm.subarray(cuts[k], cuts[k + 1]);
    const e = envelope(seg, 480); let a = -1, b = -1;
    for (let i = 0; i < e.length; i++) if (e[i] > 120) { if (a < 0) a = i; b = i; }
    if (a >= 0) seg = seg.subarray(Math.max(0, a - 1200), Math.min(seg.length, b + 2400));
    const f = new Float32Array(seg.length); for (let i = 0; i < seg.length; i++) f[i] = seg[i] / 32768;
    const clip = new PCM([f], SR), name = id(k);
    await writeWav(join(out, `${name}.wav`), clip);
    rows.push({ id: name, dur: +clip.duration.toFixed(3), text: lines[k], ...speechSpan(clip) });
  }
  await writeFile(join(out, 'vo.json'), JSON.stringify({ ...meta, lines: rows }, null, 1));
  return rows;
}

/** TTS for a lines file: one call, saved as <out>/resp.json, then split. */
export async function tts(linesFile, out, opts = {}) {
  const lines = await readLines(linesFile);
  if (!lines.length) throw new Error(`${linesFile} has no lines`);
  const resp = await elevenlabs(lines.join('\n'), opts);
  await mkdir(out, { recursive: true });
  await writeFile(join(out, 'resp.json'), JSON.stringify(resp));
  return splitResponse(resp, lines, out, { meta: { provider: 'elevenlabs', voice: opts.voice, model: opts.model || ELEVENLABS.model, seed: opts.seed ?? null, settings: opts.settings || ELEVENLABS.settings } });
}

/** vo.json for audio files already in `dir` (any format), in sorted order, one per line. Files become L01.wav… (the originals are removed). */
export async function importDir(dir, linesFile, { rename = true } = {}) {
  const lines = linesFile ? await readLines(linesFile) : [];
  const files = (await readdir(dir)).filter(f => /\.(wav|mp3|m4a|ogg|flac|webm)$/i.test(f) && !/^L\d+\.wav$/.test(f)).sort();
  const existing = (await readdir(dir)).filter(f => /^L\d+\.wav$/.test(f)).sort();
  const src = files.length ? files : existing;
  if (!src.length) throw new Error(`no audio files in ${dir}`);
  if (lines.length && lines.length !== src.length) throw new Error(`${src.length} files but ${lines.length} lines`);
  const rows = [];
  for (let k = 0; k < src.length; k++) {
    const name = id(k), clip = (await decode(join(dir, src[k]), { channels: 1 }));
    if (rename && src[k] !== `${name}.wav`) { await writeWav(join(dir, `${name}.wav`), clip); await unlink(join(dir, src[k])); }
    rows.push({ id: name, dur: +clip.duration.toFixed(3), text: lines[k] || basename(src[k], extname(src[k])), ...speechSpan(clip) });
  }
  await writeFile(join(dir, 'vo.json'), JSON.stringify({ provider: 'import', lines: rows }, null, 1));
  return rows;
}

// ---------- quality check: spectral flatness over the voiced frames ----------
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2, tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}

/** Median spectral flatness of the voiced frames (a clean voice has harmonics → low; whisper or noise → high). */
export function flatness(pcm) {
  const x = pcm.toMono().channels[0], n = 2048, hop = 512, flats = [];
  const win = new Float32Array(n); for (let i = 0; i < n; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1));
  const re = new Float64Array(n), im = new Float64Array(n);
  for (let s = 0; s + n <= x.length; s += hop) {
    let rms = 0; for (let i = 0; i < n; i++) { re[i] = x[s + i] * win[i]; im[i] = 0; rms += x[s + i] * x[s + i]; }
    if (Math.sqrt(rms / n) < 0.02) continue; // pauses
    fft(re, im);
    let lg = 0, am = 0, cnt = 0;
    for (let k = 5; k < 400; k++) { const p = re[k] * re[k] + im[k] * im[k] + 1e-12; lg += Math.log(p); am += p; cnt++; } // ~120 Hz–9 kHz at 48 kHz
    flats.push(Math.exp(lg / cnt) / (am / cnt));
  }
  if (!flats.length) return 1;
  flats.sort((a, b) => a - b);
  return flats[Math.floor(flats.length / 2)];
}

export async function check(dir, { limit = 0.12 } = {}) {
  const files = (await readdir(dir)).filter(f => /^L\d+\.wav$/.test(f)).sort();
  const rows = [];
  for (const f of files) { const m = flatness(await decode(join(dir, f), { channels: 1 })); rows.push({ id: basename(f, '.wav'), flatness: +m.toFixed(3), ok: m <= limit }); }
  return rows;
}
