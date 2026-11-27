// TYCHO's modules: each cell of the composition holds 1–3 stacked layers, and each
// layer arranges one of seven shapes (a grid, stripes, rays, rings, one big shape or a
// glow) and loops one of ten motions. Every motion is periodic in the motion loop, so
// any whole number of loops plays back seamlessly.
import {parseColor} from '@studio/core/gradient';
import {T, R as Rot, Sc, chain} from './paint.js';
import {rng, hashInts, gridDims, splitLayout, neighbours} from './layout.js';

export const SHAPES = {
  square: 'Square', circle: 'Circle', half: 'Half circle', quarter: 'Quarter circle', triangle: 'Triangle', line: 'Line', ring: 'Ring',
  glyph: 'Glyphs from GLYF', // GLYF's shared set; off by default
};
export const SHAPE_IDS = Object.keys(SHAPES);
export const MOTIONS = {
  rotate: 'Rotate', spin: 'Counter-spin', scale: 'Scale pulse', stroke: 'Stroke pulse', scrollX: 'Scroll across',
  scrollY: 'Scroll down', scrollDiag: 'Scroll diagonal', expand: 'Radial expand', flip: 'Flip', blink: 'Blink',
};
export const MOTION_IDS = Object.keys(MOTIONS);

/* ---------- what goes with what ---------- */
// Arrangements, the shapes each can use, and how often each is picked (base layer, upper layers).
const ARRANGEMENTS = {
  grid: {shapes: SHAPE_IDS, w: [3, 2]},
  stripe: {shapes: ['line', 'square'], w: [2, 0]},
  concentric: {shapes: ['circle', 'square', 'ring', 'quarter', 'half'], w: [2, 0.6]},
  radial: {shapes: ['triangle', 'line', 'circle'], w: [1.4, 1]},
  single: {shapes: ['circle', 'square', 'triangle', 'half', 'ring', 'quarter', 'glyph'], w: [0.6, 2]},
  glow: {shapes: ['circle'], w: [0.25, 0]},
};
const ROUND = new Set(['circle', 'ring']);

/** Whether a motion visibly does something for this arrangement and shape. */
function fits(motion, arr, shape) {
  switch (motion) {
    case 'rotate': return arr === 'radial' || (arr === 'concentric' ? shape === 'square' : !ROUND.has(shape) && arr !== 'stripe' && arr !== 'glow');
    case 'spin': return (arr === 'grid' && !ROUND.has(shape)) || (arr === 'concentric' && shape === 'square') || arr === 'radial';
    case 'stroke': return shape === 'line' || shape === 'ring' || arr === 'stripe';
    case 'scrollX': case 'scrollY': case 'scrollDiag': return arr === 'grid' || arr === 'stripe';
    case 'expand': return arr === 'concentric' || arr === 'radial';
    case 'flip': return arr === 'grid' || (arr === 'single' && shape !== 'quarter');
    case 'scale': return arr !== 'stripe';
    case 'blink': return true;
    default: return false;
  }
}

/* ---------- colour ---------- */
const labCache = new Map();
const lab = c => { let v = labCache.get(c); if (!v) { v = parseColor(c) || [0, 0, 0]; labCache.set(c, v); } return v; };
const dist = (a, b) => { const p = lab(a), q = lab(b); return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); };

/** n colours for a module: a background that avoids `avoid`, then foregrounds that stand out from it. */
function moduleColors(R, palette, n, avoid) {
  const pool = palette.slice();
  const bgChoices = pool.filter(c => !avoid.has(c));
  const bg = (bgChoices.length ? bgChoices : pool)[Math.floor(R() * (bgChoices.length || pool.length))];
  const rest = pool.filter(c => c !== bg).sort(() => R() - 0.5);
  const out = [bg];
  for (const c of rest) {
    if (out.length >= n) break;
    if (dist(c, bg) >= 0.16 && out.every(o => dist(o, c) >= 0.08)) out.push(c);
  }
  for (const c of rest) { if (out.length >= n) break; if (!out.includes(c)) out.push(c); }
  while (out.length < 2) out.push(out[0] === '#ffffff' ? '#141414' : '#ffffff');
  return out;
}

