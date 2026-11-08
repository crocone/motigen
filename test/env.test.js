import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseEnv, loadEnv } from '../src/env.js';
import { synthSfx, SYNTH } from '../src/audio/mix.js';

test('parseEnv reads KEY=value lines, quotes and comments', () => {
  const e = parseEnv('# comment\nA=1\nexport B = "two words"\nC=\'x\' \nD=val # trailing\n\nBAD LINE\n');
  assert.deepEqual(e, { A: '1', B: 'two words', C: 'x', D: 'val' });
});

test('loadEnv fills process.env from the project .env without overriding the shell', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'motigen-env-'));
  try {
    await writeFile(join(dir, '.env'), 'MOTIGEN_TEST_A=from-file\nMOTIGEN_TEST_B=from-file\n');
    process.env.MOTIGEN_TEST_B = 'from-shell'; delete process.env.MOTIGEN_TEST_A;
    const loaded = loadEnv(dir);
    assert.equal(process.env.MOTIGEN_TEST_A, 'from-file');
    assert.equal(process.env.MOTIGEN_TEST_B, 'from-shell');
    assert.ok(loaded.MOTIGEN_TEST_A && !loaded.MOTIGEN_TEST_B);
  } finally { await rm(dir, { recursive: true, force: true }); delete process.env.MOTIGEN_TEST_A; delete process.env.MOTIGEN_TEST_B; }
});

test('every built-in effect synthesises to a short normalised stereo clip', () => {
  for (const id of SYNTH) { const p = synthSfx(id); assert.equal(p.numberOfChannels, 2, id); assert.ok(p.duration > 0.01 && p.duration < 0.6, id); assert.ok(Math.abs(p.peak() - 1) < 1e-3, id); }
});
