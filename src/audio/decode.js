// Any audio file → PCM at the mix rate, through ffmpeg (mp3, m4a, ogg, wav of any rate…). A WAV that already has
// the wanted rate is read directly.
import { spawn } from 'node:child_process';
import { extname } from 'node:path';
import { PCM } from './pcm.js';
import { readWav } from './wav.js';

export async function decode(path, { sampleRate = 48000, channels = 2, ffmpeg = process.env.MOTIGEN_FFMPEG || 'ffmpeg' } = {}) {
  if (extname(path).toLowerCase() === '.wav') {
    try {
      const w = await readWav(path);
      if (w.sampleRate === sampleRate) return channels === 2 ? w.toStereo() : channels === 1 ? w.toMono() : w;
    } catch { /* odd WAV: let ffmpeg read it */ }
  }
  const raw = await new Promise((res, rej) => {
    const chunks = []; let err = '';
    const p = spawn(ffmpeg, ['-v', 'error', '-i', path, '-f', 'f32le', '-acodec', 'pcm_f32le', '-ac', String(channels), '-ar', String(sampleRate), '-'], { stdio: ['ignore', 'pipe', 'pipe'] });
    p.stdout.on('data', d => chunks.push(d)); p.stderr.on('data', d => { err += d; });
    p.on('error', e => rej(e.code === 'ENOENT' ? new Error(`${ffmpeg} not found: install ffmpeg and put it in PATH (or set $MOTIGEN_FFMPEG)`) : e));
    p.on('close', code => (code === 0 ? res(Buffer.concat(chunks)) : rej(new Error(`ffmpeg could not decode ${path}: ${err.trim()}`))));
  });
  const n = Math.floor(raw.length / 4 / channels), f = new Float32Array(raw.buffer, raw.byteOffset, n * channels);
  const out = [...Array(channels)].map(() => new Float32Array(n));
  for (let i = 0; i < n; i++) for (let c = 0; c < channels; c++) out[c][i] = f[i * channels + c];
  return new PCM(out, sampleRate);
}
