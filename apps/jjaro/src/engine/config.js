// JJARO's settings: defaults and cleanConfig, which turns anything (old saves, links,
// files) into a valid config.
import {parseColor} from '@studio/core/gradient';
import {LED_RATIO} from '@studio/core/frames';
import {SETUP_IDS, QUALITY, rng} from './cloth.js';
import {PATTERN_IDS, PRINT_IDS, MAX_LIGHTS} from './foil.js';

export const METALS = [
  {name: 'Silver', color: '#dfe3ea'},
  {name: 'Gold', color: '#e8c27a'},
  {name: 'Rose gold', color: '#e8b0a0'},
  {name: 'Gunmetal', color: '#7d838c'},
];
export const PAPERS = [
  {name: 'Cream', color: '#ece6da'},
  {name: 'White', color: '#f4f4f2'},
  {name: 'Black', color: '#1d1d1f'},
  {name: 'Navy', color: '#00304e'},
];

export const ASPECTS = {'4:5': 4 / 5, '1:1': 1, '9:16': 9 / 16, '16:9': 16 / 9, '3:4': 3 / 4, '4:3': 4 / 3, led: LED_RATIO};

export const DEFAULT_CONFIG = {
  setup: 'corners',
  quality: 'medium',
  seed: 1,
  stiffness: 0.3, // 0..1: how much folds spring back
  gravity: 1, // 0..2
  wind: 0.25, // 0..1
  tint: '#dfe3ea', // the foil's metal: silver, gold, rose…
  pattern: 'linear',
  rainbow: 0.8, // 0..1: how much light the grooves split into colour
  spacing: 1.2, // groove spacing, micrometres (0.6..2): finer spreads the rainbow wider
  spread: 0.3, // 0..1: how soft and wide each rainbow band is
  scale: 24, // tiles across the sheet (mosaic) or swirl size, 4..64
  angle: 0, // groove direction, degrees
  print: 'none', // none | kinegram | stamp | ink: what the artwork does
  artSize: 0.7, // 0.1..1: the artwork's width (or height) across the sheet
  invert: false, // print everywhere except the artwork
  paper: '#ece6da', // foil stamp: the paper under the foil
  ink: 0.9, // ink on foil: 0..1, how strong the inks are
  lights: 2, // 1..3
  lightSwing: 0.5, // 0..1: how far the lights sweep
  lightSize: 0.3, // 0..1: soft-box size
  period: 8, // seconds for the lights to come round again (the loop length)
  background: ['#2a2d34', '#0c0d10'], // backdrop center, edge
  glow: 0.3, // 0..1: soft light around the brightest highlights
  blur: 0, // 0..1: depth of field
  focus: 0.4, // 0..1: where it's sharp, from the sheet's nearest point to its farthest
  grain: 0, // 0..1: film grain
  orbit: 0, // degrees around the sheet
  elevation: 8, // degrees above it
  zoom: 1, // 0.6..2.5
  aspect: '4:5',
};

