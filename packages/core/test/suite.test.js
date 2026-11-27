// Checks for suite palettes and the shelf's helpers. Run with `npm test -w @studio/core`.
// (The shelf itself needs IndexedDB, so it's checked in the browser.)
import {test} from 'node:test';
import assert from 'node:assert/strict';

// A stand-in for the browser's localStorage, before the module reads it.
const mem = new Map();
globalThis.localStorage = {getItem: k => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k)};
const {cleanColors, suitePalettes, savePalette, deletePalette, watchPalettes, BRAND_PALETTE, isShelfType, shelfLabel, currentTool, sendTargets} = await import('../src/suite.js');

test('cleanColors keeps 2..16 hex colors, lowercased, repeats dropped', () => {
  assert.deepEqual(cleanColors(['#00304E', 'c99530', '#00304e', 'nope', 5]), ['#00304e', '#c99530']);
  assert.equal(cleanColors(['#ffffff']), null);
  assert.equal(cleanColors(Array.from({length: 30}, (_, i) => '#' + (i * 8).toString(16).padStart(6, '0'))).length, 16);
});

test('suite palettes: Brand first, saved ones newest first, same name replaces, delete works', () => {
  let calls = 0;
  const stop = watchPalettes(() => calls++);
  assert.deepEqual(suitePalettes(), [BRAND_PALETTE]);
  assert.ok(savePalette('Sunset', ['#ff0000', '#ffaa00'], 'leela'));
  assert.ok(savePalette('Sea', ['#003366', '#66ccff'], 'durandal'));
  assert.ok(savePalette('sunset', ['#ff0000', '#ffaa00', '#ffffff'], 'glyf')); // replaces Sunset
  const names = suitePalettes().map(p => p.name);
  assert.deepEqual(names, ['Brand', 'sunset', 'Sea']);
  assert.equal(suitePalettes()[1].colors.length, 3);
  assert.equal(savePalette('Brand', ['#000000', '#ffffff']), null); // the built-in name is taken
  assert.equal(savePalette('', ['#000000', '#ffffff']), null);
  assert.equal(savePalette('One', ['#000000']), null);
  deletePalette(suitePalettes()[2].id);
  assert.deepEqual(suitePalettes().map(p => p.name), ['Brand', 'sunset']);
  assert.equal(calls, 4);
  stop();
});

test('shelf helpers: which files it keeps, labels, and no tool outside the suite', () => {
  assert.ok(isShelfType('image/png') && isShelfType('video/mp4') && isShelfType('image/jpeg'));
  assert.ok(!isShelfType('image/svg+xml') && !isShelfType('application/json') && !isShelfType(''));
  assert.equal(shelfLabel({name: 'a.png', from: 'leela', at: 1000}, 1000 + 120000), 'a.png · LEELA · 2 min ago');
  assert.equal(currentTool(), null);
  assert.deepEqual(sendTargets('image'), []);
});
