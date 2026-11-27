// Checks for reading and writing palette files. Run with `npm test -w @studio/core`.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parsePalette, paletteHexFile, MAX_COLORS} from '../src/dither/palette.js';

test('reads Lospec .hex, GIMP .gpl and loose text; writes .hex back', () => {
  assert.deepEqual(parsePalette('00304E\n242222\nc99530\n'), ['#00304e', '#242222', '#c99530']);
  const gpl = 'GIMP Palette\nName: Brand\nColumns: 4\n#\n  0  48  78\tNavy\n 36  34  34\tNear black\n255 255 255\n';
  assert.deepEqual(parsePalette(gpl), ['#00304e', '#242222', '#ffffff']);
  assert.deepEqual(parsePalette('["#dfdfdf", "#505050", "#DFDFDF"]'), ['#dfdfdf', '#505050']); // repeats dropped
  assert.deepEqual(parsePalette('id 1234567 abcdefg #12345'), []); // not colors
  assert.equal(parsePalette(Array.from({length: 40}, (_, i) => (i * 4).toString(16).padStart(6, '0')).join(' ')).length, MAX_COLORS);
  const colors = ['#00304e', '#c99530'];
  assert.equal(paletteHexFile(colors), '00304e\nc99530\n');
  assert.deepEqual(parsePalette(paletteHexFile(colors)), colors);
});
