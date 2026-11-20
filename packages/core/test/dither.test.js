// Engine checks for DURANDAL. Run with `npm test -w @studio/core` (Node 22+).
// Baseline numbers come from the Python reference engine in the dither research,
// which the JS engine matched pixel for pixel when it was ported. Exception: pattern
// styles in two tones now treat 50% threshold as true coverage (the reference read it
// as about twice as light), so the Bayer, wave and rings numbers are this engine's own.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  STYLES, KERNELS, bayerMatrix, makeKey, putKey, keyAt, valuesAt, OSTROMUKHOV_TABLE, OSTROMUKHOV_WEIGHTS, blueNoiseMatrix, ditherCMYK, inkColors, INKS, FIELDS, indicesToSVG, maskToSVG, cellStamp, paintCells, extremeColor, fieldCutoffs, PALETTE_BY_ID, hexToRGB, paletteRGB, nearestColor, sampleIndices, adaptivePalette, paintIndices, ditherGray, ditherRGBA, resizeNearest, luminance, toneTable, paintMask, gaussian1d,
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
    wave: 0.47, rings: 0.5175, scanline: 0.4545,
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
  // Close to the diffusion styles' 0.45; a 2×2 matrix has only five levels, hence the slack.
  for (const c of cover) assert.ok(Math.abs(c - 0.45) < 0.01, `Bayer coverage ${c}`);
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
        const c = field(x, y) * (thr / 127.5), k = cut[y * w + x];
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

/* ---------- palette mode ---------- */
const RGBA = (() => {
  // The test image in color: the gray ramp in red and green, a blue gradient top to bottom.
  const px = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    const y = Math.floor(i / W);
    px[i * 4] = INPUT[i]; px[i * 4 + 1] = 255 - INPUT[i]; px[i * 4 + 2] = Math.round((y * 255) / (H - 1)); px[i * 4 + 3] = 255;
  }
  return px;
})();

test('palette mode: every style returns valid indices that use the palette', () => {
  const colors = PALETTE_BY_ID.primaries.colors;
  for (const s of STYLES) {
    const {indices, w, h, colors: used} = ditherRGBA(RGBA, W, H, {style: s.id, mode: 'palette', colors, block: 2});
    assert.equal(indices.length, w * h);
    assert.deepEqual(used, colors);
    const seen = new Set(indices);
    assert.ok([...seen].every(i => i < colors.length), s.id);
    assert.ok(seen.size >= 3, `${s.id} uses only ${seen.size} colors`);
  }
});

test('palette mode: gray levels keep the average tone of a flat field', () => {
  // A flat 40% gray over a 4-level gray palette should average out near 40%.
  const n = 64 * 64, flat = new Uint8ClampedArray(n * 4).fill(102);
  const colors = PALETTE_BY_ID.gray4.colors, levels = colors.map(c => hexToRGB(c)[0]);
  for (const style of ['floyd-steinberg', 'bayer', 'scanline']) {
    const {indices} = ditherRGBA(flat, 64, 64, {style, mode: 'palette', colors, block: 1});
    const mean = indices.reduce((a, i) => a + levels[i], 0) / n;
    assert.ok(Math.abs(mean - 102) < 6, `${style}: mean ${mean.toFixed(1)}`);
  }
});

test('palette mode: strength 0 is plain nearest-color quantising', () => {
  const colors = PALETTE_BY_ID.gray4.colors, pal = paletteRGB(colors);
  for (const style of ['atkinson', 'dots']) {
    const {indices, w, h} = ditherRGBA(RGBA, W, H, {style, mode: 'palette', colors, strength: 0, block: 4});
    const pick = sampleIndices(W, H, w, h);
    for (let i = 0; i < indices.length; i += 7) {
      const p = pick[i] * 4;
      assert.equal(indices[i], nearestColor(pal, RGBA[p], RGBA[p + 1], RGBA[p + 2]));
    }
  }
});

