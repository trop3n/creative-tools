// LEELA's settings: one plain object describes a gradient completely, so it can be
// saved, shared, randomized and animated. cleanConfig() takes anything (a saved
// file, a URL) and returns a valid config, falling back to defaults field by field.
import {parseColor} from './color.js';

export const SHAPES = ['blob', 'pill', 'band', 'ring', 'mesh'];
export const MOTIONS = ['drift', 'breathe', 'flow', 'none'];
export const MAX_STOPS = 10;
export const MAX_POINTS = 16;

export const DEFAULT_CONFIG = {
  version: 1,
  seed: 1,
  shape: 'blob',
  center: [0.5, 0.5], // 0..1 across and down the frame
  size: [0.95, 0.75], // fraction of the frame's short side
  roundness: 0.7, // 0 boxy … 1 elliptical
  softness: 0.55, // edge falloff
  rotation: 0, // degrees
  ramp: 0.35, // 0 = colors run from the middle out, 1 = along `angle`
  angle: 90, // degrees, for the linear part of the ramp
  warp: 0.35, // how far noise pushes the shape around
  warpScale: 1.4, // size of the warping features (0.5 broad … 4 fine)
  palette: ['#00304e', '#4c3046', '#c99530', '#dfdfdf'],
  background: '#242222',
  mesh: [], // mesh shape: [{x, y, color}], x/y in 0..1
  grain: 0.35,
  motion: 'drift',
  speed: 0.5, // 0..2
  loop: 0, // seconds for a seamless loop; 0 = runs on forever
};

const num = (v, lo, hi, d) => (typeof v === 'number' && isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
const color = (v, d) => (parseColor(v) ? String(v).trim() : d);
const pair = (v, lo, hi, d) => (Array.isArray(v) && v.length === 2 ? [num(v[0], lo, hi, d[0]), num(v[1], lo, hi, d[1])] : d.slice());

/** Any input → a valid config. Unknown fields are dropped; bad values fall back. */
export function cleanConfig(raw = {}) {
  const r = raw && typeof raw === 'object' ? raw : {}, d = DEFAULT_CONFIG;
  const palette = (Array.isArray(r.palette) ? r.palette : []).filter(c => parseColor(c)).slice(0, MAX_STOPS).map(c => String(c).trim());
  const mesh = (Array.isArray(r.mesh) ? r.mesh : [])
    .filter(p => p && typeof p === 'object' && parseColor(p.color))
    .slice(0, MAX_POINTS)
    .map(p => ({x: num(p.x, 0, 1, 0.5), y: num(p.y, 0, 1, 0.5), color: String(p.color).trim()}));
  return {
    version: 1,
    seed: Math.round(num(r.seed, 0, 1e9, d.seed)),
    shape: SHAPES.includes(r.shape) ? r.shape : d.shape,
    center: pair(r.center, 0, 1, d.center),
    size: pair(r.size, 0.02, 1.5, d.size),
    roundness: num(r.roundness, 0, 1, d.roundness),
    softness: num(r.softness, 0, 1, d.softness),
    rotation: num(r.rotation, -360, 360, d.rotation),
    ramp: num(r.ramp, 0, 1, d.ramp),
    angle: num(r.angle, -360, 360, d.angle),
    warp: num(r.warp, 0, 1, d.warp),
    warpScale: num(r.warpScale, 0.5, 4, d.warpScale),
    palette: palette.length >= 2 ? palette : d.palette.slice(),
    background: color(r.background, d.background),
    mesh,
    grain: num(r.grain, 0, 1, d.grain),
    motion: MOTIONS.includes(r.motion) ? r.motion : d.motion,
    speed: num(r.speed, 0, 2, d.speed),
    loop: num(r.loop, 0, 30, d.loop),
  };
}

/* ---------- presets ---------- */

export const PRESETS = [
  {id: 'brand', name: 'Navy and gold', config: {seed: 3, shape: 'blob', palette: ['#00304e', '#4c3046', '#c99530', '#dfdfdf'], background: '#242222', size: [1.5, 1.15], softness: 0.7, ramp: 0.2, warp: 0.4}},
  {id: 'meadow', name: 'Meadow', config: {seed: 11, shape: 'pill', rotation: -18, palette: ['#1f3b2c', '#90a344', '#e8e2b0'], background: '#101712', roundness: 0.35, size: [1.3, 0.55], ramp: 0.8, angle: 20}},
  {id: 'lagoon', name: 'Lagoon', config: {seed: 27, shape: 'ring', palette: ['#0b2a4a', '#1d7a8c', '#7fd1c7', '#f2f7f2'], background: '#06121f', size: [1.1, 1.1], softness: 0.7, warp: 0.5}},
  {id: 'ember', name: 'Ember', config: {seed: 42, shape: 'band', rotation: -12, palette: ['#2a0d0a', '#a3271b', '#f0812a', '#ffd38a'], background: '#140605', size: [1, 0.6], softness: 0.75, ramp: 0.6, angle: 100}},
  {id: 'haze', name: 'Morning haze', config: {seed: 8, shape: 'mesh', grain: 0.25, background: '#e9e4dc',
    mesh: [{x: 0.18, y: 0.22, color: '#f4c7b0'}, {x: 0.78, y: 0.18, color: '#c8d8f0'}, {x: 0.55, y: 0.62, color: '#f6ead0'}, {x: 0.2, y: 0.85, color: '#d6c4e8'}, {x: 0.88, y: 0.82, color: '#b9e0d2'}]}},
  {id: 'plum', name: 'Plum night', config: {seed: 64, shape: 'mesh', grain: 0.45, background: '#1b1420', motion: 'flow',
    mesh: [{x: 0.25, y: 0.3, color: '#4c3046'}, {x: 0.75, y: 0.25, color: '#00304e'}, {x: 0.5, y: 0.75, color: '#c99530'}, {x: 0.12, y: 0.8, color: '#1b1420'}, {x: 0.9, y: 0.7, color: '#8c5a6e'}]}},
];

export const presetConfig = id => cleanConfig({...DEFAULT_CONFIG, ...(PRESETS.find(p => p.id === id) || PRESETS[0]).config});

/* ---------- randomizer ---------- */

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Palette families: a hue plan over Oklch, so random palettes still feel chosen.
const FAMILIES = [
  {name: 'analogous', hues: h => [h - 30, h, h + 30, h + 50]},
  {name: 'complement', hues: h => [h, h + 20, h + 180, h + 200]},
  {name: 'triad', hues: h => [h, h + 120, h + 240]},
  {name: 'warm', hues: () => [20, 45, 70, 90]},
  {name: 'cool', hues: () => [180, 215, 250, 290]},
  {name: 'mono', hues: h => [h, h, h, h]},
];

const oklch = (L, C, H) => `oklch(${L.toFixed(3)} ${C.toFixed(3)} ${(((H % 360) + 360) % 360).toFixed(1)})`;

/** Best of `tries` random layouts: the one whose closest two points are farthest apart. */
export function spreadPoints(rand, n, tries = 8) {
  let best = null, bestGap = -1;
  for (let k = 0; k < tries; k++) {
    const pts = Array.from({length: n}, () => [0.08 + 0.84 * rand(), 0.08 + 0.84 * rand()]);
    let gap = Infinity;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) gap = Math.min(gap, Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]));
    if (gap > bestGap) { bestGap = gap; best = pts; }
  }
  return best;
}

