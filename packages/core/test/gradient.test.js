// Engine checks for LEELA. Run with `npm test -w @studio/core` (Node 22+).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  parseColor, oklabToHex, linearToOklab, oklabToLinear, rampAt,
  cleanConfig, DEFAULT_CONFIG, PRESETS, presetConfig, randomConfig, spreadPoints,
  gradientNoise, evolvingNoise, correlation, loopLevel,
} from '../src/gradient/index.js';
import {VERT, FRAG} from '../src/gradient/shader.js';

const close = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b}`);

test('Oklab: hex round-trips, white and black land where they should', () => {
  for (const hex of ['#000000', '#ffffff', '#00304e', '#c99530', '#90a344', '#4c3046', '#ff0000', '#00ff00', '#0000ff']) {
    assert.equal(oklabToHex(parseColor(hex)), hex);
  }
  const white = parseColor('#fff');
  close(white[0], 1, 1e-4, 'white L'); close(white[1], 0, 1e-4, 'white a'); close(white[2], 0, 1e-4, 'white b');
  close(parseColor('#000')[0], 0, 1e-6, 'black L');
  const lin = [0.2, 0.5, 0.8], back = oklabToLinear(linearToOklab(lin));
  lin.forEach((v, i) => close(back[i], v, 1e-6, 'linear round trip'));
});

test('Oklab: oklch() parses, bad colors are refused', () => {
  const c = parseColor('oklch(0.7 0.1 90)');
  close(c[0], 0.7, 1e-9, 'L'); close(c[1], 0, 1e-9, 'a at 90°'); close(c[2], 0.1, 1e-9, 'b at 90°');
  close(parseColor('oklch(70% 0.1 0)')[0], 0.7, 1e-9, 'percent L');
  for (const bad of ['', 'red', '#12', '#gggggg', 'oklch(a b c)', null, 42]) assert.equal(parseColor(bad), null, String(bad));
});

test('Oklab: a blue-to-orange blend stays bright in the middle', () => {
  // Averaging sRGB values gives a darker, duller middle than blending in Oklab.
  const a = parseColor('#1d4ed8'), b = parseColor('#f97316');
  const mid = a.map((v, i) => (v + b[i]) / 2);
  const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const srgbMid = rgb('#1d4ed8').map((v, i) => Math.round((v + rgb('#f97316')[i]) / 2));
  const srgbL = parseColor('#' + srgbMid.map(v => v.toString(16).padStart(2, '0')).join(''))[0];
  assert.ok(mid[0] > srgbL, `Oklab middle L ${mid[0]} vs sRGB middle L ${srgbL}`);
});

test('ramp: passes through every stop, smooth in between', () => {
  const stops = ['#00304e', '#4c3046', '#c99530', '#dfdfdf'].map(parseColor);
  stops.forEach((s, i) => rampAt(stops, i / (stops.length - 1)).forEach((v, k) => close(v, s[k], 1e-12, `stop ${i}`)));
  let prev = rampAt(stops, 0);
  for (let t = 0.001; t <= 1; t += 0.001) {
    const c = rampAt(stops, t);
    assert.ok(Math.hypot(c[0] - prev[0], c[1] - prev[1], c[2] - prev[2]) < 0.01, `jump at ${t}`);
    prev = c;
  }
  assert.deepEqual(rampAt(stops, -1), rampAt(stops, 0));
  assert.deepEqual(rampAt(stops, 2), rampAt(stops, 1));
});

test('config: defaults fill in, bad values fall back, unknown fields drop', () => {
  assert.deepEqual(cleanConfig({}), DEFAULT_CONFIG);
  const c = cleanConfig({shape: 'star', warp: 9, speed: -1, palette: ['#fff', 'nope', '#000'], background: 'blue', center: [2, 'x'], loop: NaN, extra: 1,
    mesh: [{x: 2, y: 0.5, color: '#f00'}, {x: 0, y: 0, color: 'bad'}]});
  assert.equal(c.shape, 'blob');
  assert.equal(c.warp, 1);
  assert.equal(c.speed, 0);
  assert.deepEqual(c.palette, ['#fff', '#000']);
  assert.equal(c.background, DEFAULT_CONFIG.background);
  assert.deepEqual(c.center, [1, 0.5]);
  assert.equal(c.loop, 0);
  assert.equal('extra' in c, false);
  assert.deepEqual(c.mesh, [{x: 1, y: 0.5, color: '#f00'}]);
  assert.deepEqual(cleanConfig({palette: ['#fff']}).palette, DEFAULT_CONFIG.palette); // needs two colors
  for (const p of PRESETS) assert.equal(presetConfig(p.id).shape, p.config.shape || 'blob');
});

test('randomizer: same seed, same config; valid colors; mesh points spread out', () => {
  assert.deepEqual(randomConfig(1234), randomConfig(1234));
  assert.notDeepEqual(randomConfig(1), randomConfig(2));
  for (let s = 1; s <= 200; s++) {
    const c = randomConfig(s);
    assert.deepEqual(cleanConfig(c), c, `seed ${s} is already clean`);
    assert.ok(c.palette.length >= 2 && c.palette.every(parseColor));
    if (c.shape === 'mesh') assert.ok(c.mesh.length >= 4);
  }
  // Best of 8 layouts beats a single random layout on the closest pair, on average.
  let r = 1;
  const rand = () => (r = (r * 16807) % 2147483647) / 2147483647;
  const gap = pts => { let g = Infinity; for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) g = Math.min(g, Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1])); return g; };
  let one = 0, best = 0;
  for (let k = 0; k < 200; k++) { one += gap(spreadPoints(rand, 6, 1)); best += gap(spreadPoints(rand, 6, 8)); }
  assert.ok(best > one * 1.4, `best-of-8 ${best / 200} vs single ${one / 200}`);
});

const spread = vals => { const m = vals.reduce((a, b) => a + b, 0) / vals.length; return Math.sqrt(vals.reduce((a, b) => a + (b - m) ** 2, 0) / vals.length); };
const samples = Array.from({length: 3000}, (_, i) => [(i * 0.6180339) % 37, (i * 0.4142135) % 29]);

test('noise: smooth, centered, spread about 0.5', () => {
  const vals = samples.map(([x, y]) => gradientNoise(x, y, 3.3));
  close(spread(vals), 0.5, 0.06, 'spread');
  close(vals.reduce((a, b) => a + b, 0) / vals.length, 0, 0.05, 'mean');
  for (const [x, y] of samples.slice(0, 300)) assert.ok(Math.abs(gradientNoise(x, y, 1) - gradientNoise(x + 1e-4, y, 1)) < 0.01);
});

test('loops: the last frame meets the first, with no dip in contrast mid-fade', () => {
  for (const [period, rate] of [[4, 0.125], [8, 0.125], [6, 0.5], [2, 0.05]]) {
    for (const [x, y] of samples.slice(0, 200)) {
      const start = evolvingNoise(x, y, 0, 0, rate, period), end = evolvingNoise(x, y, 0, period - 1e-6, rate, period);
      close(end, start, 1e-4, `period ${period} wraps`);
      close(evolvingNoise(x, y, 0, 1e-3, rate, period), start, 0.02, 'continuous after the wrap');
    }
    const s0 = spread(samples.map(([x, y]) => evolvingNoise(x, y, 0, 0, rate, period)));
    const sMid = spread(samples.map(([x, y]) => evolvingNoise(x, y, 0, period / 2, rate, period)));
    close(sMid / s0, 1, 0.1, `period ${period}, rate ${rate}: middle vs start spread`);
  }
  assert.ok(loopLevel(0.5, 1) > 1.3); // without it, a long loop loses about a third of its contrast mid-fade
  close(loopLevel(0, 1), 1, 1e-12, 'no correction at the ends');
  close(correlation(0), 1, 1e-12, 'a field matches itself');
});

test('shader source: constants are filled in and sizes match the config', () => {
  assert.ok(FRAG.includes('uniform vec3 uStops[10]'));
  assert.ok(FRAG.includes('uniform vec2 uPoints[16]'));
  assert.ok(!FRAG.includes('${') && !FRAG.includes('undefined') && !FRAG.includes('NaN'));
  assert.ok(VERT.includes('gl_VertexID'));
});
