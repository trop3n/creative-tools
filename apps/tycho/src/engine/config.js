// TYCHO's settings: defaults, palettes, presets, and cleanConfig, which turns anything
// (old saves, links, files) into a valid config.
import {parseColor} from '@studio/core/gradient';
import {LED_RATIO, CUSTOM, cleanSide, isFrame, frameRatio} from '@studio/core/frames';
import {SHAPE_IDS, MOTION_IDS} from './modules.js';
import {rng} from './layout.js';

export const MAX_COLORS = 24;
export const ASPECTS = {'16:9': 16 / 9, '4:3': 4 / 3, '1:1': 1, '4:5': 4 / 5, '3:4': 3 / 4, '9:16': 9 / 16, led: LED_RATIO};

/** Width / height of the frame a config asks for (Custom size: its own width and height). */
export const aspectOf = c => frameRatio(c.aspect, ASPECTS, [c.customW, c.customH]);
export const SHUFFLE_MODES = {mixed: 'Mixed', all: 'New layout each cut', modules: 'Same layout, new modules'};
export const BEAT_CHOICES = [1, 2, 4, 8, 16];

export const PALETTES = [
  {id: 'full', name: 'Full 24', colors: [
    '#ff8fc8', '#e0218a', '#e8312a', '#ff7a1a', '#ffd23f', '#c6e03a', '#2fa84f', '#1aa39a',
    '#3fd0e0', '#7cc4f5', '#2350d8', '#14215e', '#c9a8f0', '#7a3fc0', '#7a4a2a', '#f4ecd8',
    '#141414', '#ffffff', '#ffb38a', '#a8e6c8', '#d9a521', '#5a2a4f', '#b8481f', '#4a5a6a',
  ]},
  {id: 'bauhaus', name: 'Bauhaus', colors: ['#e8312a', '#ffd23f', '#2350d8', '#141414', '#f4ecd8', '#ffffff']},
  {id: 'swiss', name: 'Swiss', colors: ['#e8312a', '#141414', '#ffffff', '#d8d8d8', '#ff7a1a']},
  {id: 'candy', name: 'Candy', colors: ['#ff8fc8', '#e0218a', '#c9a8f0', '#a8e6c8', '#7cc4f5', '#ffd23f', '#ffffff', '#7a3fc0']},
  {id: 'riso', name: 'Riso', colors: ['#ff48b0', '#0078bf', '#ffe800', '#00a95c', '#f2efe6', '#2d2a26']},
  {id: 'night', name: 'Night', colors: ['#14215e', '#7a3fc0', '#e0218a', '#3fd0e0', '#c6e03a', '#141414', '#ffffff']},
  {id: 'earth', name: 'Earth', colors: ['#7a4a2a', '#b8481f', '#d9a521', '#f4ecd8', '#2f6a3f', '#4a5a6a', '#141414']},
  {id: 'navygold', name: 'Navy and gold', colors: ['#00304e', '#242222', '#dfdfdf', '#505050', '#4c3046', '#c99530', '#90a344', '#ffffff']},
  {id: 'mono', name: 'Mono', colors: ['#141414', '#ffffff', '#8a8a8a', '#d8d8d8']},
];

export const DEFAULT_CONFIG = {
  seed: 7, // the layout
  moduleSeed: 11, // the modules
  grid: 4, // grid units on the frame's short side, 2..10
  depth: 5, // most splits, 1..8
  minCell: 1, // smallest cell side, in units, 1..4
  hold: 0.2, // chance a cell stops splitting early, 0..0.8
  gutter: 0, // gap between cells, as a fraction of a unit, 0..0.3
  gutterColor: '#141414',
  palette: 'full',
  colors: PALETTES[0].colors,
  perModule: 3, // colours per module, 2..4
  layers: 2, // most layers per module, 1..3
  scale: 1, // pattern scale, 0.5..2
  shapes: SHAPE_IDS,
  motions: MOTION_IDS,
  bpm: 120, // 40..200
  motionBeats: 4, // beats per motion loop
  shuffleBeats: 4, // beats between cuts, 0 = never
  rounds: 8, // cuts before the whole thing repeats, 1..16
  shuffleMode: 'mixed',
  aspect: '16:9',
  customW: CUSTOM.w,
  customH: CUSTOM.h,
};

