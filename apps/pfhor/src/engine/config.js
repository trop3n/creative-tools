// PFHOR's settings: defaults, palettes, presets, and cleanConfig, which turns anything
// (old saves, links, files) into a valid config.
import {parseColor} from '@studio/core/gradient';
import {LED_RATIO, CUSTOM, cleanSide, isFrame, frameRatio} from '@studio/core/frames';
import {SHAPES, METRICS, MAPPINGS} from './mosaic.js';

export const ASPECTS = {'3:4': 3 / 4, '4:5': 4 / 5, '1:1': 1, '9:16': 9 / 16, '16:9': 16 / 9, '4:3': 4 / 3, led: LED_RATIO};

/** Width / height of the frame a config asks for (Custom size: its own width and height). */
export const aspectOf = c => frameRatio(c.aspect, ASPECTS, [c.customW, c.customH]);
export const SAMPLE_IDS = ['portrait', 'spheres', 'type'];
export const MAX_COLORS = 16;

export const PALETTES = [
  {id: 'robo', name: 'Full 14', colors: ['#141414', '#14215e', '#7a4a2a', '#7a3fc0', '#e8312a', '#2350d8', '#e0218a', '#1aa39a', '#2fa84f', '#ff8fc8', '#7cc4f5', '#a8e6c8', '#ffd23f', '#f4ecd8']},
  {id: 'ketchup', name: 'Ketchup', colors: ['#141414', '#7a4a2a', '#e8312a', '#2fa84f', '#ffd23f', '#f4ecd8']},
  {id: 'blueprint', name: 'Blueprint', colors: ['#14215e', '#2350d8', '#7cc4f5', '#ff8fc8', '#f4ecd8']},
  {id: 'tealpop', name: 'Teal pop', colors: ['#141414', '#1aa39a', '#e0218a', '#ff8fc8', '#f4ecd8']},
  {id: 'sorbet', name: 'Sorbet', colors: ['#7a3fc0', '#e0218a', '#ff7a1a', '#ffd23f', '#a8e6c8', '#ffffff']},
  {id: 'navygold', name: 'Navy and gold', colors: ['#242222', '#00304e', '#4c3046', '#505050', '#90a344', '#c99530', '#dfdfdf']},
  {id: 'mono', name: 'Mono', colors: ['#141414', '#505050', '#9a9a9a', '#dcdcdc', '#ffffff']},
];

export const DEFAULT_CONFIG = {
  sample: 'portrait',
  mapping: 'ramp',
  order: 'light', // ramp order: 'light' (dark to light) or 'listed'
  palette: 'robo',
  colors: PALETTES[0].colors,
  contrast: 1.15, // 0.5..2.5
  brightness: 0, // -0.4..0.4
  detail: 384, // analysis size, long side, 128..640
  roots: 4, // root cells across the short side, 1..8
  maxDepth: 6, // 1..8
  minSize: 3, // smallest cell, analysis pixels, 2..32
  threshold: 0.08, // split when detail exceeds this, 0.01..0.5
  metric: 'both',
  shape: 'circle',
  fill: 0.94, // circle size within its cell, 0.4..1
  gap: 0.06, // square inset, 0..0.4
  stroke: 1.5, // outline in px on a 1080 px frame, 0..6
  strokeColor: '#1c1a1a',
  background: '#e9e2d8',
  resolve: 0, // 0..1: coarsen toward mid-loop and back
  scatter: 0, // 0..1: fling cells out mid-loop and back
  loop: 6, // seconds, 2..30
  aspect: '3:4',
  customW: CUSTOM.w,
  customH: CUSTOM.h,
  mirror: true, // webcam
};

const num = (v, lo, hi, d) => (typeof v === 'number' && isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
const hex = (v, d) => (typeof v === 'string' && /^#[\da-f]{6}$/i.test(v) ? v.toLowerCase() : d);
const oneOf = (v, list, d) => (list.includes(v) ? v : d);

export function cleanConfig(raw = {}) {
  const d = DEFAULT_CONFIG, c = raw && typeof raw === 'object' ? raw : {};
  const colors = Array.isArray(c.colors) ? c.colors.map(x => hex(x, null)).filter(x => x && parseColor(x)).slice(0, MAX_COLORS) : d.colors;
  return {
    sample: oneOf(c.sample, SAMPLE_IDS, d.sample),
    mapping: oneOf(c.mapping, Object.keys(MAPPINGS), d.mapping),
    order: oneOf(c.order, ['light', 'listed'], d.order),
    palette: typeof c.palette === 'string' ? c.palette : '',
    colors: colors.length >= 2 ? colors : d.colors,
    contrast: num(c.contrast, 0.5, 2.5, d.contrast),
    brightness: num(c.brightness, -0.4, 0.4, d.brightness),
    detail: Math.round(num(c.detail, 128, 640, d.detail)),
    roots: Math.round(num(c.roots, 1, 8, d.roots)),
    maxDepth: Math.round(num(c.maxDepth, 1, 8, d.maxDepth)),
    minSize: num(c.minSize, 2, 32, d.minSize),
    threshold: num(c.threshold, 0.01, 0.5, d.threshold),
    metric: oneOf(c.metric, Object.keys(METRICS), d.metric),
    shape: oneOf(c.shape, Object.keys(SHAPES), d.shape),
    fill: num(c.fill, 0.4, 1, d.fill),
    gap: num(c.gap, 0, 0.4, d.gap),
    stroke: num(c.stroke, 0, 6, d.stroke),
    strokeColor: hex(c.strokeColor, d.strokeColor),
    background: hex(c.background, d.background),
    resolve: num(c.resolve, 0, 1, d.resolve),
    scatter: num(c.scatter, 0, 1, d.scatter),
    loop: num(c.loop, 2, 30, d.loop),
    aspect: isFrame(c.aspect, ASPECTS) ? c.aspect : d.aspect,
    customW: cleanSide(c.customW, d.customW),
    customH: cleanSide(c.customH, d.customH),
    mirror: typeof c.mirror === 'boolean' ? c.mirror : d.mirror,
  };
}

export function paletteColors(id) {
  const p = PALETTES.find(x => x.id === id) || PALETTES[0];
  return {palette: p.id, colors: p.colors.slice()};
}

export const PRESETS = [
  {id: 'dots', name: 'Dot portrait', config: {...paletteColors('robo')}},
  {id: 'mondrian', name: 'Mondrian pixels', config: {shape: 'square', gap: 0, stroke: 2, threshold: 0.1, ...paletteColors('ketchup')}},
  {id: 'resolve', name: 'Resolve loop', config: {resolve: 0.6, ...paletteColors('blueprint')}},
  {id: 'scatter', name: 'Scatter and re-form', config: {scatter: 0.8, resolve: 0.3, loop: 8, ...paletteColors('tealpop')}},
  {id: 'mixed', name: 'Mixed shapes', config: {shape: 'mixed', gap: 0.1, threshold: 0.06, ...paletteColors('sorbet')}},
  {id: 'true', name: 'True color', config: {mapping: 'nearest', threshold: 0.05, minSize: 2, stroke: 1, ...paletteColors('robo')}},
  {id: 'navygold', name: 'Navy and gold', config: {shape: 'rounded', gap: 0.08, background: '#dfdfdf', ...paletteColors('navygold')}},
  {id: 'mono', name: 'Mono print', config: {shape: 'circle', fill: 1, stroke: 0, threshold: 0.05, background: '#ffffff', ...paletteColors('mono')}},
];

export const presetConfig = id => cleanConfig({...DEFAULT_CONFIG, ...(PRESETS.find(p => p.id === id) || PRESETS[0]).config});
