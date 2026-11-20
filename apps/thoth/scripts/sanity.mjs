// Run with `npm test -w @studio/thoth`. Node check of THOTH's source pass against a mock
// 2D context: no bad gradient stops (real Canvas throws on them), no NaNs, and every
// backdrop's colours at the end of a loop match the start, so loops have no seam.
import {drawSource, BACKDROPS, MOTIONS} from '../src/engine/source.js';
import {screens, pitchFor} from '../src/engine/halftone.js';
import {cleanConfig, presetConfig, PRESETS, DEFAULT_CONFIG} from '../src/engine/config.js';

globalThis.Path2D = class { constructor(d) { this.d = d; } };
const rgb = c => {
  let m = /^rgb\((\d+) (\d+) (\d+)\)$/.exec(c);
  if (m) return [+m[1], +m[2], +m[3]];
  m = /^#([\da-f]{6})$/i.exec(c);
  if (m) { const n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  return null;
};
class Grad {
  constructor() { this.stops = []; }
  addColorStop(p, c) {
    if (!(p >= 0 && p <= 1)) throw new Error('stop out of range: ' + p);
    this.stops.push([p, c]);
  }
  /** Colour at p, the way Canvas interpolates (stops in insertion order of equal positions). */
  at(p) {
    const s = this.stops.slice().sort((a, b) => a[0] - b[0]).map(([q, c]) => [q, rgb(c)]);
    if (s.some(x => !x[1])) return null;
    if (p <= s[0][0]) return s[0][1];
    for (let i = 0; i < s.length - 1; i++) {
      const [p0, c0] = s[i], [p1, c1] = s[i + 1];
      if (p <= p1) { const f = p1 > p0 ? (p - p0) / (p1 - p0) : 1; return c0.map((v, k) => v + (c1[k] - v) * f); }
    }
    return s[s.length - 1][1];
  }
}
class Ctx {
  constructor() { this.bad = 0; this.fills = []; this.letterSpacing = '0px'; this.filter = 'none'; }
  num(...a) { if (a.some(v => typeof v === 'number' && !isFinite(v))) this.bad++; }
  save() {} restore() {} setTransform() {}
  translate(...a) { this.num(...a); } rotate(a) { this.num(a); } scale(...a) { this.num(...a); }
  createLinearGradient(...a) { this.num(...a); return new Grad(); }
  createRadialGradient(...a) { this.num(...a); return new Grad(); }
  createConicGradient(...a) { this.num(...a); return new Grad(); }
  fillRect(...a) { this.num(...a); this.fills.push(this.fillStyle); }
  fill() {} drawImage(...a) { this.num(...a); }
  fillText(s, x, y) { this.num(x, y); }
  measureText(s) { return {width: s.length * 40}; }
}

let fails = 0, frames = 0;
const fail = (...m) => { fails++; console.log('FAIL', ...m); };
const cfgs = PRESETS.map(p => presetConfig(p.id));
for (const kind of Object.keys(BACKDROPS)) for (const motion of Object.keys(MOTIONS)) for (const hue of [false, true]) {
  cfgs.push(cleanConfig({...DEFAULT_CONFIG, backdrop: {...DEFAULT_CONFIG.backdrop, kind, motion, hue, speed: 2}, shape: {...DEFAULT_CONFIG.shape, on: true, count: 5}}));
}
const media = {el: {}, w: 640, h: 360, mirror: true};
for (const cfg of cfgs) {
  for (const t of [0, 0.31, cfg.loop / 3, cfg.loop - 1e-6]) {
    const ctx = new Ctx();
    try { drawSource(ctx, cfg, 960, 540, t, media); } catch (e) { fail(cfg.backdrop.kind, cfg.backdrop.motion, t, e.message); continue; }
    frames++;
    if (ctx.bad) fail('NaN', cfg.backdrop.kind, cfg.backdrop.motion, t);
  }
  // Seam: the backdrop's colours just before the loop ends match t = 0.
  const a = new Ctx(), b = new Ctx();
  drawSource(a, cfg, 960, 540, 0, null);
  drawSource(b, cfg, 960, 540, cfg.loop - 1e-4, null);
  const ga = a.fills[0], gb = b.fills[0];
  if (ga instanceof Grad && gb instanceof Grad && !(cfg.backdrop.kind === 'conic')) {
    for (let p = 0; p <= 1; p += 0.05) {
      const x = ga.at(p), y = gb.at(p);
      if (x && y && x.some((v, k) => Math.abs(v - y[k]) > 3)) { fail('seam', cfg.backdrop.kind, cfg.backdrop.motion, cfg.backdrop.hue, p.toFixed(2), x.map(Math.round), y.map(Math.round)); break; }
    }
  }
}
// Screens: finite angles and offsets in every mode.
for (const mode of ['rgb', 'cmyk', 'mono']) {
  const c = cleanConfig({...DEFAULT_CONFIG, mode, spread: 20, split: 0.3});
  const s = screens(c, pitchFor(c, 1920, 1080));
  if ([...s.angles, ...s.offs.flat()].some(v => !isFinite(v))) fail('screens', mode);
}
// cleanConfig survives junk.
const junk = cleanConfig({mode: 'x', pitch: 'big', backdrop: 5, text: {weight: 333, fill: null}, shape: {count: 99}});
if (junk.mode !== 'rgb' || junk.text.weight !== 900 || junk.shape.count !== 8) fail('cleanConfig', JSON.stringify(junk).slice(0, 120));
console.log(`configs: ${cfgs.length}, frames drawn: ${frames}, failures: ${fails}`);
if (fails) process.exit(1);