/* ---------- generation ---------- */
const pickW = (R, items, weight) => {
  const total = items.reduce((s, x) => s + weight(x), 0);
  let r = R() * total;
  for (const x of items) { r -= weight(x); if (r <= 0) return x; }
  return items[items.length - 1];
};
const pick = (R, a) => a[Math.floor(R() * a.length)];
const between = (R, lo, hi) => lo + R() * (hi - lo);

/**
 * One layer for a cell `cell` (grid units). `top` is false for the base layer.
 * colors: the module's colours, [bg, fg1, fg2, ...].
 */
function makeLayer(R, cfg, cell, top, colors) {
  const level = top ? 1 : 0;
  const arrs = Object.keys(ARRANGEMENTS).filter(a => ARRANGEMENTS[a].w[level] > 0 && ARRANGEMENTS[a].shapes.some(s => cfg.shapes.includes(s)));
  if (!arrs.length) return null;
  const arr = pickW(R, arrs, a => ARRANGEMENTS[a].w[level]);
  const shape = pick(R, ARRANGEMENTS[arr].shapes.filter(s => cfg.shapes.includes(s)));
  const motions = cfg.motions.filter(m => fits(m, arr, shape));
  const still = !motions.length || (!top && R() < 0.12);
  const fgs = colors.slice(1);
  const L = {
    arr, shape,
    motion: still ? 'still' : pick(R, motions),
    cycles: R() < 0.25 ? 2 : 1,
    phase: Math.floor(R() * 4) / 4,
    dir: R() < 0.5 ? 1 : -1,
    fg: top ? fgs[fgs.length - 1] : fgs[0],
    fg2: null,
    alt: colors[0], // the colour blink swaps to (set below)
    invert: false,
    size: 1, k: 1, width: 0.2,
    checker: 'none', stagger: false, variant: '', angle: 0, n: 12, anchor: 'center', corner: 0, rot: 0,
  };
  // Pattern pitch: tiles per grid unit, scaled by the pattern-scale setting and capped by cell size.
  const tiles = base => {
    let k = Math.max(1, Math.round(base / cfg.scale));
    while (k > 1 && cell.w * cell.h * k * k > 500) k--;
    return k;
  };
  const twoTone = () => (fgs.length > 1 && R() < 0.5 ? fgs[1] : null);
  switch (arr) {
    case 'grid': {
      L.k = tiles(top ? pick(R, [1, 2]) : pick(R, [1, 2, 2, 3, 4]));
      if (shape === 'square') {
        if (!top && R() < 0.55) { L.size = 1; L.checker = 'skip'; L.fg2 = twoTone(); if (L.fg2) L.checker = 'alt'; }
        else { L.size = between(R, 0.35, 0.7); L.rot = R() < 0.3 ? Math.PI / 4 : 0; }
      } else if (shape === 'circle') {
        L.size = top ? between(R, 0.25, 0.5) : between(R, 0.45, 0.95);
        L.stagger = R() < 0.3;
        if (R() < 0.3) { L.fg2 = twoTone(); L.checker = L.fg2 ? 'alt' : 'skip'; }
      } else if (shape === 'half') {
        L.size = 1; L.stagger = R() < 0.5; L.rot = pick(R, [0, Math.PI]);
      } else if (shape === 'quarter') {
        L.size = 1; L.variant = R() < 0.5 ? 'pinch' : 'truchet';
      } else if (shape === 'triangle') {
        if (!top && R() < 0.6) { L.size = 1; L.variant = 'tess'; L.fg2 = twoTone(); }
        else { L.size = between(R, 0.4, 0.7); L.rot = pick(R, [0, Math.PI / 2, Math.PI, -Math.PI / 2]); }
      } else if (shape === 'line') {
        L.size = between(R, 0.7, 1); L.width = between(R, 0.12, 0.35); L.rot = pick(R, [0, Math.PI / 4, Math.PI / 2, -Math.PI / 4]);
      } else if (shape === 'ring') {
        L.size = between(R, 0.55, 0.95); L.width = between(R, 0.08, 0.2);
      } else if (shape === 'glyph') {
        L.size = between(R, 0.6, 0.95);
      }
      break;
    }
    case 'stripe':
      L.k = tiles(pick(R, [2, 3, 4, 6]));
      L.size = between(R, 0.35, 0.6);
      L.angle = pick(R, [Math.PI / 4, -Math.PI / 4, 0, Math.PI / 2]);
      L.fg2 = twoTone();
      break;
    case 'concentric':
      L.k = tiles(pick(R, [2, 3, 4]));
      L.anchor = shape === 'quarter' ? 'corner' : shape === 'half' ? 'edge' : 'center';
      L.corner = Math.floor(R() * 4);
      L.fg2 = twoTone();
      L.width = between(R, 0.2, 0.45);
      break;
    case 'radial':
      L.n = pick(R, [8, 12, 16, 20, 24]);
      L.anchor = R() < 0.3 ? 'corner' : 'center';
      L.corner = Math.floor(R() * 4);
      L.k = tiles(pick(R, [1, 2]));
      L.size = shape === 'triangle' ? between(R, 0.5, 1) : between(R, 0.5, 1);
      L.width = between(R, 0.08, 0.2);
      L.fg2 = shape === 'triangle' ? twoTone() : null;
      break;
    case 'single':
      L.size = top ? between(R, 0.35, 0.75) : between(R, 0.6, 0.95);
      L.width = between(R, 0.06, 0.16);
      L.corner = Math.floor(R() * 4);
      L.rot = shape === 'triangle' ? pick(R, [0, Math.PI / 2, Math.PI, -Math.PI / 2]) : shape === 'half' ? pick(R, [0, Math.PI]) : 0;
      break;
    case 'glow':
      L.size = between(R, 0.6, 1);
      break;
  }
  // A glyph layer uses one glyph of GLYF's set, seeded like its shape (wrapped to the set's size when drawn).
  if (shape === 'glyph') L.glyph = Math.floor(R() * 64);
  // Blink swaps to a third colour. A two-colour module has none, so the base layer
  // inverts the whole cell instead, and an upper layer (which would cover the base) moves differently.
  const others = colors.filter(c => c !== L.fg && c !== L.fg2 && c !== colors[0]);
  L.alt = others.length ? others[Math.floor(R() * others.length)] : colors[0];
  L.invert = L.alt === colors[0] && !L.fg2;
  if (L.motion === 'blink' && L.invert && top) {
    const rest = motions.filter(m => m !== 'blink');
    L.motion = rest.length ? pick(R, rest) : 'still';
  }
  return L;
}

