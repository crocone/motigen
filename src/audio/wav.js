// WAV in and out: PCM 8/16/24/32-bit integer and 32/64-bit float, mono or multichannel, plain or extensible header.
import { readFile, writeFile } from 'node:fs/promises';
import { PCM } from './pcm.js';

export function parseWav(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const tag = (o) => String.fromCharCode(buf[o], buf[o + 1], buf[o + 2], buf[o + 3]);
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('not a WAV file');
  let o = 12, fmt = null, data = null;
  while (o + 8 <= buf.length) {
    const id = tag(o), size = dv.getUint32(o + 4, true), body = o + 8;
    if (id === 'fmt ') {
      fmt = { format: dv.getUint16(body, true), channels: dv.getUint16(body + 2, true), sampleRate: dv.getUint32(body + 4, true), bits: dv.getUint16(body + 14, true) };
      if (fmt.format === 0xfffe && size >= 26) fmt.format = dv.getUint16(body + 24, true); // WAVE_FORMAT_EXTENSIBLE: the sub-format GUID starts with the real tag
    } else if (id === 'data') { data = { start: body, size: Math.min(size, buf.length - body) }; }
    o = body + size + (size & 1);
    if (fmt && data) break;
  }
  if (!fmt || !data) throw new Error('WAV without fmt/data chunks');
  const { channels, sampleRate, bits, format } = fmt, bytes = bits / 8, frames = Math.floor(data.size / (bytes * channels));
  const out = [...Array(channels)].map(() => new Float32Array(frames));
  let p = data.start;
  const read = format === 3
    ? (bits === 32 ? () => { const v = dv.getFloat32(p, true); p += 4; return v; } : () => { const v = dv.getFloat64(p, true); p += 8; return v; })
    : bits === 16 ? () => { const v = dv.getInt16(p, true) / 32768; p += 2; return v; }
    : bits === 24 ? () => { const v = ((buf[p] | (buf[p + 1] << 8) | (buf[p + 2] << 16)) << 8 >> 8) / 8388608; p += 3; return v; }
    : bits === 32 ? () => { const v = dv.getInt32(p, true) / 2147483648; p += 4; return v; }
    : bits === 8 ? () => { const v = (buf[p] - 128) / 128; p += 1; return v; }
    : null;
  if (!read) throw new Error(`WAV: unsupported format ${format} / ${bits} bit`);
  for (let i = 0; i < frames; i++) for (let c = 0; c < channels; c++) out[c][i] = read();
  return new PCM(out, sampleRate);
}

export async function readWav(path) { return parseWav(await readFile(path)); }

/** @param {PCM} pcm  16-bit by default; `float: true` writes 32-bit float. */
export function encodeWav(pcm, { float = false } = {}) {
  const n = pcm.length, ch = pcm.numberOfChannels, sr = pcm.sampleRate, bytes = float ? 4 : 2;
  const buf = Buffer.alloc(44 + n * ch * bytes), dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  buf.write('RIFF', 0); dv.setUint32(4, 36 + n * ch * bytes, true); buf.write('WAVE', 8); buf.write('fmt ', 12);
  dv.setUint32(16, 16, true); dv.setUint16(20, float ? 3 : 1, true); dv.setUint16(22, ch, true); dv.setUint32(24, sr, true);
  dv.setUint32(28, sr * ch * bytes, true); dv.setUint16(32, ch * bytes, true); dv.setUint16(34, bytes * 8, true); buf.write('data', 36); dv.setUint32(40, n * ch * bytes, true);
  let o = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) {
    const v = Math.max(-1, Math.min(1, pcm.channels[c][i]));
    if (float) { dv.setFloat32(o, v, true); o += 4; } else { dv.setInt16(o, Math.max(-32768, Math.min(32767, Math.round(v * 32768))), true); o += 2; }
  }
  return buf;
}

export async function writeWav(path, pcm, o) { await writeFile(path, encodeWav(pcm, o)); }
