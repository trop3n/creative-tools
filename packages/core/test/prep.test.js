// Checks for saturation, sharpen and noise before dithering. Run with `npm test -w @studio/core`.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {needsPrep, prepareRGBA, ditherRGBA} from '../src/dither/pipeline.js';

const W = 32, H = 16;
/** Left half dull red, right half gray: an edge in the middle. */
function picture() {
  const px = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4, left = x < W / 2;
    px[i] = left ? 160 : 100; px[i + 1] = left ? 100 : 100; px[i + 2] = left ? 100 : 100; px[i + 3] = 255;
  }
  return px;
}

test('off by default: the source comes back untouched and the dither is unchanged', () => {
  const px = picture();
  assert.equal(needsPrep({}), false);
  assert.equal(prepareRGBA(px, W, H, {}), px);
  assert.deepEqual(ditherRGBA(px, W, H, {style: 'atkinson', block: 1}).mask, ditherRGBA(px, W, H, {style: 'atkinson', block: 1, saturation: 0, sharpen: 0, noise: 0}).mask);
});

test('saturation only counts in color modes, and pushes color away from gray', () => {
  assert.equal(needsPrep({saturation: 50}), false); // two tones see brightness only
  assert.equal(needsPrep({saturation: 50, mode: 'palette'}), true);
  const out = prepareRGBA(picture(), W, H, {saturation: 100, mode: 'palette'});
  assert.ok(out[0] > 160 && out[1] < 100, 'red got redder');
  const gray = prepareRGBA(picture(), W, H, {saturation: -100, mode: 'cmyk'});
  assert.ok(Math.abs(gray[0] - gray[1]) <= 1, 'fully desaturated');
});

test('sharpen raises contrast at an edge and leaves flat areas alone', () => {
  const px = picture(), out = prepareRGBA(px, W, H, {sharpen: 100, block: 4});
  const at = x => out[(8 * W + x) * 4];
  assert.ok(at(W / 2 - 1) > 160, 'bright side of the edge brighter');
  assert.ok(at(W / 2) < 100, 'dark side of the edge darker');
  assert.equal(at(2), 160);
});

test('noise is the same every time and changes the dither', () => {
  const s = {style: 'bayer', block: 1, noise: 60};
  assert.deepEqual(prepareRGBA(picture(), W, H, s), prepareRGBA(picture(), W, H, s));
  assert.notDeepEqual(ditherRGBA(picture(), W, H, s).mask, ditherRGBA(picture(), W, H, {...s, noise: 0}).mask);
});