/** Module for one cell: its colours and stacked layers. */
function makeModule(R, cfg, cell, avoid) {
  const colors = moduleColors(R, cfg.colors, Math.min(cfg.colors.length, cfg.perModule + (cfg.layers > 1 ? 1 : 0)), avoid);
  const count = 1 + (cfg.layers >= 2 && R() < 0.6 ? 1 : 0) + (cfg.layers >= 3 && R() < 0.35 ? 1 : 0);
  const layers = [];
  for (let i = 0; i < count; i++) {
    const L = makeLayer(R, cfg, cell, i > 0, colors);
    if (L) layers.push(L);
  }
  return {bg: colors[0], layers};
}

/* ---------- timing ---------- */
const gcd = (a, b) => (b ? gcd(b, a % b) : a);
/** Seconds per beat, per motion loop, between cuts (0 = never) and for one whole loop. */
export function timing(cfg) {
  const beat = 60 / cfg.bpm;
  const motion = cfg.motionBeats * beat;
  const cut = cfg.shuffleBeats > 0 ? cfg.shuffleBeats * beat : 0;
  const loopBeats = cut ? (cfg.rounds * cfg.shuffleBeats * cfg.motionBeats) / gcd(cfg.rounds * cfg.shuffleBeats, cfg.motionBeats) : cfg.motionBeats;
  return {beat, motion, cut, loop: loopBeats * beat};
}
/** Which round of cuts a time falls in. Rounds repeat after cfg.rounds cuts. */
export function roundAt(cfg, t) {
  const {cut} = timing(cfg);
  return cut ? Math.floor(t / cut + 1e-9) % cfg.rounds : 0;
}

