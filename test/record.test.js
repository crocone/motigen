import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Term } from '../src/record/term.js';

let pty = null;
try { pty = await import('node-pty'); } catch { /* optional dependency */ }

test('the terminal recorder writes a stream with script -T timing', { skip: !pty && 'node-pty is not installed' }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'motigen-term-'));
  try {
    const t = new Term(dir, { cols: 80, rows: 24 });
    await t.start();
    await t.waitFor(process.platform === 'win32' && !process.env.SHELL ? '>' : '$', 20000);
    t.mark('echo');
    await t.type('echo motigen-record-ok', { cps: 40 });
    await t.enter();
    await t.waitFor('motigen-record-ok', 10000); // the echo of the typed text
    await t.waitFor('motigen-record-ok', 10000); // the command's output
    await t.stop();
    const out = await readFile(join(dir, 'term.out'));
    const tm = (await readFile(join(dir, 'term.tm'), 'utf8')).trim().split('\n');
    const header = out.indexOf(10) + 1;
    const bytes = tm.reduce((s, l) => s + +l.split(' ')[1], 0);
    assert.equal(bytes, out.length - header, 'timing lines account for every byte after the header');
    assert.ok(tm.every(l => /^\d+\.\d+ \d+$/.test(l)));
    assert.ok(out.toString('utf8').includes('motigen-record-ok'));
    const marks = JSON.parse(await readFile(join(dir, 'term.marks.json'), 'utf8'));
    assert.equal(marks.marks[0].name, 'echo');
    assert.ok((await stat(join(dir, 'term.out'))).size > 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
