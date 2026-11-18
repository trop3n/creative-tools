// Engine checks for DURANDAL. Run with `npm test -w @studio/core` (Node 22+).
// Baseline numbers come from the Python reference engine in the dither research,
// which the JS engine matched pixel for pixel when it was ported.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  STYLES, KERNELS, bayerMatrix, fieldCutoffs, ditherGray, ditherRGBA, resizeNearest, luminance, toneTable, paintMask, gaussian1d,
} from '../src/dither/index.js';

// Test image: left-to-right gradient with a dark soft blob in the middle (320×200).
const W = 320, H = 200;
const INPUT = (() => {
  const img = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const ramp = (x * 255) / (W - 1);
    const blob = 90 * Math.exp(-((x - W / 2) ** 2 + (y - H / 2) ** 2) / 3000);
    img[y * W + x] = Math.trunc(Math.min(255, Math.max(0, ramp - blob)));
  }
  return img;
})();

const run = (style, params = {}, extra = {}) => {
  const {mask, w, h} = ditherGray(INPUT, W, H, {style, params, block: 4, threshold: 50, ...extra});
  return resizeNearest(mask, w, h, W, H, Uint8Array);
};
const whiteFraction = out => out.reduce((n, v) => n + (v === 255), 0) / out.length;

test('every style gives pure black and white, with both present', () => {
  for (const s of STYLES) {
    const out = run(s.id);
    const values = new Set(out);
    assert.ok([...values].every(v => v === 0 || v === 255), `${s.id} has gray pixels`);
    assert.ok(values.has(0) && values.has(255), `${s.id} is a flat color`);
  }
});

test('matches the reference engine coverage', () => {
  const baseline = {
    'floyd-steinberg': 0.4497, atkinson: 0.4407, 'jarvis-judice-ninke': 0.45, stucki: 0.4502,
    burkes: 0.4512, sierra: 0.451, 'two-row-sierra': 0.4507, 'sierra-lite': 0.4497,
    wave: 0.7498, rings: 0.6733, scanline: 0.4545,
  };
  for (const [id, want] of Object.entries(baseline)) {
    assert.ok(Math.abs(whiteFraction(run(id)) - want) < 0.002, `${id}: ${whiteFraction(run(id))} vs ${want}`);
  }
});

test('error diffusion keeps overall tone', () => {
  // Share of white ≈ average brightness / 255 (Atkinson drops 1/4 of the error, so it's looser).
  const mean = INPUT.reduce((a, b) => a + b, 0) / INPUT.length / 255;
  for (const id of Object.keys(KERNELS)) {
    const tol = id === 'atkinson' ? 0.05 : 0.02;
    assert.ok(Math.abs(whiteFraction(run(id)) - mean) < tol, `${id} drifted from ${mean.toFixed(3)}`);
  }
});

test('kernel taps only reach unvisited pixels and their weights sum to 1', () => {
  for (const [id, kernel] of Object.entries(KERNELS)) {
    for (const [dy, dx] of kernel) assert.ok(dy > 0 || (dy === 0 && dx > 0), `${id} taps backwards: [${dy}, ${dx}]`);
    const sum = kernel.reduce((a, [, , wt]) => a + wt, 0);
    assert.ok(Math.abs(sum - (id === 'atkinson' ? 0.75 : 1)) < 1e-9, `${id} sums to ${sum}`);
  }
});

test('Bayer matrices are correct and coverage does not depend on size', () => {
  assert.deepEqual(bayerMatrix(4), [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]);
  const m = bayerMatrix(16).flat().sort((a, b) => a - b);
  assert.deepEqual(m, [...Array(256).keys()]);
  const cover = [2, 4, 8, 16].map(size => whiteFraction(run('bayer', {size})));
  for (const c of cover) assert.ok(Math.abs(c - 0.6745) < 0.002, `Bayer coverage ${c}`);
});

test('serpentine scan still keeps tone', () => {
  const plain = whiteFraction(run('floyd-steinberg'));
  const snake = whiteFraction(run('floyd-steinberg', {serpentine: true}));
  assert.ok(Math.abs(plain - snake) < 0.01);
});

test('invert flips every pixel', () => {
  const a = run('atkinson'), b = run('atkinson', {}, {invert: true});
  assert.ok(a.every((v, i) => v + b[i] === 255));
});

test('block size sets the working resolution', () => {
  const {w, h} = ditherGray(INPUT, W, H, {block: 5});
  assert.deepEqual([w, h], [64, 40]);
  const one = ditherGray(INPUT, W, H, {block: 1});
  assert.deepEqual([one.w, one.h], [W, H]);
});

test('tone sliders: zero is a no-op, and they move in the right direction', () => {
  const id = toneTable({});
  for (let i = 0; i < 256; i++) assert.ok(Math.abs(id[i] - i) < 1e-3);
  assert.ok(toneTable({brightness: 50})[100] > 100);
  assert.ok(toneTable({midtones: 50})[128] > 128);
  assert.ok(toneTable({contrast: 50})[200] > 200 && toneTable({contrast: 50})[50] < 50);
  assert.ok(toneTable({shadows: 50})[20] > 20 && toneTable({shadows: 50})[220] === 220);
});

test('blur runs and keeps the output binary', () => {
  const out = run('floyd-steinberg', {}, {blur: 3});
  assert.ok(out.every(v => v === 0 || v === 255));
});

test('luminance and painting', () => {
  const px = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255, 255, 255, 255, 255]);
  assert.deepEqual([...luminance(px, 3, 1)], [76, 150, 255]);
  const rgba = paintMask(new Uint8Array([0, 255]), 2, 1, 4, 1, '#00304e', '#dfdfdf');
  assert.deepEqual([...rgba.slice(0, 4)], [0, 0x30, 0x4e, 255]);
  assert.deepEqual([...rgba.slice(12, 16)], [0xdf, 0xdf, 0xdf, 255]);
  assert.ok(ditherRGBA(px, 3, 1, {block: 1}).mask.length === 3);
});

test('Gaussian helper is normalised', () => {
  const {kernel, radius} = gaussian1d(2);
  assert.equal(radius, 6);
  assert.ok(Math.abs(kernel.reduce((a, b) => a + b, 0) - 1) < 1e-9);
});

test('field cutoffs give the same answer as the CPU compare, in float32', () => {
  const v32 = new Float32Array(1);
  let checked = 0;
  for (const s of STYLES.filter(st => st.field)) {
    const w = 97, h = 61, params = Object.fromEntries(s.params.map(p => [p.key, p.default]));
    for (const thr of [0, 37.4, 127.5, 255]) {
      const field = s.field(w, h, params), cut = fieldCutoffs(field, w, h, thr);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const c = field(x, y) * (thr / 255), k = cut[y * w + x];
        // Pixel values right at and around the cutoff, plus every whole level.
        for (const raw of [c, k, Math.floor(c), Math.ceil(c), c + 1e-6, c - 1e-6]) {
          v32[0] = raw; const v = v32[0];
          assert.equal(v > k, v > c, `${s.id} at ${x},${y}: v=${v} c=${c} k=${k}`);
          checked++;
        }
      }
    }
  }
  assert.ok(checked > 100000);
});
