import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PCM, envelope, speechSpan } from '../src/audio/pcm.js';
import { encodeWav, parseWav, writeWav, readWav } from '../src/audio/wav.js';
import { measure, normalize } from '../src/audio/loudness.js';
import { mix, synthSfx } from '../src/audio/mix.js';
import { splitResponse, flatness } from '../src/audio/vo.js';
import { srt } from '../src/audio/srt.js';

const SR = 48000;
const sine = (f, sec, amp = 1, sr = SR) => { const x = new Float32Array(Math.round(sec * sr)); for (let i = 0; i < x.length; i++) x[i] = amp * Math.sin(2 * Math.PI * f * i / sr); return x; };

test('wav round-trips 16-bit samples exactly', () => {
  const x = new Float32Array([0, 0.5, -0.5, 1, -1, 1 / 32768, -3 / 32768]);
  const back = parseWav(encodeWav(new PCM([x, x], SR)));
  assert.equal(back.sampleRate, SR); assert.equal(back.numberOfChannels, 2); assert.equal(back.length, x.length);
  for (let i = 0; i < x.length; i++) assert.ok(Math.abs(back.channels[1][i] - Math.max(-1, Math.min(32767 / 32768, x[i]))) < 1e-6, `sample ${i}`);
  const f = parseWav(encodeWav(new PCM([x], SR), { float: true }));
  assert.deepEqual([...f.channels[0]], [...x]);
});

test('a stereo 1 kHz sine at -20 dBFS measures -20 LUFS', () => {
  const x = sine(1000, 5, Math.pow(10, -20 / 20));
  const m = measure(new PCM([x, x], SR));
  assert.ok(Math.abs(m.integrated + 20) < 0.15, `integrated ${m.integrated}`);
  assert.ok(Math.abs(m.samplePeakDb + 20) < 0.05);
  assert.ok(m.truePeakDb >= m.samplePeakDb - 0.01 && m.truePeakDb < m.samplePeakDb + 0.5);
});

test('normalize reaches the target under the ceiling', () => {
  const x = sine(440, 4, 0.05);
  const p = new PCM([x, x.slice()], SR);
  const r = normalize(p, { targetLufs: -14, ceilingDbtp: -1 });
  assert.ok(Math.abs(r.after.integrated + 14) < 0.3, `after ${r.after.integrated}`);
  assert.ok(r.after.truePeakDb <= -1 + 0.05, `peak ${r.after.truePeakDb}`);
});

test('envelope and speech span', () => {
  const x = new Float32Array(SR); x.fill(0.5, 12000, 36000); // 0.25 s .. 0.75 s
  const e = envelope(x, 480);
  assert.ok(e[24000] > 0.49 && e[1000] === 0);
  const s = speechSpan(new PCM([x], SR));
  assert.ok(Math.abs(s.speechStart - 0.25) < 0.02 && Math.abs(s.speechEnd - 0.75) < 0.02, JSON.stringify(s));
});

test('mix lays out voice, effects and a bed and normalises (limiter master, no ffmpeg)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'motigen-mix-'));
  try {
    await mkdir(join(dir, 'vo'), { recursive: true });
    await writeWav(join(dir, 'vo', 'L01.wav'), new PCM([sine(220, 1, 0.3)], SR));
    await writeWav(join(dir, 'bed.wav'), new PCM([sine(110, 3, 0.2), sine(110, 3, 0.2)], SR));
    await writeFile(join(dir, 'events.json'), JSON.stringify({ dur: 4, vo: [{ id: 'L01', t: 1 }], clicks: [0.5], keys: [2, 2.1], enters: [3] }));
    const r = await mix({ dir, cfg: { master: 'limiter' } });
    assert.equal(r.vo.length, 1); assert.equal(r.sfx, 4); assert.ok(r.bed.looped); assert.deepEqual(r.missing, []);
    assert.ok(Math.abs(r.lufs + 14) < 0.5, `lufs ${r.lufs}`); assert.ok(r.truePeakDb <= -0.95);
    const out = await readWav(join(dir, 'mix.wav'));
    assert.equal(out.length, Math.ceil(4.5 * SR)); assert.equal(out.numberOfChannels, 2);
    // the voice is where the cue says: the second between 1 and 2 s is louder than the one before it
    const level = (a, b) => out.slice(a * SR, b * SR).rms();
    assert.ok(level(1, 2) > level(0.05, 0.45) * 2);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('synthesised effects are short and normalised', () => {
  for (const id of ['click', 'key', 'enter']) { const p = synthSfx(id); assert.ok(p.duration < 0.1 && Math.abs(p.peak() - 1) < 1e-3, id); }
});

test('vo split cuts a with-timestamps response into lines', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'motigen-vo-'));
  try {
    // two tones with a gap: "Hello there." then "Good bye."
    const n = 3 * SR, pcm = new Int16Array(n);
    for (let i = 0; i < SR; i++) pcm[i] = Math.round(8000 * Math.sin(2 * Math.PI * 200 * i / SR));
    for (let i = 1.5 * SR; i < 2.5 * SR; i++) pcm[i] = Math.round(8000 * Math.sin(2 * Math.PI * 300 * i / SR));
    const text = 'Hello there.\nGood bye.', chars = [...text];
    const starts = chars.map((_, i) => (i < 12 ? i / 12 : 1.5 + (i - 13) / 9)), ends = starts.map(s => s + 0.08);
    const resp = { audio_base64: Buffer.from(pcm.buffer).toString('base64'), alignment: { characters: chars, character_start_times_seconds: starts, character_end_times_seconds: ends } };
    const rows = await splitResponse(resp, ['Hello there.', 'Good bye.'], dir);
    assert.equal(rows.length, 2);
    assert.ok(rows[0].dur > 0.95 && rows[0].dur < 1.15, `L01 ${rows[0].dur}`);
    assert.ok(rows[1].dur > 0.95 && rows[1].dur < 1.15, `L02 ${rows[1].dur}`);
    const meta = JSON.parse(await readFile(join(dir, 'vo.json'), 'utf8'));
    assert.equal(meta.lines[1].text, 'Good bye.');
    const l1 = await readWav(join(dir, 'L01.wav'));
    assert.ok(flatness(l1) < 0.12, 'a sine is not flat');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('srt times cues and restores spellings', () => {
  const s = srt({ vo: [{ id: 'L02', t: 65.5 }, { id: 'L01', t: 1.25 }] }, { lines: [{ id: 'L01', dur: 2.5, text: 'Open Acme Cloud dot com.' }, { id: 'L02', dur: 1, text: 'Done.' }] }, { spellings: [['Acme Cloud dot com', 'acmecloud.com']] });
  assert.equal(s, '1\n00:00:01,250 --> 00:00:03,750\nOpen acmecloud.com.\n\n2\n00:01:05,500 --> 00:01:06,500\nDone.\n');
});
