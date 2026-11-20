// THOTH's settings: defaults, presets, and cleanConfig, which turns anything (old saves,
// links, files) into a valid config.
import {MOTIONS, BACKDROPS, FILLS, SHAPES} from './source.js';
import {DOT_SHAPES} from './halftone.js';

export const ASPECTS = {'16:9': 16 / 9, '4:3': 4 / 3, '1:1': 1, '4:5': 4 / 5, '3:4': 3 / 4, '9:16': 9 / 16};
export const MODES = {rgb: 'RGB', cmyk: 'CMYK', mono: 'Mono'};
export const WEIGHTS = [400, 500, 600, 700, 900];

const fill = (kind, a, b = '#ffffff', angle = 0, hue = 0) => ({kind, a, b, angle, hue});

export const DEFAULT_CONFIG = {
  mode: 'rgb',
  pitch: 16, // dot pitch in px on a frame 1080 px on its short side, 4..80
  dot: 1.15, // dot size, 0.4..2 (over 1 lets dots merge)
  dotShape: 'circle',
  angle: 0, // screen angle, -90..90
  spread: 0, // RGB: degrees between channel screens, 0..45
  split: 0.15, // RGB: channel offset as a fraction of the pitch, 0..0.5
  gcr: 1, // CMYK: how much grey goes to black ink, 0..1
  background: '#000000', // RGB
  paper: '#f4efe4', // CMYK and Mono
  ink: '#141414', // Mono
  invert: false, // Mono: dots for light instead of dark
  showSource: false,
  loop: 6, // seconds, 2..30
  hueCycles: 1, // hue turns per loop, 0..8
  hueSteps: 0, // 0 = smooth, else this many hard steps per turn
  backdrop: {kind: 'solid', colors: ['#000000', '#3f6bff', '#ff3d8b'], hue: false, angle: 30, count: 4, motion: 'still', speed: 1, amount: 0.5},
  media: {on: true, fit: 'cover', scale: 1, contrast: 1.2, brightness: 1, motion: 'still', speed: 1, amount: 0.5},
  shape: {on: false, kind: 'heart', size: 0.55, count: 1, fill: fill('hue', '#ff3355'), motion: 'pulse', speed: 1, amount: 0.5},
  text: {on: true, text: 'MAKE\nYOUR OWN\nTOOLS', weight: 900, size: 0.24, tracking: 0, leading: 0.95, fill: fill('hue', '#ffffff'), motion: 'zoom', speed: 1, amount: 0.35},
  aspect: '16:9',
};

