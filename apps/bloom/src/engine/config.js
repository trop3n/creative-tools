// BLOOM's settings: defaults, colour palettes, scene presets, and cleanConfig, which
// turns anything (old saves, links, files) into a valid config.
import {parseColor} from '@studio/core/gradient';
import {SPECIES_IDS, rng} from './plant.js';

export const MAX_RAMPS = 6;
export const MAX_RAMP_STOPS = 5;
export const ASPECTS = {'3:4': 3 / 4, '4:5': 4 / 5, '9:16': 9 / 16, '1:1': 1, '16:9': 16 / 9};

/** Palettes: petal ramps (base → tip), stem greens (shadow, light) and a backdrop (top, middle, bottom). */
export const PALETTES = [
  {id: 'sorbet', name: 'Sorbet',
    ramps: [['#ffd23f', '#ff7a1a', '#e8302a', '#f25c8a'], ['#2f9d63', '#3f8fe0', '#5bb8f0', '#b07ce8'], ['#ffe066', '#ff9f1c', '#ff5d8f', '#ffb3cf'], ['#e8302a', '#ff6b6b', '#ffa3c4']],
    stem: ['#0b5b34', '#46c26e'], background: ['#f4f2ec', '#a8d8df', '#f6aacb']},
  {id: 'ember', name: 'Ember',
    ramps: [['#ffe14d', '#ff8a00', '#e8302a', '#c2185b'], ['#ffd6e7', '#ff6fa8', '#ff3d6e'], ['#7fd8ff', '#3d7bff', '#a35cff', '#ff7ad1'], ['#fff1a8', '#ffb000', '#ff5a1f']],
    stem: ['#0a5a3a', '#3fc27a'], background: ['#000000', '#000000', '#000000']},
  {id: 'prism', name: 'Prism',
    ramps: [['#ff3b3b', '#ffb000', '#3ddc84', '#3d8bff', '#b44dff'], ['#ff6fa8', '#ffd23f', '#2de0c8', '#3d6bff'], ['#3ddc84', '#3d8bff', '#ff4fd8', '#ff3b3b'], ['#ffd23f', '#ff5d8f', '#7b4dff']],
    stem: ['#0b5b34', '#5ad27e'], background: ['#ff6a3d', '#f04e98', '#c9c4bd']},
  {id: 'lagoon', name: 'Lagoon',
    ramps: [['#ffffff', '#ff9ec4', '#ff4f8b'], ['#ffe066', '#ff8a3d', '#e83f6f'], ['#9be7ff', '#4f8dff', '#7b4dff'], ['#e6b3ff', '#a35cff', '#5b2bd6']],
    stem: ['#0b5b34', '#46c26e'], background: ['#3fe0b0', '#0d4a6b', '#020814']},
  {id: 'sunset', name: 'Sunset',
    ramps: [['#fff0a0', '#ff9a3c', '#e8302a'], ['#5bc0ff', '#7b6dff', '#d65cff'], ['#ffd0e0', '#ff5d8f', '#d6286b'], ['#ff7a1a', '#ff3d6e', '#ffd23f']],
    stem: ['#0b5b34', '#46c26e'], background: ['#ff5a2a', '#e8457f', '#ffc23d']},
  {id: 'dusk', name: 'Dusk',
    ramps: [['#ffe066', '#ff7a1a', '#e8302a'], ['#9d8cff', '#6a5cff', '#3d3dd6'], ['#ffd6e7', '#ff8fb8', '#e8457f']],
    stem: ['#0b5b34', '#46c26e'], background: ['#140d0a', '#5a3524', '#b48ce0']},
  {id: 'mist', name: 'Mist',
    ramps: [['#ff7aa8', '#ffb3cf', '#fff0f5'], ['#7fd8ff', '#b8e8ff', '#ffffff'], ['#ffe066', '#ffb3cf', '#c8a8ff']],
    stem: ['#2c7a55', '#86d9a4'], background: ['#e9f1f2', '#a9d3dc', '#dfe9ea']},
];

export const DEFAULT_CONFIG = {
  seed: 1234,
  species: ['carnation'],
  stems: 3, // 1..7
  branching: 0.5, // 0..1: side branches (and flowers) per stem
  height: 1, // 0.6..1.4
  wander: 0.5, // 0..1: how much stems meander
  leaves: 0.6, // 0..1
  bloomSize: 1, // 0.5..1.8
  palette: 'sorbet',
  ramps: PALETTES[0].ramps,
  stem: PALETTES[0].stem,
  background: PALETTES[0].background,
  speed: 1, // growth speed, 0.25..3
  sway: 0.4, // wind, 0..1
  drift: 0.4, // camera drift, 0..1
  zoom: 1, // 0.6..3
  orbit: 0, // degrees around the plant
  elevation: 6, // degrees above the horizon
  blur: 0, // depth of field, 0..1
  focus: 0.4, // 0 = nearest, 1 = furthest
  cycle: 0, // seconds between regrowths with a new seed; 0 grows once
  aspect: '3:4',
};

