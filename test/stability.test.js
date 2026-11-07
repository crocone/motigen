import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countDiff } from '../src/stability.js';

test('countDiff counts the pixels over the threshold and boxes them', () => {
  const w = 16, h = 9, g = Buffer.alloc(w * h, 0);
  assert.deepEqual(countDiff(g, 8, w), { pct: 0, changed: 0, box: null });
  g[3 * w + 5] = 40; g[6 * w + 10] = 9; g[1 * w + 2] = 8; // the last one is at the threshold: not counted
  const d = countDiff(g, 8, w);
  assert.equal(d.changed, 2);
  assert.deepEqual(d.box, [5, 3, 10, 6]);
  assert.equal(d.pct, +(100 * 2 / (w * h)).toFixed(3));
});