const num = (v, lo, hi, d) => (typeof v === 'number' && isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
const hex = (v, d) => (typeof v === 'string' && /^#[\da-f]{6}$/i.test(v) ? v.toLowerCase() : d);
const oneOf = (v, obj, d) => (Object.prototype.hasOwnProperty.call(obj, v) ? v : d);
const obj = v => (v && typeof v === 'object' ? v : {});

function cleanMotion(c, d) {
  return {motion: oneOf(c.motion, MOTIONS, d.motion), speed: Math.round(num(c.speed, 1, 8, d.speed)), amount: num(c.amount, 0, 1, d.amount)};
}
function cleanFill(raw, d) {
  const c = obj(raw);
  return {kind: oneOf(c.kind, FILLS, d.kind), a: hex(c.a, d.a), b: hex(c.b, d.b), angle: num(c.angle, -180, 180, d.angle), hue: num(c.hue, 0, 360, d.hue)};
}

export function cleanConfig(raw = {}) {
  const d = DEFAULT_CONFIG, c = obj(raw);
  const B = obj(c.backdrop), M = obj(c.media), Sh = obj(c.shape), T = obj(c.text);
  const cols = Array.isArray(B.colors) ? B.colors.slice(0, 3) : [];
  return {
    mode: oneOf(c.mode, MODES, d.mode),
    pitch: num(c.pitch, 4, 80, d.pitch),
    dot: num(c.dot, 0.4, 2, d.dot),
    dotShape: oneOf(c.dotShape, DOT_SHAPES, d.dotShape),
    angle: num(c.angle, -90, 90, d.angle),
    spread: num(c.spread, 0, 45, d.spread),
    split: num(c.split, 0, 0.5, d.split),
    gcr: num(c.gcr, 0, 1, d.gcr),
    background: hex(c.background, d.background),
    paper: hex(c.paper, d.paper),
    ink: hex(c.ink, d.ink),
    invert: typeof c.invert === 'boolean' ? c.invert : d.invert,
    showSource: typeof c.showSource === 'boolean' ? c.showSource : d.showSource,
    loop: num(c.loop, 2, 30, d.loop),
    hueCycles: Math.round(num(c.hueCycles, 0, 8, d.hueCycles)),
    hueSteps: Math.round(num(c.hueSteps, 0, 12, d.hueSteps)),
    backdrop: {
      kind: oneOf(B.kind, BACKDROPS, d.backdrop.kind),
      colors: d.backdrop.colors.map((x, i) => hex(cols[i], x)),
      hue: typeof B.hue === 'boolean' ? B.hue : d.backdrop.hue,
      angle: num(B.angle, -180, 180, d.backdrop.angle),
      count: Math.round(num(B.count, 1, 16, d.backdrop.count)),
      ...cleanMotion(B, d.backdrop),
    },
    media: {
      on: typeof M.on === 'boolean' ? M.on : d.media.on,
      fit: M.fit === 'contain' ? 'contain' : 'cover',
      scale: num(M.scale, 0.3, 3, d.media.scale),
      contrast: num(M.contrast, 0.3, 3, d.media.contrast),
      brightness: num(M.brightness, 0.3, 2, d.media.brightness),
      ...cleanMotion(M, d.media),
    },
    shape: {
      on: typeof Sh.on === 'boolean' ? Sh.on : d.shape.on,
      kind: oneOf(Sh.kind, SHAPES, d.shape.kind),
      size: num(Sh.size, 0.05, 1.5, d.shape.size),
      count: Math.round(num(Sh.count, 1, 8, d.shape.count)),
      fill: cleanFill(Sh.fill, d.shape.fill),
      ...cleanMotion(Sh, d.shape),
    },
    text: {
      on: typeof T.on === 'boolean' ? T.on : d.text.on,
      text: typeof T.text === 'string' ? T.text.slice(0, 200) : d.text.text,
      weight: WEIGHTS.includes(T.weight) ? T.weight : d.text.weight,
      size: num(T.size, 0.03, 0.8, d.text.size),
      tracking: num(T.tracking, -0.1, 0.5, d.text.tracking),
      leading: num(T.leading, 0.7, 1.6, d.text.leading),
      fill: cleanFill(T.fill, d.text.fill),
      ...cleanMotion(T, d.text),
    },
    aspect: oneOf(c.aspect, ASPECTS, d.aspect),
  };
}

const D = DEFAULT_CONFIG;
const off = {on: false};
export const PRESETS = [
  {id: 'tools', name: 'Make your own tools', config: {}},
  {id: 'we', name: 'WE, stepped hues', config: {pitch: 20, dot: 1.3, hueSteps: 6, hueCycles: 2, text: {...D.text, text: 'WE', size: 0.62, motion: 'pulse', amount: 0.25}}},
  {id: 'heart', name: 'CMYK heart', config: {
    mode: 'cmyk', pitch: 14, dot: 1.1,
    backdrop: {...D.backdrop, kind: 'radial', colors: ['#ffffff', '#9fd4ff', '#4f8fe8'], motion: 'pulse', amount: 0.3},
    shape: {...D.shape, on: true, kind: 'heart', size: 0.62, fill: fill('gradient', '#ff2a6d', '#ffb000', 90), motion: 'pulse', amount: 0.35},
    text: {...D.text, ...off},
  }},
  {id: 'orbit', name: 'Orbiting rings', config: {
    pitch: 12, dot: 1.25, spread: 15,
    shape: {...D.shape, on: true, kind: 'ring', size: 0.26, count: 6, fill: fill('rainbow', '#ffffff'), motion: 'spin', amount: 0.5},
    text: {...D.text, ...off},
  }},
  {id: 'conic', name: 'Rainbow field', config: {
    pitch: 18, dot: 1.4, split: 0.25,
    backdrop: {...D.backdrop, kind: 'conic', hue: true, motion: 'spin'},
    text: {...D.text, ...off},
  }},
  {id: 'bands', name: 'Sunset bands', config: {
    mode: 'cmyk', pitch: 12, angle: 10, dotShape: 'circle',
    backdrop: {...D.backdrop, kind: 'bands', colors: ['#ff5a2a', '#ffd23f', '#000000'], count: 5, angle: 90, motion: 'wave'},
    text: {...D.text, text: 'SUNSET', size: 0.2, fill: fill('solid', '#2350d8'), motion: 'wave', amount: 0.4},
  }},
  {id: 'news', name: 'Newsprint', config: {
    mode: 'mono', pitch: 10, dot: 1.05, angle: 0, paper: '#ece6d6', ink: '#1a1a1a',
    backdrop: {...D.backdrop, kind: 'radial', colors: ['#ffffff', '#808080', '#000000'], motion: 'orbit', amount: 0.4},
    text: {...D.text, text: 'EXTRA', size: 0.3, fill: fill('solid', '#000000'), motion: 'scroll'},
  }},
  {id: 'marquee', name: 'Line-screen marquee', config: {
    pitch: 14, dot: 1.1, dotShape: 'line', angle: -20, spread: 8,
    text: {...D.text, text: 'HALFTONE\nIN MOTION', size: 0.2, fill: fill('rainbow', '#ffffff'), motion: 'scroll', speed: 1},
  }},
];

export const presetConfig = id => cleanConfig({...DEFAULT_CONFIG, ...(PRESETS.find(p => p.id === id) || PRESETS[0]).config});

/** Suggested backdrop base when switching modes: dark for light (RGB), white for ink (CMYK, Mono). */
export function baseFor(mode) { return mode === 'rgb' ? '#000000' : '#ffffff'; }