test('adaptive palette finds the colors an image is made of', () => {
  const n = 90 * 30, px = new Uint8ClampedArray(n * 4);
  const want = [[200, 30, 40], [20, 60, 180], [240, 230, 210]];
  for (let i = 0; i < n; i++) px.set([...want[Math.floor((i % 90) / 30)], 255], i * 4);
  const got = adaptivePalette(px, 90, 30, 3).map(hexToRGB);
  for (const c of want) assert.ok(got.some(g => g.every((v, k) => Math.abs(v - c[k]) < 2)), `missing ${c}`);
});

test('paintIndices maps indices to colors and scales with hard edges', () => {
  const out = paintIndices(Uint8Array.from([0, 1, 2, 1]), 2, 2, 4, 4, ['#000000', '#ff0000', '#0000ff']);
  assert.deepEqual([...out.subarray(0, 4)], [0, 0, 0, 255]);
  assert.deepEqual([...out.subarray(8, 12)], [255, 0, 0, 255]);
  assert.deepEqual([...out.subarray(4 * 8, 4 * 8 + 4)], [0, 0, 255, 255]);
});

// Draw an SVG from indicesToSVG back into cells, to check it against the source.
const rasterSVG = (svg, w, h) => {
  const colors = [], out = new Array(w * h).fill(null);
  const bg = svg.match(/<rect width="\d+" height="\d+" fill="(#[0-9a-f]{6})"\/>/)[1];
  out.fill(bg);
  for (const [, fill, d] of svg.matchAll(/<path fill="(#[0-9a-f]{6})" d="([^"]+)"\/>/g)) {
    colors.push(fill);
    for (const [, x, y, len, rh] of d.matchAll(/M(\d+) (\d+)h(\d+)v(\d+)h-\d+z/g)) {
      for (let yy = +y; yy < +y + +rh; yy++) for (let xx = +x; xx < +x + +len; xx++) {
        assert.equal(out[yy * w + xx], bg, `cell ${xx},${yy} painted twice`);
        out[yy * w + xx] = fill;
      }
    }
  }
  return out;
};

test('SVG export redraws every cell in its color', () => {
  const colors = PALETTE_BY_ID.brand.colors;
  for (const style of ['floyd-steinberg', 'bayer', 'dots']) {
    const rgba = new Uint8ClampedArray(W * H * 4);
    for (let i = 0; i < W * H; i++) { rgba[i * 4] = INPUT[i]; rgba[i * 4 + 1] = (i % W) * 0.8; rgba[i * 4 + 2] = 255 - INPUT[i]; rgba[i * 4 + 3] = 255; }
    const {indices, w, h} = ditherRGBA(rgba, W, H, {mode: 'palette', colors, style, params: {}, block: 3});
    const svg = indicesToSVG(indices, w, h, colors, {width: w * 3, height: h * 3, title: 'a <test> & "quote"'});
    assert.match(svg, /^<svg [^>]*width="\d+" height="\d+" viewBox="0 0 \d+ \d+"/);
    assert.match(svg, /<title>a &lt;test&gt; &amp; &quot;quote&quot;<\/title>/);
    const back = rasterSVG(svg, w, h);
    for (let i = 0; i < w * h; i++) assert.equal(back[i], colors[indices[i]], `${style}: cell ${i}`);
  }
});

test('SVG export merges flat areas into a few rectangles', () => {
  const w = 40, h = 30, mask = new Uint8Array(w * h);
  for (let y = 5; y < 25; y++) for (let x = 10; x < 30; x++) mask[y * w + x] = 255; // one paper square on ink
  const svg = maskToSVG(mask, w, h, '#00304e', '#dfdfdf');
  assert.equal((svg.match(/M/g) || []).length, 1);
  assert.match(svg, /fill="#00304e"\/>/); // ink is the background
  assert.match(svg, /<path fill="#dfdfdf" d="M10 5h20v20h-20z"\/>/);
  const back = rasterSVG(svg, w, h);
  for (let i = 0; i < w * h; i++) assert.equal(back[i], mask[i] ? '#dfdfdf' : '#00304e');
});

