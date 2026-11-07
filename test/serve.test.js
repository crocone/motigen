import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createResolver, RUNTIME_ROOT } from '../src/serve.js';

const root = resolve('examples/hello-dom');
const r = createResolver(root);

test('project files resolve under the project root', () => {
  assert.equal(r('/film.html').file, join(root, 'film.html'));
  assert.equal(r('/').file, join(root, 'index.html'));
  assert.equal(r('/take/').file, join(root, 'take', 'index.html'));
  assert.equal(r('/film.html').type, 'text/html; charset=utf-8');
  assert.equal(r('/audio/mix.wav').type, 'audio/wav');
  assert.equal(r('/take/share/term.out').type, 'application/octet-stream');
});

test('the runtime and vendored packages resolve under /_motigen/', () => {
  assert.equal(r('/_motigen/guide/player.js').file, join(RUNTIME_ROOT, 'guide', 'player.js'));
  assert.ok(existsSync(r('/_motigen/guide/player.js').file));
  assert.ok(existsSync(r('/_motigen/vendor/xterm/lib/xterm.js').file));
  assert.ok(existsSync(r('/_motigen/vendor/geist-sans/files/geist-sans-latin-500-normal.woff2').file));
  assert.ok(existsSync(r('/_motigen/vendor/mediabunny/dist/modules/src/index.js').file));
  assert.ok(existsSync(r('/_motigen/lib/audio/loudness.js').file));
  assert.ok(existsSync(r('/_motigen/canvas/kit.js').file) && existsSync(r('/_motigen/canvas/ink.js').file));
  assert.equal(r('/_motigen/vendor/nope/x.js'), null);
  assert.equal(r('/_motigen/lib/../package.json'), null);
});

test('paths that escape their root are refused', () => {
  assert.equal(r('/../package.json'), null);
  assert.equal(r('/_motigen/../src/cli.js'), null);
  assert.equal(r('/_motigen/vendor/xterm/../../package.json'), null);
  assert.equal(r('/%2e%2e/package.json'), null);
});