/* ---------- scenes ---------- */
/** In "mixed" mode, roughly every other cut keeps the layout and swaps only the modules. */
function layoutRound(cfg, round) {
  if (cfg.shuffleMode === 'modules') return 0;
  if (cfg.shuffleMode === 'all') return round;
  for (let r = round; r > 0; r--) if (hashInts(cfg.seed, r, 77) % 100 < 55) return r;
  return 0;
}

/** The composition and its modules for one round of cuts, for a frame of aspect `aspect`. */
export function buildScene(cfg, round, aspect) {
  const {cols, rows} = gridDims(aspect, cfg.grid);
  const lr = layoutRound(cfg, round);
  const cells = splitLayout(cols, rows, {depth: cfg.depth, minCell: cfg.minCell, hold: cfg.hold}, hashInts(cfg.seed, lr, cols, rows));
  const near = neighbours(cells);
  const R = rng(hashInts(cfg.moduleSeed, round));
  const mods = [];
  cells.forEach((cell, i) => {
    const avoid = new Set(near[i].filter(j => j < i).map(j => mods[j].bg));
    mods.push(makeModule(R, cfg, cell, avoid));
  });
  return {cols, rows, cells, mods};
}

/* ---------- drawing ---------- */
const TAU = Math.PI * 2;
const ease = u => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
const pulse = u => 0.5 - 0.5 * Math.cos(TAU * u); // 0 → 1 → 0 over a loop
const par = (i, j) => (((i + j) % 2) + 2) % 2;
// The turn a rotating shape makes per loop: one of its symmetries, so loops line up.
const STEP = {square: Math.PI / 2, line: Math.PI, half: TAU, quarter: TAU, triangle: TAU, circle: 0, ring: 0, glyph: TAU};

/** Corner `q` of a rect: 0 bottom-left, 1 top-left, 2 top-right, 3 bottom-right, with the rotation that opens a quarter into it. */
const cornerOf = (x, y, w, h, q) => [[x, y + h], [x, y], [x + w, y], [x + w, y + h]][q];