test('cell shapes: stamps are symmetric and nest as the gap grows', () => {
  const show = st => [...st].join('');
  // 6 px cells, no gap: squares fill the cell, dots cut the corners.
  assert.equal(show(cellStamp('square', 6, 0)), '1'.repeat(36));
  const dot = cellStamp('dot', 6, 0);
  assert.equal(dot[0], 0); assert.equal(dot[2 * 6 + 2], 1); assert.equal(dot[2], 1);
  assert.equal(show(cellStamp('lines', 4, 0.5)), '0000111111110000');
  assert.equal(show(cellStamp('diamond', 4, 0)), '0110111111110110');
  for (const shape of ['square', 'dot', 'diamond', 'lines']) {
    for (const k of [3, 5, 8, 13]) {
      let prev = null;
      for (const gap of [0, 0.2, 0.4, 0.6]) {
        const st = cellStamp(shape, k, gap);
        for (let j = 0; j < k; j++) for (let i = 0; i < k; i++) {
          const v = st[j * k + i];
          assert.equal(v, st[j * k + (k - 1 - i)], `${shape} k=${k} mirrored`);
          assert.equal(v, st[(k - 1 - j) * k + i], `${shape} k=${k} flipped`);
          if (prev) assert.ok(v <= prev[j * k + i], `${shape} k=${k} grows with gap`);
        }
        prev = st;
      }
    }
  }
});

test('paintCells draws shapes on the gap color and plain squares like paintIndices', () => {
  const idx = Uint8Array.from([0, 1, 1, 0]), colors = ['#000000', '#ff8000'];
  const plain = paintCells(idx, 2, 2, 3, colors, 'square', 0);
  assert.deepEqual([...plain], [...paintIndices(idx, 2, 2, 6, 6, colors)]);
  const dots = paintCells(idx, 2, 2, 5, colors, 'dot', 0.2, '#00304e');
  const at = (x, y) => [...dots.slice((y * 10 + x) * 4, (y * 10 + x) * 4 + 3)];
  assert.deepEqual(at(5, 0), [0, 0x30, 0x4e]); // corner of cell (1, 0): gap
  assert.deepEqual(at(7, 2), [255, 128, 0]); // middle of cell (1, 0): its color
  assert.equal(extremeColor(['#dfdfdf', '#00304e', '#c99530']), '#00304e');
  assert.equal(extremeColor(['#dfdfdf', '#00304e', '#c99530'], 'light'), '#dfdfdf');
});

test('SVG export draws one shape per visible cell', () => {
  const idx = Uint8Array.from([0, 1, 2, 1, 1, 0]), colors = ['#242222', '#c99530', '#dfdfdf'];
  const dots = indicesToSVG(idx, 3, 2, colors, {shape: 'dot', gap: 0.2, gapColor: '#242222'});
  assert.match(dots, /<rect width="3" height="2" fill="#242222"\/>/);
  assert.equal((dots.match(/a0\.4 0\.4 0 1 0 0\.8 0/g) || []).length, 4); // the 4 cells not in the gap color
  assert.doesNotMatch(dots, /crispEdges/);
  const lines = indicesToSVG(idx, 3, 2, colors, {shape: 'lines', gap: 0.5, gapColor: '#242222'});
  assert.match(lines, /<path fill="#c99530" d="M1 0\.25h1v0\.5h-1zM0 1\.25h2v0\.5h-2z"\/>/);
  const diamonds = indicesToSVG(idx, 3, 2, colors, {shape: 'diamond', gap: 0, gapColor: '#242222'});
  assert.match(diamonds, /<path fill="#dfdfdf" d="M2\.5 0l0\.5 0\.5l-0\.5 0\.5l-0\.5 -0\.5z"\/>/);
});