const num = (v, lo, hi, d) => (typeof v === 'number' && isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
const color = (v, d) => (typeof v === 'string' && parseColor(v) ? v : d);
const subset = (v, all, d) => (Array.isArray(v) ? all.filter(x => v.includes(x)) : d);
const oneOf = (v, list, d) => (list.includes(v) ? v : d);

export function cleanConfig(raw = {}) {
  const d = DEFAULT_CONFIG, c = raw && typeof raw === 'object' ? raw : {};
  const colors = Array.isArray(c.colors) ? [...new Set(c.colors.map(x => color(x, null)).filter(Boolean))].slice(0, MAX_COLORS) : d.colors;
  const shapes = subset(c.shapes, SHAPE_IDS, d.shapes);
  return {
    seed: Math.floor(num(c.seed, 0, 1e9, d.seed)),
    moduleSeed: Math.floor(num(c.moduleSeed, 0, 1e9, d.moduleSeed)),
    grid: Math.round(num(c.grid, 2, 10, d.grid)),
    depth: Math.round(num(c.depth, 1, 8, d.depth)),
    minCell: Math.round(num(c.minCell, 1, 4, d.minCell)),
    hold: num(c.hold, 0, 0.8, d.hold),
    gutter: num(c.gutter, 0, 0.3, d.gutter),
    gutterColor: color(c.gutterColor, d.gutterColor),
    palette: typeof c.palette === 'string' ? c.palette : '',
    colors: colors.length >= 2 ? colors : d.colors,
    perModule: Math.round(num(c.perModule, 2, 4, d.perModule)),
    layers: Math.round(num(c.layers, 1, 3, d.layers)),
    scale: num(c.scale, 0.5, 2, d.scale),
    shapes: shapes.length ? shapes : d.shapes,
    motions: subset(c.motions, MOTION_IDS, d.motions),
    bpm: num(c.bpm, 40, 200, d.bpm),
    motionBeats: oneOf(c.motionBeats, BEAT_CHOICES, d.motionBeats),
    shuffleBeats: oneOf(c.shuffleBeats, [0, ...BEAT_CHOICES], d.shuffleBeats),
    rounds: Math.round(num(c.rounds, 1, 16, d.rounds)),
    shuffleMode: oneOf(c.shuffleMode, Object.keys(SHUFFLE_MODES), d.shuffleMode),
    aspect: isFrame(c.aspect, ASPECTS) ? c.aspect : d.aspect,
    customW: cleanSide(c.customW, d.customW),
    customH: cleanSide(c.customH, d.customH),
  };
}

/** A palette's colours, ready to merge into a config. */
export function paletteColors(id) {
  const p = PALETTES.find(x => x.id === id) || PALETTES[0];
  return {palette: p.id, colors: p.colors.slice()};
}

export const PRESETS = [
  {id: 'poster', name: 'Poster grid', config: {...paletteColors('full')}},
  {id: 'bauhaus', name: 'Bauhaus', config: {grid: 3, depth: 4, hold: 0.3, layers: 2, perModule: 3, ...paletteColors('bauhaus')}},
  {id: 'swiss', name: 'Swiss stripes', config: {grid: 4, depth: 5, layers: 1, perModule: 2, shapes: ['square', 'line', 'circle'], ...paletteColors('swiss')}},
  {id: 'candy', name: 'Candy tiles', config: {grid: 5, depth: 6, hold: 0.1, scale: 0.8, gutter: 0.06, gutterColor: '#ffffff', ...paletteColors('candy')}},
  {id: 'riso', name: 'Riso print', config: {grid: 3, depth: 4, layers: 3, perModule: 3, ...paletteColors('riso')}},
  {id: 'night', name: 'Night club', config: {grid: 4, depth: 5, bpm: 128, shuffleBeats: 2, motionBeats: 2, ...paletteColors('night')}},
  {id: 'calm', name: 'Slow earth', config: {grid: 3, depth: 3, hold: 0.35, bpm: 80, shuffleBeats: 8, motionBeats: 8, motions: ['rotate', 'scale', 'scrollX', 'expand'], ...paletteColors('earth')}},
  {id: 'navygold', name: 'Navy and gold', config: {grid: 4, depth: 5, hold: 0.25, perModule: 3, shuffleMode: 'modules', ...paletteColors('navygold')}},
  {id: 'mono', name: 'Mono op art', config: {grid: 4, depth: 5, layers: 1, perModule: 2, scale: 0.7, ...paletteColors('mono')}},
];

export const presetConfig = id => cleanConfig({...DEFAULT_CONFIG, ...(PRESETS.find(p => p.id === id) || PRESETS[0]).config});

/** A whole new look from a seed. */
export function randomConfig(seed = Math.floor(Math.random() * 1e9)) {
  const R = rng(seed);
  const pick = a => a[Math.floor(R() * a.length)];
  return cleanConfig({
    ...DEFAULT_CONFIG,
    seed,
    moduleSeed: Math.floor(R() * 1e9),
    grid: 3 + Math.floor(R() * 4),
    depth: 3 + Math.floor(R() * 4),
    hold: 0.05 + R() * 0.35,
    gutter: R() < 0.2 ? 0.04 + R() * 0.08 : 0,
    gutterColor: pick(['#141414', '#ffffff', '#f4ecd8']),
    ...paletteColors(pick(PALETTES).id),
    perModule: 2 + Math.floor(R() * 3),
    layers: 1 + Math.floor(R() * 3),
    scale: 0.7 + R() * 0.7,
    motionBeats: pick([2, 4, 4, 8]),
    shuffleBeats: pick([2, 4, 4, 8]),
    shuffleMode: pick(Object.keys(SHUFFLE_MODES)),
  });
}
