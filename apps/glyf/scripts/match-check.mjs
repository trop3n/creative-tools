// Run with `npm test -w @studio/glyf`. Node checks of GLYF's matching (engine/match.js):
// linear tone, quarter turns, shape matching, Fit rotation, and that dithering keeps the
// overall tone.
import {GRID, inkOf, turn, candidates, matchCells} from '../src/engine/match.js';

let fails = 0;
const check = (ok, msg) => { console.log((ok ? 'ok   ' : 'FAIL ') + msg); if (!ok) fails++; };
const near = (a, b, e = 0.01) => Math.abs(a - b) < e;
const plain = {contrast: 1, bright: 0, gamma: 1, invert: false};

// Tone
check(near(inkOf(255, 255, 255, plain), 0) && near(inkOf(0, 0, 0, plain), 1), 'white wants no ink, black all of it');
check(near(inkOf(128, 128, 128, plain), 0.784, 0.005), 'linear: mid-gray wants about 78% ink (it reflects about 22% of the light)');
check(near(inkOf(128, 128, 128, {...plain, tone: 'classic'}), 0.498, 0.005), 'classic: mid-gray wants 50% ink, as before');
check(near(inkOf(188, 188, 188, plain), 0.5, 0.01), 'linear: sRGB 188 is the 50% tone');
check(near(inkOf(0, 0, 0, {...plain, invert: true}), 0), 'invert flips it');

// Patches, row by row; 1 = ink.
const P = rows => Float32Array.from(rows.join('').split(''), Number);
const LEFT = P(['1100', '1100', '1100', '1100']), TOP = P(['1111', '1111', '0000', '0000']);
const RIGHT = P(['0011', '0011', '0011', '0011']), DOT = P(['0000', '0110', '0110', '0000']);
const same = (a, b) => a.every((v, i) => near(v, b[i], 1e-6));
check(same(turn(LEFT), TOP), 'a quarter turn moves the left half to the top (clockwise, as the canvas draws)');
check(same(turn(turn(turn(turn(DOT)))), DOT), 'four quarter turns come back round');

// One cell's ink, as matchCells reads it.
const cellInk = patch => Float32Array.from(patch);
const one = (patch, cands, detail) => matchCells(cellInk(patch), 1, 1, () => cands, detail, 'none')[0];

// Two glyphs with the same ink: a centred dot block and a left half. Tone alone can't tell them apart.
const BIG_DOT = P(['0110', '1111', '1111', '0110']).map(v => v * 0.6667); // mean 0.5
const glyphs = [{gl: 'dot', level: 0.5, patch: BIG_DOT}, {gl: 'left', level: 0.5, patch: LEFT}];
const c0 = candidates(glyphs, [0], false);
check(one(LEFT, c0, 1).gl === 'left', 'detail: a cell dark on the left gets the left-half glyph, not the same-ink dot');
check(one(LEFT, c0, 0).gl === 'dot', 'no detail: tone only, so the first glyph with that ink wins (the old behaviour)');
const lightDot = [{gl: 'dot', level: 0.5, patch: BIG_DOT}, {gl: 'block', level: 1, patch: new Float32Array(16).fill(1)}];
check(one(new Float32Array(16).fill(0.5), candidates(lightDot, [0], false), 1).gl === 'dot', 'a flat cell is matched on tone even at full detail (the 50% dot, not the block)');

// Fit: only a top-half glyph, the cell is dark on the right: a quarter turn fits it.
const tops = candidates([{gl: 'top', level: 0.5, patch: TOP}], [0, 1, 2, 3], true);
const fit = one(RIGHT, tops, 1);
check(fit.gl === 'top' && fit.rot === 1, 'Fit turns a top-half glyph a quarter turn for a cell dark on the right');
check(candidates([{gl: 'dot', level: 0.5, patch: DOT}], [0, 1, 2, 3], false).length === 1, 'a symmetric glyph is tried once, not four times');

// Dithering keeps the tone: a flat 30% field over blank and full cells comes out about 30% full.
const cols = 40, rows = 40, flat = new Float32Array(cols * GRID * rows * GRID).fill(0.3);
const bw = candidates([{gl: 'block', level: 1, patch: new Float32Array(16).fill(1)}], [0], true);
for (const [method, detail] of [['fs', 0.6], ['fs', 0]]) {
  const got = matchCells(flat, cols, rows, () => bw, detail, method).filter(c => c.gl).length / (cols * rows);
  check(near(got, 0.3, 0.02), `${method}, detail ${detail}: a 30% field gets ${(got * 100).toFixed(1)}% full cells`);
}
// Atkinson passes on only 6/8 of each error by design (crisper, at the cost of exact tone).
const atk = matchCells(flat, cols, rows, () => bw, 0.6, 'atk').filter(c => c.gl).length / (cols * rows);
check(atk > 0.2 && atk < 0.3, `atk: a 30% field gets ${(atk * 100).toFixed(1)}% full cells (a little light, as Atkinson is)`);

console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
