// Checks for the shared frame shapes. Run with `npm test -w @studio/core` (Node 22+).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {LED_WALL, LED_RATIO, FRAME_RATIOS, cropRect, frameLabel, fixedSizeLabel, fixedSize, frameDims} from '../src/frames.js';

test('the LED wall always exports at 3072 × 1408', () => {
  for (const long of [1080, 2160, 8192]) assert.deepEqual(frameDims('led', LED_RATIO, long), [3072, 1408]);
  assert.deepEqual(fixedSize('led'), [LED_WALL.w, LED_WALL.h]);
  assert.equal(fixedSize('16:9'), null);
});

test('other shapes put the long side on the long edge, short side even', () => {
  assert.deepEqual(frameDims('16:9', 16 / 9, 1920), [1920, 1080]);
  assert.deepEqual(frameDims('9:16', 9 / 16, 1920), [1080, 1920]);
  assert.deepEqual(frameDims('4:5', 4 / 5, 2160), [1728, 2160]);
  assert.deepEqual(frameDims('1:1', 1, 1440), [1440, 1440]);
  const [w, h] = frameDims('4:3', 4 / 3, 1081);
  assert.equal(w, 1081); assert.equal(h % 2, 0);
});

test('crops are centered and take the frame shape', () => {
  assert.deepEqual(cropRect(1920, 1080, 1), {x: 420, y: 0, w: 1080, h: 1080});
  assert.deepEqual(cropRect(1000, 1000, 2), {x: 0, y: 250, w: 1000, h: 500});
  const c = cropRect(1920, 1080, FRAME_RATIOS.led);
  assert.equal(c.w, 1920); assert.ok(Math.abs(c.w / c.h - 3072 / 1408) < 1e-9); assert.ok(Math.abs(c.y * 2 + c.h - 1080) < 1e-9);
  assert.deepEqual(cropRect(640, 480, 0), {x: 0, y: 0, w: 640, h: 480});
});

test('menu labels', () => {
  assert.equal(frameLabel('led'), 'LED wall');
  assert.equal(fixedSizeLabel('led'), '3072 × 1408 px');
  assert.equal(fixedSizeLabel('1:1'), '');
  assert.equal(frameLabel('3:4'), '3:4');
});
