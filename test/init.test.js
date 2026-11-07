import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { init, listTemplates } from '../src/init.js';
import { loadProject, resolveFormat } from '../src/project.js';

test('templates are listed', async () => {
  const t = await listTemplates();
  assert.ok(t.includes('guide') && t.includes('dom'));
});

test('init copies a template and fills {{name}}', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'motigen-'));
  try {
    const dest = join(dir, 'my-guide');
    const files = await init('guide', dest);
    assert.ok(files.includes('film.html') && files.includes('edit.js') && files.includes('motigen.json') && files.includes('.gitignore'));
    const html = await readFile(join(dest, 'film.html'), 'utf8');
    assert.ok(html.includes('<title>my-guide</title>') && !html.includes('{{name}}'));
    const cfg = JSON.parse(await readFile(join(dest, 'motigen.json'), 'utf8'));
    assert.equal(cfg.out, 'out/my-guide.mp4');
    await assert.rejects(init('guide', dest), /not empty/);
    await assert.rejects(init('nope', join(dir, 'x')), /no template/);
    const p = await loadProject(dest);
    assert.equal(p.page, 'film.html'); assert.deepEqual(p.size, [1920, 1080]); assert.equal(p.name, 'my-guide');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('formats resolve against the project defaults', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'motigen-'));
  try {
    await writeFile(join(dir, 'film.html'), '<!doctype html>');
    await writeFile(join(dir, 'motigen.json'), JSON.stringify({ out: 'out/x.mp4', formats: { h: { query: 'fmt=h' }, v: { size: [1080, 1920], query: 'fmt=v', fps: 60 } } }));
    const p = await loadProject(dir);
    assert.deepEqual(resolveFormat(p, ''), { page: 'film.html', size: [1920, 1080], query: '', out: 'out/x.mp4', fps: 30 });
    assert.deepEqual(resolveFormat(p, 'h'), { page: 'film.html', size: [1920, 1080], query: 'fmt=h', out: 'out/x-h.mp4', fps: 30 });
    assert.deepEqual(resolveFormat(p, 'v'), { page: 'film.html', size: [1080, 1920], query: 'fmt=v', out: 'out/x-v.mp4', fps: 60 });
    assert.throws(() => resolveFormat(p, 'nope'), /not in/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