function drawLayer(p, L, x, y, w, h, U, t, motionSec, bg) {
  const tc = motionSec > 0 ? (t / motionSec) * L.cycles + L.phase : L.phase;
  const ci = Math.floor(tc), u = tc - ci, e = ease(u);
  const M = L.motion;
  const swap = M === 'blink' && u >= 0.5;
  const A = swap ? L.fg2 || L.alt : L.fg;
  const B = swap ? L.fg : L.fg2 || L.alt;
  // A two-colour module blinks by inverting its cell: the shapes take the background colour and vice versa.
  if (swap && L.invert) { p.rect(x, y, w, h, L.fg); bg = L.fg; }
  const sc = M === 'scale' ? 0.55 + 0.45 * (1 - pulse(u)) : 1;
  const sw = M === 'stroke' ? 0.35 + 0.65 * pulse(u) : 1;
  const cx = x + w / 2, cy = y + h / 2;

  switch (L.arr) {
    case 'grid': {
      const s = U / L.k;
      const per = L.checker !== 'none' || L.stagger || L.variant === 'tess' || L.variant === 'truchet' ? 2 : 1;
      const scroll = e * s * per * L.dir;
      const ox = M === 'scrollX' || M === 'scrollDiag' ? scroll : 0;
      const oy = M === 'scrollY' || M === 'scrollDiag' ? scroll : 0;
      const nx = Math.ceil(w / s) + per, ny = Math.ceil(h / s) + per;
      const spin = (ci + e) * STEP[L.shape] * L.dir;
      const flip = M === 'flip' ? Math.cos(Math.PI * u * 2) : 1;
      for (let j = -per; j < ny; j++) {
        for (let i = -per; i < nx; i++) {
          const pp = par(i, j);
          if (L.checker === 'skip' && pp) continue;
          const ex = x + (i + 0.5) * s + ox + (L.stagger && (j & 1) ? s / 2 : 0);
          const ey = y + (j + 0.5) * s + oy;
          if (ex < x - s || ex > x + w + s || ey < y - s || ey > y + h + s) continue;
          let col = L.checker === 'alt' && pp ? B : A;
          let rot = L.rot;
          if (L.variant === 'tess') { rot += pp ? Math.PI : 0; if (L.fg2 && pp) col = B; }
          if (L.variant === 'truchet') rot += ((i & 1) * 2 + (j & 1)) * (Math.PI / 2);
          if (M === 'rotate') rot += spin;
          if (M === 'spin') rot += pp ? -spin : spin;
          const size = L.size * s * sc;
          const base = chain(T(ex, ey), Rot(rot), Sc(size * flip, size));
          if (L.variant === 'pinch') {
            for (let q = 0; q < 4; q++) p.fill('quarter', chain(base, Rot(q * Math.PI / 2), T(-0.25, 0.25), Sc(0.5)), col);
          } else if (L.shape === 'line') {
            p.fill('line', chain(base, Sc(1, L.width * sw)), col);
          } else if (L.shape === 'ring') {
            p.stroke('ring', chain(base, Sc(1 - L.width * sw)), col, L.width * sw);
          } else if (L.shape === 'glyph') {
            p.glyph(L.glyph, base, col);
          } else {
            p.fill(L.shape, base, col);
          }
        }
      }
      break;
    }
    case 'stripe': {
      const pitch = U / L.k;
      const two = !!L.fg2;
      const off = M === 'scrollX' || M === 'scrollY' || M === 'scrollDiag' ? e * pitch * (two ? 2 : 1) * L.dir : 0;
      const D = Math.hypot(w, h);
      const n = Math.ceil(D / pitch / 2) + 3;
      const bw = L.size * pitch * sw;
      for (let i = -n; i <= n; i++) {
        const col = two && (i & 1) ? B : A;
        p.fill('square', chain(T(cx, cy), Rot(L.angle), T(0, i * pitch + off), Sc(D * 1.2, bw)), col);
      }
      break;
    }
    case 'concentric': {
      const g = (U / L.k) * (M === 'scale' ? 0.8 + 0.2 * (1 - pulse(u)) : 1);
      const [ax, ay] = L.anchor === 'corner' ? cornerOf(x, y, w, h, L.corner) : L.anchor === 'edge' ? [cx, y + h] : [cx, cy];
      const far = Math.max(Math.hypot(ax - x, ay - y), Math.hypot(ax - x - w, ay - y), Math.hypot(ax - x, ay - y - h), Math.hypot(ax - x - w, ay - y - h));
      const cols = L.shape === 'ring' ? [A] : L.fg2 ? [A, B, bg] : [A, bg];
      const m = L.fg2 && L.shape === 'ring' ? 2 : cols.length;
      const shift = M === 'expand' ? e * m * g : 0;
      const J = Math.ceil(far / g) + 1;
      const spinA = (ci + e) * (Math.PI / 2) * L.dir;
      for (let j = J; j >= -m; j--) {
        const r = (j + 1) * g + shift;
        if (r <= 0) continue;
        const k = ((j % m) + m) % m;
        let rot = 0;
        if (M === 'rotate') rot = spinA;
        if (M === 'spin') rot = j & 1 ? -spinA : spinA;
        if (L.shape === 'ring') {
          const wpx = g * L.width * sw;
          p.stroke('ring', chain(T(ax, ay), Sc(2 * r)), L.fg2 && k ? B : A, wpx / (2 * r));
        } else {
          p.fill(L.shape === 'square' ? 'square' : 'circle', chain(T(ax, ay), Rot(rot), Sc(2 * r)), cols[k]);
        }
      }
      break;
    }
    case 'radial': {
      const [ax, ay] = L.anchor === 'corner' ? cornerOf(x, y, w, h, L.corner) : [cx, cy];
      const reach = Math.hypot(w, h) * (L.anchor === 'corner' ? 1.05 : 0.6);
      const n = L.n;
      const two = !!L.fg2;
      const stepA = (TAU / n) * (two ? 2 : 1);
      const a0 = M === 'rotate' || M === 'spin' ? (ci + e) * stepA * L.dir : 0;
      if (L.shape === 'circle') {
        const g = U / L.k / 1.5;
        const shift = M === 'expand' ? e * g : 0;
        const J = Math.ceil(reach / g) + 1;
        for (let j = 0; j <= J; j++) {
          const r = j * g + shift;
          if (r <= 0) continue;
          const d = Math.min(g, (r * TAU) / n) * 0.7 * L.size * sc;
          for (let i = 0; i < n; i++) {
            const a = a0 + (i + (j & 1) * 0.5) * (TAU / n);
            p.fill('circle', chain(T(ax + Math.cos(a) * r, ay + Math.sin(a) * r), Sc(d)), A);
          }
        }
      } else {
        const len = reach * (M === 'expand' ? 0.6 + 0.4 * pulse(u) : 1) * (M === 'scale' ? sc : 1);
        for (let i = 0; i < n; i++) {
          const a = a0 + i * (TAU / n);
          const col = two && (i & 1) ? B : A;
          if (L.shape === 'triangle') {
            const base = 2 * len * Math.tan(Math.PI / n) * L.size;
            p.fill('triangle', chain(T(ax, ay), Rot(a - Math.PI / 2), T(0, len / 2), Sc(base, len)), col);
          } else {
            const r0 = U * 0.15;
            const wpx = U * L.width * 0.6 * sw;
            p.fill('line', chain(T(ax, ay), Rot(a - Math.PI / 2), T(0, (r0 + len) / 2), Sc(wpx, len - r0)), col);
          }
        }
      }
      break;
    }
    case 'single': {
      const S = Math.min(w, h) * L.size * sc;
      if (L.shape === 'quarter') {
        const [px, py] = cornerOf(x, y, w, h, L.corner);
        const Q = Math.min(w, h) * (0.6 + 0.4 * L.size) * sc * (M === 'flip' ? 1 : 1);
        p.fill('quarter', chain(T(px, py), Rot(L.corner * Math.PI / 2), T(Q / 2, -Q / 2), Sc(Q)), A);
        break;
      }
      const rot = L.rot + (M === 'rotate' || M === 'spin' ? (ci + e) * STEP[L.shape] * L.dir : 0);
      const flip = M === 'flip' ? Math.cos(TAU * u) : 1;
      const m = chain(T(cx, cy), Rot(rot), Sc(S * flip, S));
      if (L.shape === 'ring') p.stroke('ring', chain(m, Sc(1 - L.width * sw)), A, L.width * sw);
      else if (L.shape === 'glyph') p.glyph(L.glyph, m, A);
      else p.fill(L.shape, L.shape === 'half' ? chain(m, T(0, -0.25)) : m, A);
      break;
    }
    case 'glow': {
      const r = Math.hypot(w, h) * L.size * sc;
      p.glow(chain(T(cx, cy), Sc(r)), A, bg);
      break;
    }
  }
}

/**
 * Draw a scene at time t into a W × H frame.
 * cfg supplies the gutter and timing; the scene comes from buildScene.
 */
export function drawScene(p, scene, cfg, W, H, t) {
  const {cols, rows, cells, mods} = scene;
  const ux = W / cols, uy = H / rows, U = Math.min(ux, uy);
  const gut = cfg.gutter * U;
  const {motion} = timing(cfg);
  p.rect(0, 0, W, H, gut > 0 ? cfg.gutterColor : mods[0]?.bg || '#000');
  cells.forEach((c, i) => {
    const x0 = Math.round(c.x * ux + gut / 2), y0 = Math.round(c.y * uy + gut / 2);
    const x1 = Math.round((c.x + c.w) * ux - gut / 2), y1 = Math.round((c.y + c.h) * uy - gut / 2);
    const w = x1 - x0, h = y1 - y0;
    if (w < 1 || h < 1) return;
    const mod = mods[i];
    p.clipStart(x0, y0, w, h);
    p.rect(x0, y0, w, h, mod.bg);
    for (const L of mod.layers) drawLayer(p, L, x0, y0, w, h, U, t, motion, mod.bg);
    p.clipEnd();
  });
}