/** A pleasing random config from a seed (same seed, same result). */
export function randomConfig(seed = Math.floor(Math.random() * 1e9)) {
  const rand = mulberry32(seed), pick = a => a[Math.floor(rand() * a.length)];
  const family = pick(FAMILIES), base = rand() * 360, dark = rand() < 0.6;
  const hues = family.hues(base);
  const palette = hues.map((h, i) => {
    const t = hues.length > 1 ? i / (hues.length - 1) : 0;
    // Lightness climbs along the ramp; chroma peaks in the middle.
    const L = dark ? 0.28 + 0.62 * t : 0.55 + 0.38 * t;
    const C = (family.name === 'mono' ? 0.05 : 0.09) + 0.08 * Math.sin(Math.PI * t) + 0.03 * rand();
    return oklch(L, C, h + (rand() - 0.5) * 16);
  });
  const background = dark ? oklch(0.16 + 0.06 * rand(), 0.02 + 0.03 * rand(), base) : oklch(0.94 + 0.03 * rand(), 0.01 + 0.02 * rand(), base + 30);
  const shape = pick(SHAPES);
  const cfg = {
    seed, shape, palette, background,
    center: [0.35 + 0.3 * rand(), 0.35 + 0.3 * rand()],
    size: [0.7 + 0.6 * rand(), 0.45 + 0.5 * rand()],
    roundness: rand(), softness: 0.3 + 0.6 * rand(), rotation: Math.round((rand() - 0.5) * 90),
    ramp: rand(), angle: Math.round(rand() * 360),
    warp: 0.15 + 0.5 * rand(), warpScale: +(0.8 + 2 * rand()).toFixed(2),
    grain: +(0.15 + 0.4 * rand()).toFixed(2),
    motion: pick(['drift', 'drift', 'breathe', 'flow']), speed: +(0.3 + 0.6 * rand()).toFixed(2),
  };
  if (shape === 'mesh') {
    const n = 4 + Math.floor(rand() * 3), pts = spreadPoints(rand, n);
    const colors = [...palette, background];
    cfg.mesh = pts.map(([x, y], i) => ({x: +x.toFixed(3), y: +y.toFixed(3), color: colors[i % colors.length]}));
  }
  return cleanConfig({...DEFAULT_CONFIG, ...cfg});
}