test('blue noise: a full ranking, spread evenly at every level', () => {
  const t0 = performance.now();
  const m = blueNoiseMatrix(64), n = 64, flat = m.flat();
  const ms = performance.now() - t0;
  assert.ok(ms < 1500, `took ${Math.round(ms)} ms`);
  assert.deepEqual([...flat].sort((a, b) => a - b), Array.from({length: n * n}, (_, i) => i));
  for (const level of [0.1, 0.5, 0.9]) {
    const cut = level * n * n;
    for (let by = 0; by < n; by += 8) for (let bx = 0; bx < n; bx += 8) {
      let k = 0;
      for (let y = by; y < by + 8; y++) for (let x = bx; x < bx + 8; x++) k += m[y][x] < cut;
      assert.ok(Math.abs(k - 64 * level) <= 7, `level ${level}, block ${bx},${by}: ${k} of 64`);
    }
    // No two neighbours on at a 10% level: blue noise keeps dots apart.
    if (level === 0.1) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++)
      if (m[y][x] < cut) assert.ok(!(m[y][(x + 1) % n] < cut && m[(y + 1) % n][x] < cut), `clump at ${x},${y}`);
  }
});

test('new pattern fields stay in 0..255 and track tone', () => {
  for (const id of ['crosshatch', 'stipple', 'diamonds', 'spiral']) {
    const f = FIELDS[id](200, 150, {});
    let lo = Infinity, hi = -Infinity;
    for (let y = 0; y < 150; y++) for (let x = 0; x < 200; x++) { const v = f(x, y); lo = Math.min(lo, v); hi = Math.max(hi, v); }
    assert.ok(lo >= 0 && hi <= 255 && hi - lo > 150, `${id} range ${lo}..${hi}`);
    // A lighter flat gray never turns out darker.
    let prev = -1;
    for (const g of [30, 90, 150, 210]) {
      const {mask} = ditherGray(new Float32Array(200 * 150).fill(g), 200, 150, {style: id, params: {}, block: 1, threshold: 50});
      const white = mask.reduce((a, v) => a + (v ? 1 : 0), 0) / mask.length;
      assert.ok(white >= prev, `${id}: ${g} gray gave ${white}`);
      prev = white;
    }
  }
});

test('two tones: pattern styles at the default 50% threshold keep a flat gray’s tone', () => {
  // At 50% the field itself is the cutoff, as in CMYK (it used to read as about twice as light).
  for (const id of ['bayer', 'bittone', 'stipple', 'noise', 'dots', 'lines']) {
    const {mask} = ditherGray(new Float32Array(240 * 160).fill(128), 240, 160, {style: id, params: {}, block: 1, threshold: 50});
    const white = mask.reduce((a, v) => a + (v ? 1 : 0), 0) / mask.length;
    assert.ok(Math.abs(white - 0.5) < 0.03, `${id}: mid gray gave ${white.toFixed(3)} white`);
  }
});

test('crosshatch keeps the tone of a flat gray', () => {
  for (const g of [64, 128, 192]) {
    const {mask} = ditherGray(new Float32Array(300 * 200).fill(g), 300, 200, {style: 'crosshatch', params: {}, block: 1, threshold: 50});
    const white = mask.reduce((a, v) => a + (v ? 1 : 0), 0) / mask.length;
    assert.ok(Math.abs(white - g / 255) < 0.06, `${g} gray: ${white.toFixed(3)} white`);
  }
});

const flatRGBA = (w, h, [r, g, b]) => { const a = new Uint8ClampedArray(w * h * 4); for (let i = 0; i < w * h; i++) a.set([r, g, b, 255], i * 4); return a; };