const num = (v, lo, hi, d) => (typeof v === 'number' && isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
const color = (v, d) => (typeof v === 'string' && parseColor(v) ? v : d);

export function cleanConfig(raw = {}) {
  const d = DEFAULT_CONFIG, c = raw && typeof raw === 'object' ? raw : {};
  return {
    setup: SETUP_IDS.includes(c.setup) ? c.setup : d.setup,
    quality: QUALITY[c.quality] ? c.quality : d.quality,
    seed: Math.floor(num(c.seed, 0, 1e9, d.seed)),
    stiffness: num(c.stiffness, 0, 1, d.stiffness),
    gravity: num(c.gravity, 0, 2, d.gravity),
    wind: num(c.wind, 0, 1, d.wind),
    tint: color(c.tint, d.tint),
    pattern: PATTERN_IDS.includes(c.pattern) ? c.pattern : d.pattern,
    rainbow: num(c.rainbow, 0, 1, d.rainbow),
    spacing: num(c.spacing, 0.6, 2, d.spacing),
    spread: num(c.spread, 0, 1, d.spread),
    scale: num(c.scale, 4, 64, d.scale),
    angle: num(c.angle, -90, 90, d.angle),
    print: PRINT_IDS.includes(c.print) ? c.print : d.print,
    artSize: num(c.artSize, 0.1, 1, d.artSize),
    invert: typeof c.invert === 'boolean' ? c.invert : d.invert,
    paper: color(c.paper, d.paper),
    ink: num(c.ink, 0, 1, d.ink),
    lights: Math.round(num(c.lights, 1, MAX_LIGHTS, d.lights)),
    lightSwing: num(c.lightSwing, 0, 1, d.lightSwing),
    lightSize: num(c.lightSize, 0, 1, d.lightSize),
    period: num(c.period, 4, 20, d.period),
    background: Array.isArray(c.background) && c.background.length === 2 ? c.background.map((s, i) => color(s, d.background[i])) : d.background,
    glow: num(c.glow, 0, 1, d.glow),
    blur: num(c.blur, 0, 1, d.blur),
    focus: num(c.focus, 0, 1, d.focus),
    grain: num(c.grain, 0, 1, d.grain),
    orbit: num(c.orbit, -180, 180, d.orbit),
    elevation: num(c.elevation, -30, 70, d.elevation),
    zoom: num(c.zoom, 0.6, 2.5, d.zoom),
    aspect: ASPECTS[c.aspect] ? c.aspect : d.aspect,
  };
}

/** Settings that need a fresh sheet when they change. */
export const REBUILD_KEYS = ['setup', 'quality', 'seed'];

export const PRESETS = [
  {id: 'hung', name: 'Silver, hung', config: {}},
  {id: 'banner', name: 'Gold kinegram banner', config: {setup: 'edge', tint: '#e8c27a', print: 'kinegram', artSize: 0.7, rainbow: 1, lights: 2, lightSize: 0.45, lightSwing: 0.7, wind: 0.25}},
  {id: 'halo', name: 'Rose-gold rings over a ball', config: {setup: 'drape', tint: '#e8b0a0', pattern: 'rings', rainbow: 0.9, spread: 0.45, elevation: 14}},
  {id: 'crumple', name: 'Crumpled mosaic', config: {setup: 'heap', pattern: 'cells', scale: 40, rainbow: 0.9, lights: 3, lightSize: 0.2}},
  {id: 'drift', name: 'Swirl adrift', config: {setup: 'float', pattern: 'swirl', scale: 16, spacing: 1.5, spread: 0.5, wind: 0.4, background: ['#2e2a36', '#0d0b10']}},
  {id: 'stamp', name: 'Gold stamp on navy', config: {print: 'stamp', tint: '#e8c27a', paper: '#00304e', pattern: 'cells', scale: 32, wind: 0.15}},
  {id: 'gunmetal', name: 'Gunmetal drape', config: {setup: 'drape', tint: '#7d838c', pattern: 'linear', angle: 35, rainbow: 1, spacing: 0.8, lights: 3, background: ['#30343a', '#0a0b0d']}},
  {id: 'security', name: 'Security film', config: {setup: 'float', print: 'kinegram', invert: true, artSize: 0.8, pattern: 'linear', angle: 20, wind: 0.2, spread: 0.15}},
];

/** A preset, keeping the detail and frame shape already chosen (they suit the device and the output). */
export function presetConfig(id, keep = DEFAULT_CONFIG) {
  const p = PRESETS.find(x => x.id === id) || PRESETS[0];
  return cleanConfig({...DEFAULT_CONFIG, quality: keep.quality, aspect: keep.aspect, ...p.config});
}

/** A whole new look from a seed, keeping the detail and frame shape. */
export function randomConfig(keep = DEFAULT_CONFIG, seed = Math.floor(Math.random() * 1e9)) {
  const R = rng(seed);
  const pick = a => a[Math.floor(R() * a.length)];
  const p = R();
  // Mostly a known metal; sometimes any light, slightly coloured one.
  const tint = R() < 0.75 ? pick(METALS).color : '#' + [0, 0, 0].map(() => Math.floor(170 + R() * 80).toString(16)).join('');
  return cleanConfig({
    ...DEFAULT_CONFIG,
    quality: keep.quality,
    aspect: keep.aspect,
    seed,
    setup: pick(SETUP_IDS),
    stiffness: 0.1 + R() * 0.6,
    wind: R() * 0.5,
    tint,
    pattern: pick(PATTERN_IDS),
    rainbow: 0.5 + R() * 0.5,
    spacing: 0.7 + R() * 1.1,
    spread: R() * 0.7,
    scale: Math.round(8 + R() * 40),
    angle: Math.round((R() - 0.5) * 180),
    print: p < 0.6 ? 'none' : p < 0.85 ? 'kinegram' : 'stamp',
    artSize: 0.4 + R() * 0.5,
    paper: pick(PAPERS).color,
    lights: 1 + Math.floor(R() * MAX_LIGHTS),
    lightSwing: 0.2 + R() * 0.7,
    lightSize: 0.1 + R() * 0.5,
    orbit: Math.round((R() - 0.5) * 50),
  });
}
