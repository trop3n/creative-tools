// Checks for the effect stack (DURANDAL's glitch, light and texture passes). Run with `npm test -w @studio/core`.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EFFECTS, newEffect, cleanEffects, applyEffects, hasEffects} from '../src/dither/effects.js';
import {makeKey, valuesAt} from '../src/dither/keyframes.js';

/** A two-tone test picture: a dithered-looking checker with a bright square in the middle. */
function picture(W, H) {
  const px = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4, on = (x + y) % 3 === 0 || (x > W / 3 && x < (2 * W) / 3 && y > H / 3 && y < (2 * H) / 3);
    px[i] = on ? 230 : 20; px[i + 1] = on ? 220 : 40; px[i + 2] = on ? 200 : 60; px[i + 3] = 255;
  }
  return px;
}

test('every effect runs at its defaults, at one and several pixels per cell, and changes the picture', () => {
  for (const e of EFFECTS) {
    for (const k of [1, 4]) {
      const W = 48 * k, H = 32 * k, before = picture(W, H), px = before.slice();
      applyEffects(px, W, H, [newEffect(e.id)], {k, frame: 3});
      assert.equal(px.length, before.length, e.id);
      for (let i = 3; i < px.length; i += 4) assert.equal(px[i], 255, `${e.id}: alpha kept`);
      assert.ok(px.some((v, i) => v !== before[i]), `${e.id} at k=${k} changed nothing`);
    }
  }
});

test('effects are repeatable; Moving glitches differ from frame to frame, still ones do not', () => {
  const W = 64, H = 48, run = (fx, frame) => applyEffects(picture(W, H), W, H, [fx], {k: 1, frame});
  const blocks = newEffect('blocks');
  assert.deepEqual(run(blocks, 5), run(blocks, 5));
  assert.notDeepEqual(run(blocks, 5), run(blocks, 6));
  const still = {...blocks, moving: false};
  assert.deepEqual(run(still, 5), run(still, 6));
});

test('turned-off effects and an empty stack change nothing', () => {
  const W = 20, H = 20, before = picture(W, H);
  assert.deepEqual(applyEffects(before.slice(), W, H, [{...newEffect('glow'), on: false}], {k: 1}), before);
  assert.deepEqual(applyEffects(before.slice(), W, H, [], {k: 1}), before);
  assert.equal(hasEffects([{...newEffect('tint'), on: false}]), false);
  assert.equal(hasEffects([newEffect('tint')]), true);
});

test('chromatic aberration moves red and blue by whole cells, green stays', () => {
  const W = 10, H = 1, px = new Uint8ClampedArray(W * 4);
  px[5 * 4] = 255; px[5 * 4 + 1] = 255; px[5 * 4 + 2] = 255;
  for (let i = 3; i < px.length; i += 4) px[i] = 255;
  applyEffects(px, W, H, [{...newEffect('chroma'), amount: 1, angle: 0}], {k: 2});
  assert.equal(px[7 * 4], 255); // red two pixels right
  assert.equal(px[3 * 4 + 2], 255); // blue two pixels left
  assert.equal(px[5 * 4 + 1], 255); // green in place
  assert.equal(px[5 * 4], 0);
});

test('cleanEffects drops unknown effects and params, clamps numbers and caps the stack', () => {
  const out = cleanEffects([
    {id: 'nope'},
    {id: 'glow', radius: 999, strength: 'x', extra: 1},
    {id: 'tint', color: 'red', blend: 'weird', on: false},
    ...Array.from({length: 20}, () => ({id: 'grain'})),
  ]);
  assert.equal(out.length, 12);
  assert.equal(out[0].id, 'glow');
  assert.equal(out[0].radius, 40);
  assert.equal(out[0].strength, newEffect('glow').strength);
  assert.ok(!('extra' in out[0]));
  assert.equal(out[1].color, '#c99530');
  assert.equal(out[1].blend, 'multiply');
  assert.equal(out[1].on, false);
  assert.deepEqual(cleanEffects('junk'), []);
});

test('glitches land on whole cells: at 3 pixels per cell they match the 1-pixel version scaled up', () => {
  const W = 60, H = 40, k = 3, small = picture(W, H), big = new Uint8ClampedArray(W * k * H * k * 4);
  for (let y = 0; y < H * k; y++) for (let x = 0; x < W * k; x++) big.set(small.subarray(((((y / k) | 0) * W) + ((x / k) | 0)) * 4, ((((y / k) | 0) * W) + ((x / k) | 0)) * 4 + 4), (y * W * k + x) * 4);
  for (const id of ['blocks', 'slices', 'sort', 'wave', 'chroma']) {
    const fx = newEffect(id), a = applyEffects(small.slice(), W, H, [fx], {k: 1, frame: 2}), b = applyEffects(big.slice(), W * k, H * k, [fx], {k, frame: 2});
    let bad = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) for (let c = 0; c < 3; c++) if (a[(y * W + x) * 4 + c] !== b[((y * k + 1) * W * k + x * k + 1) * 4 + c]) bad++;
    assert.equal(bad, 0, `${id}: ${bad} cells differ`);
  }
});

test('keyframes carry the effect stack: sliders blend when the stacks match, else step', () => {
  const st = {style: 'atkinson', block: 4}, glow = newEffect('glow');
  const a = makeKey(0, st, {}, [{...glow, strength: 0}]), b = makeKey(2, st, {}, [{...glow, strength: 200}]);
  assert.equal(valuesAt([a, b], 1, {ease: false}).effects[0].strength, 100);
  const c = makeKey(2, st, {}, [newEffect('tint')]);
  assert.equal(valuesAt([a, c], 1.5, {ease: false}).effects[0].id, 'glow');
  assert.equal(valuesAt([a, c], 2).effects[0].id, 'tint');
  assert.equal(valuesAt([makeKey(0, st, {}), b], 0).effects, undefined); // old keyframes leave effects alone
});
