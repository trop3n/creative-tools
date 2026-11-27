// Run with `npm test -w @studio/pfhor`. Node check of PFHOR's quadtree on a synthetic image:
// cells stay in bounds, detail grows as the threshold falls, a tiny threshold step barely
// changes the picture (splits ease in, they don't pop), and the worst case stays fast.
import {analyze, buildCells, thresholdAt, scatterAt, drawCells, svgPainter} from '../src/engine/mosaic.js';
import {cleanConfig, presetConfig, PRESETS, DEFAULT_CONFIG} from '../src/engine/config.js';

let fails = 0;
const fail = (...m) => { fails++; console.log('FAIL', ...m); };

// A test picture: a smooth gradient, a sharp disc, fine stripes and a noisy patch.
function picture(W, H, noiseAll = false) {
  const d = new Uint8ClampedArray(W * H * 4);
  let s = 1;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let v = (x / W) * 200;
    if (Math.hypot(x - W * 0.3, y - H * 0.4) < W * 0.15) v = 240;
    if (x > W * 0.6 && y < H * 0.3) v = (x >> 2) & 1 ? 255 : 0;
    if ((x > W * 0.6 && y > H * 0.6) || noiseAll) v = rnd() * 255;
    const i = (y * W + x) * 4;
    d[i] = v; d[i + 1] = v * 0.8; d[i + 2] = 255 - v; d[i + 3] = 255;
  }
  return d;
}
/** Paint cell coverage (as circles) into a fine grid, for comparing shapes between frames. */
function raster(cells, aW, aH, n = 1) {
  const gw = Math.ceil(aW / n), gh = Math.ceil(aH / n), out = new Uint8Array(gw * gh);
  for (const c of cells) {
    const r = c.sz / 2;
    for (let y = Math.max(0, Math.floor((c.cy - r) / n)); y < Math.min(gh, Math.ceil((c.cy + r) / n)); y++)
      for (let x = Math.max(0, Math.floor((c.cx - r) / n)); x < Math.min(gw, Math.ceil((c.cx + r) / n)); x++)
        if (Math.hypot(x * n + n / 2 - c.cx, y * n + n / 2 - c.cy) <= r) out[y * gw + x] = 1;
  }
  return out;
}