test('CMYK: 16 overprint colors from the four inks', () => {
  const c = inkColors();
  assert.equal(c.length, 16);
  assert.equal(c[0], '#ffffff');
  INKS.forEach((ink, i) => assert.equal(c[1 << i], ink.color));
  // Cyan over yellow is a green; all four inks are near black.
  const [r, g, b] = hexToRGB(c[1 | 4]);
  assert.ok(g > r && g > b, `cyan + yellow = ${c[5]}`);
  assert.ok(hexToRGB(c[15]).every(v => v < 20));
});

test('CMYK: flat colors print with the right inks, for every style', () => {
  const w = 96, h = 64;
  const coverage = (rgb, style, extra = {}) => {
    const {indices, colors} = ditherCMYK(flatRGBA(w, h, rgb), w, h, {style, params: {}, block: 1, threshold: style.match(/floyd|atkinson|stucki|sierra|burkes|jarvis|stevenson|scanline/) ? 50 : 50, ...extra});
    assert.equal(colors.length, 16);
    return [0, 1, 2, 3].map(i => indices.reduce((a, v) => a + ((v >> i) & 1), 0) / indices.length);
  };
  for (const s of STYLES) {
    const white = coverage([255, 255, 255], s.id);
    assert.ok(white.every(v => v < 0.02), `${s.id}: white paper got ink ${white}`);
    const [c, m, y, k] = coverage([0, 255, 255], s.id); // pure cyan
    assert.ok(c > 0.9 && m < 0.05 && y < 0.05 && k < 0.05, `${s.id}: cyan gave ${[c, m, y, k]}`);
    const red = coverage([255, 0, 0], s.id);
    assert.ok(red[0] < 0.05 && red[1] > 0.9 && red[2] > 0.9, `${s.id}: red gave ${red}`);
  }
  // Mid gray: with full black it is black ink only; with none it is C+M+Y.
  const g1 = coverage([128, 128, 128], 'floyd-steinberg', {black: 100});
  assert.ok(g1[0] < 0.02 && Math.abs(g1[3] - 0.5) < 0.05, `gray, full black: ${g1}`);
  const g0 = coverage([128, 128, 128], 'floyd-steinberg', {black: 0});
  assert.ok(g0[3] === 0 && g0.slice(0, 3).every(v => Math.abs(v - 0.5) < 0.05), `gray, no black: ${g0}`);
});

test('CMYK: each ink gets its own screen angle', () => {
  const w = 120, h = 90;
  const {indices} = ditherCMYK(flatRGBA(w, h, [110, 110, 110]), w, h, {style: 'dots', params: {cell: 8}, block: 1, threshold: 50, black: 0});
  const plane = i => Array.from(indices, v => (v >> i) & 1).join('');
  assert.notEqual(plane(0), plane(1));
  assert.notEqual(plane(1), plane(2));
});

test('CMYK: screens print about as much ink as asked at 50%', () => {
  const w = 160, h = 120;
  for (const style of ['dots', 'bayer', 'stipple', 'diamonds', 'lines']) {
    for (const level of [64, 128, 192]) {
      // A flat cyan tint: red channel sets the cyan amount.
      const {indices} = ditherCMYK(flatRGBA(w, h, [level, 255, 255]), w, h, {style, params: {}, block: 1, threshold: 50});
      const c = indices.reduce((a, v) => a + (v & 1), 0) / indices.length, want = 1 - level / 255;
      assert.ok(Math.abs(c - want) < 0.08, `${style} at ${level}: ${c.toFixed(3)} cyan, want ${want.toFixed(3)}`);
    }
  }
});

