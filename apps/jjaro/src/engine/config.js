// JJARO's settings: defaults and cleanConfig, which turns anything (old saves, links,
// files) into a valid config.
import {parseColor} from '@studio/core/gradient';
import {SETUP_IDS, QUALITY} from './cloth.js';
import {PATTERN_IDS, PRINT_IDS, MAX_LIGHTS} from './foil.js';

export const ASPECTS = {'4:5': 4 / 5, '1:1': 1, '9:16': 9 / 16, '16:9': 16 / 9, '3:4': 3 / 4};

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
    orbit: num(c.orbit, -180, 180, d.orbit),
    elevation: num(c.elevation, -30, 70, d.elevation),
    zoom: num(c.zoom, 0.6, 2.5, d.zoom),
    aspect: ASPECTS[c.aspect] ? c.aspect : d.aspect,
  };
}

/** Settings that need a fresh sheet when they change. */
export const REBUILD_KEYS = ['setup', 'quality', 'seed'];