const aW = 288, aH = 384;
const A = analyze(picture(aW, aH), aW, aH, 1.1, 0);
const cfgs = [...PRESETS.map(p => presetConfig(p.id)), cleanConfig({...DEFAULT_CONFIG, metric: 'variance'}), cleanConfig({...DEFAULT_CONFIG, metric: 'edge', roots: 1, maxDepth: 8})];
for (const cfg of cfgs) {
  let prevCount = Infinity;
  for (const thr of [0.02, 0.05, 0.1, 0.2, 0.4]) {
    const cells = buildCells(A, cfg, thr);
    if (!cells.length) fail('no cells', cfg.palette, thr);
    for (const c of cells) {
      if (![c.cx, c.cy, c.sz].every(Number.isFinite) || c.sz <= 0 || !cfg.colors.includes(c.color)) { fail('bad cell', JSON.stringify(c)); break; }
      if (c.cx < -1 || c.cy < -1 || c.cx > aW + aW / cfg.roots || c.cy > aH + aW / cfg.roots) { fail('out of bounds', JSON.stringify(c)); break; }
    }
    if (cells.length > prevCount * 1.02 && thr > 0.02) {} // counts may wobble while splits ease in
    prevCount = cells.length;
  }
  const fine = buildCells(A, cfg, 0.03).length, coarse = buildCells(A, cfg, 0.3).length;
  if (!(fine > coarse)) fail('detail does not grow as the threshold falls', cfg.palette, fine, coarse);
  // Continuity: sweep the threshold in steps of 1% and of 0.2%. Smooth motion shrinks with
  // the step; a pop stays the same size however small the step. Geometry only: flat palette
  // colours have to switch somewhere, and do so halfway through each split.
  const sweep = f => {
    let worst = 0, prev = raster(buildCells(A, cfg, 0.02), aW, aH);
    for (let thr = 0.02 * f; thr < 0.3; thr *= f) {
      const cur = raster(buildCells(A, cfg, thr), aW, aH);
      let diff = 0;
      for (let i = 0; i < cur.length; i++) if (cur[i] !== prev[i]) diff++;
      worst = Math.max(worst, diff / cur.length);
      prev = cur;
    }
    return worst;
  };
  const big = sweep(1.01), small = sweep(1.002);
  const worst = small;
  if (!(small < big * 0.6)) fail('threshold step pops', cfg.palette, `1% step ${(big * 100).toFixed(2)}%, 0.2% step ${(small * 100).toFixed(2)}%`);
  else console.log(`ok ${cfg.palette.padEnd(10)} ${cfg.shape.padEnd(8)} cells ${coarse}→${fine}, worst step: 1% → ${(big * 100).toFixed(2)}%, 0.2% → ${(small * 100).toFixed(2)}%`);
}
// Loops line up: the threshold and scatter are back where they started at the loop's end.
const r = presetConfig('scatter');
if (thresholdAt(r, 0) !== thresholdAt(r, 1) - 0 && Math.abs(thresholdAt(r, 0) - thresholdAt(r, 1)) > 1e-12) fail('threshold loop');
if (scatterAt(r, 0) !== 0 || scatterAt(r, 1) > 1e-12) fail('scatter loop');
// Worst case speed: a noisy 640 px analysis at the lowest threshold.
const nW = 480, nH = 640, N = analyze(picture(nW, nH, true), nW, nH, 1, 0);
const t0 = performance.now();
const many = buildCells(N, cleanConfig({...DEFAULT_CONFIG, minSize: 2, maxDepth: 8, threshold: 0.01}), 0.01);
const ms = performance.now() - t0;
console.log(`worst case: ${many.length} cells in ${ms.toFixed(1)} ms`);
if (ms > 120) fail('too slow', ms);
// Glyph cells: the shape survives cleaning, every cell carries a tone, the inkier glyph goes where
// the tone is furthest from the background, no glyphs falls back to squares, and SVG writes each symbol once.
if (cleanConfig({...DEFAULT_CONFIG, shape: 'glyph'}).shape !== 'glyph') fail('glyph shape lost in cleanConfig');
const gcfg = cleanConfig({...DEFAULT_CONFIG, shape: 'glyph', background: '#ffffff'});
const gcells = buildCells(A, gcfg, 0.08);
if (!gcells.every(c => c.l >= 0 && c.l <= 1)) fail('cell tone out of range');
const calls = [];
const rec = {background() {}, circle() {}, rect: () => calls.push('rect'), glyph: (x, y, s, g) => calls.push(g.id)};
const pair = [{cx: 10, cy: 10, sz: 8, color: '#000000', l: 0.05, id: 1}, {cx: 30, cy: 10, sz: 8, color: '#000000', l: 0.95, id: 2}];
drawCells(rec, pair, gcfg, 100, 100, 1, 0, [{id: 'light'}, {id: 'heavy'}]);
if (calls.join() !== 'heavy,light') fail('glyph by tone on a light background', calls.join());
calls.length = 0;
drawCells(rec, pair, {...gcfg, background: '#000000'}, 100, 100, 1, 0, [{id: 'light'}, {id: 'heavy'}]);
if (calls.join() !== 'light,heavy') fail('glyph by tone on a dark background', calls.join());
calls.length = 0;
drawCells(rec, pair, gcfg, 100, 100, 1, 0, []);
if (calls.join() !== 'rect,rect') fail('glyph fallback', calls.join());
const sp = svgPainter(), sym = {sym: 'glyph-0', symbol: '<symbol id="glyph-0" viewBox="0 0 100 100"></symbol>'};
drawCells(sp, pair, gcfg, 100, 100, 1, 0, [sym]);
const svg = sp.toString();
if (svg.split('<symbol').length !== 2 || svg.split('<use href="#glyph-0"').length !== 3) fail('glyph SVG', svg);
else console.log(`ok glyphs: ${gcells.length} cells with tone, picked by tone, square fallback, SVG symbols`);
console.log(`failures: ${fails}`);
if (fails) process.exit(1);