const num = (v, lo, hi, d) => (typeof v === 'number' && isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
const color = (v, d) => (typeof v === 'string' && parseColor(v) ? v : d);

export function cleanConfig(raw = {}) {
  const d = DEFAULT_CONFIG, c = raw && typeof raw === 'object' ? raw : {};
  const species = Array.isArray(c.species) ? [...new Set(c.species.filter(s => SPECIES_IDS.includes(s)))] : d.species;
  const ramps = Array.isArray(c.ramps)
    ? c.ramps.filter(Array.isArray).slice(0, MAX_RAMPS).map(r => r.slice(0, MAX_RAMP_STOPS).map(s => color(s, '#ff00aa'))).filter(r => r.length >= 2)
    : d.ramps;
  const triple = (v, def, n) => (Array.isArray(v) && v.length === n ? v.map((s, i) => color(s, def[i])) : def);
  return {
    seed: Math.floor(num(c.seed, 0, 1e9, d.seed)),
    species: species.length ? species : d.species,
    stems: Math.round(num(c.stems, 1, 7, d.stems)),
    branching: num(c.branching, 0, 1, d.branching),
    height: num(c.height, 0.6, 1.4, d.height),
    wander: num(c.wander, 0, 1, d.wander),
    leaves: num(c.leaves, 0, 1, d.leaves),
    bloomSize: num(c.bloomSize, 0.5, 1.8, d.bloomSize),
    palette: typeof c.palette === 'string' ? c.palette : '',
    ramps: ramps.length ? ramps : d.ramps,
    stem: triple(c.stem, d.stem, 2),
    background: triple(c.background, d.background, 3),
    speed: num(c.speed, 0.25, 3, d.speed),
    sway: num(c.sway, 0, 1, d.sway),
    drift: num(c.drift, 0, 1, d.drift),
    zoom: num(c.zoom, 0.6, 3, d.zoom),
    orbit: num(c.orbit, -180, 180, d.orbit),
    elevation: num(c.elevation, -20, 45, d.elevation),
    blur: num(c.blur, 0, 1, d.blur),
    focus: num(c.focus, 0, 1, d.focus),
    cycle: num(c.cycle, 0, 30, d.cycle),
    aspect: ASPECTS[c.aspect] ? c.aspect : d.aspect,
  };
}

/** A palette's colours, ready to merge into a config. */
export function paletteColors(id) {
  const p = PALETTES.find(x => x.id === id) || PALETTES[0];
  return {palette: p.id, ramps: p.ramps.map(r => r.slice()), stem: p.stem.slice(), background: p.background.slice()};
}

export const PRESETS = [
  {id: 'carnations', name: 'Carnation bouquet', config: {species: ['carnation'], stems: 3, branching: 0.5, ...paletteColors('sorbet')}},
  {id: 'single', name: 'Single stem', config: {species: ['carnation'], stems: 1, branching: 0.35, leaves: 0.8, zoom: 1.1, ...paletteColors('sorbet')}},
  {id: 'lilies', name: 'Lilies at night', config: {species: ['lily'], stems: 2, branching: 0.55, bloomSize: 1.1, ...paletteColors('ember')}},
  {id: 'tulips', name: 'Prism tulips', config: {species: ['tulip'], stems: 5, branching: 0.15, leaves: 0.5, bloomSize: 1.3, zoom: 1.6, blur: 0.45, focus: 0.35, ...paletteColors('prism')}},
  {id: 'wild', name: 'Wildflower mix', config: {species: ['daisy', 'cosmos', 'carnation', 'dahlia', 'lily'], stems: 4, branching: 0.7, ...paletteColors('lagoon')}},
  {id: 'sunset', name: 'Sunset carnations', config: {species: ['carnation', 'dahlia'], stems: 3, branching: 0.5, height: 1.2, ...paletteColors('sunset')}},
  {id: 'dusk', name: 'Dahlias at dusk', config: {species: ['dahlia', 'carnation'], stems: 3, branching: 0.4, ...paletteColors('dusk')}},
  {id: 'dream', name: 'Dreamy close-up', config: {species: ['lily', 'daisy', 'carnation', 'tulip'], stems: 5, branching: 0.8, zoom: 2.2, blur: 0.6, focus: 0.15, drift: 0.7, ...paletteColors('mist')}},
];

export const presetConfig = id => cleanConfig({...DEFAULT_CONFIG, ...(PRESETS.find(p => p.id === id) || PRESETS[0]).config});

/** A whole new scene from a seed. */
export function randomConfig(seed = Math.floor(Math.random() * 1e9)) {
  const R = rng(seed);
  const pick = a => a[Math.floor(R() * a.length)];
  const nSpecies = R() < 0.55 ? 1 : 2 + Math.floor(R() * 3);
  const species = [...SPECIES_IDS].sort(() => R() - 0.5).slice(0, nSpecies);
  const dreamy = R() < 0.2;
  return cleanConfig({
    ...DEFAULT_CONFIG,
    seed,
    species,
    stems: 1 + Math.floor(R() * 5),
    branching: 0.2 + R() * 0.7,
    height: 0.8 + R() * 0.4,
    wander: 0.2 + R() * 0.7,
    leaves: 0.3 + R() * 0.6,
    bloomSize: 0.8 + R() * 0.6,
    ...paletteColors(pick(PALETTES).id),
    sway: 0.2 + R() * 0.5,
    drift: 0.2 + R() * 0.5,
    zoom: dreamy ? 1.8 + R() * 0.8 : 1 + R() * 0.3,
    orbit: Math.round((R() - 0.5) * 60),
    blur: dreamy ? 0.5 + R() * 0.4 : 0,
    focus: 0.3 + R() * 0.4,
  });
}