test('Ostromukhov: table from the paper, weights sum to 1, mirrored around 127.5', () => {
  assert.equal(OSTROMUKHOV_TABLE.length, 128 * 3);
  assert.deepEqual([...OSTROMUKHOV_TABLE.slice(0, 3)], [13, 0, 5]);
  assert.deepEqual([...OSTROMUKHOV_TABLE.slice(63 * 3, 64 * 3)], [2447, 2200, 57]);
  for (let v = 0; v < 256; v++) {
    const s = OSTROMUKHOV_WEIGHTS[v * 3] + OSTROMUKHOV_WEIGHTS[v * 3 + 1] + OSTROMUKHOV_WEIGHTS[v * 3 + 2];
    assert.ok(Math.abs(s - 1) < 1e-12, `level ${v} sums to ${s}`);
    for (let k = 0; k < 3; k++) assert.equal(OSTROMUKHOV_WEIGHTS[v * 3 + k], OSTROMUKHOV_WEIGHTS[(255 - v) * 3 + k]);
  }
});

test('Ostromukhov keeps flat tones and spreads light dots apart', () => {
  const w = 200, h = 150;
  for (const g of [8, 40, 100, 128, 190, 250]) {
    const {mask} = ditherGray(new Float32Array(w * h).fill(g), w, h, {style: 'ostromukhov', params: {}, block: 1, threshold: 50});
    const white = mask.reduce((a, v) => a + (v ? 1 : 0), 0) / mask.length;
    assert.ok(Math.abs(white - g / 255) < 0.01, `${g}: ${white.toFixed(4)} white`);
  }
  // At a light gray, black dots should almost never touch each other.
  const {mask} = ditherGray(new Float32Array(w * h).fill(235), w, h, {style: 'ostromukhov', params: {}, block: 1, threshold: 50});
  let dots = 0, touching = 0;
  for (let y = 0; y < h - 1; y++) for (let x = 0; x < w - 1; x++) {
    if (mask[y * w + x]) continue;
    dots++;
    if (!mask[y * w + x + 1] || !mask[(y + 1) * w + x]) touching++;
  }
  assert.ok(dots > 1000 && touching / dots < 0.02, `${touching} of ${dots} dots touch`);
});

test('keyframes: hold at the ends, blend between, and step styles at the key', () => {
  const base = {style: 'dots', block: 4, threshold: 40, brightness: 0, blur: 0, mode: 'mono'};
  let keys = [];
  keys = putKey(keys, makeKey(2, {...base, block: 12, threshold: 80, blur: 3}, {cell: 20, angle: 90}));
  keys = putKey(keys, makeKey(0, base, {cell: 4, angle: 0}));
  assert.deepEqual(keys.map(k => k.t), [0, 2]);
  assert.deepEqual(valuesAt(keys, -1).values, valuesAt(keys, 0).values);
  assert.equal(valuesAt(keys, 9).values.block, 12);
  const mid = valuesAt(keys, 1, {ease: false});
  assert.equal(mid.values.block, 8);
  assert.equal(mid.values.threshold, 60);
  assert.equal(mid.values.blur, 2); // 1.5 rounds to a whole pixel
  assert.equal(mid.params.cell, 12);
  assert.equal(mid.params.angle, 45);
  // Easing is slow at the ends and matches linear at the middle.
  assert.equal(valuesAt(keys, 1).values.threshold, 60);
  assert.ok(valuesAt(keys, 0.2).values.threshold < valuesAt(keys, 0.2, {ease: false}).values.threshold);
  // Replacing a keyframe at the same time keeps one.
  keys = putKey(keys, makeKey(2 + 1 / 120, {...base, threshold: 10}, {cell: 4, angle: 0}));
  assert.equal(keys.length, 2);
  assert.equal(keyAt(keys, 2).values.threshold, 10);
  // A style change steps at its keyframe; params don't blend across styles.
  keys = putKey(keys, makeKey(4, {...base, style: 'bayer'}, {size: 8}));
  const before = valuesAt(keys, 3.9);
  assert.equal(before.style, 'dots');
  assert.equal(before.params.cell, 4);
  assert.equal(valuesAt(keys, 4).style, 'bayer');
  assert.equal(valuesAt(keys, 4).params.size, 8);
  assert.equal(valuesAt([], 1), null);
});
