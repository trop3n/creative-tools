// BLOOM's plant generator. buildPlant(config) grows a seeded skeleton once: stems as
// wandering curves, side branches, leaves, and a flower head (with its petal list) at
// every tip. meshPlant(plant, t, camera, out) turns it into flat-coloured triangles for
// the moment t, with growth, blooming and wind applied. Units: the plant is about
// 1.6 high, y is up, the base sits on y = 0.
import {makeLut, lutIndex} from './color.js';

const TAU = Math.PI * 2;
const RAD = Math.PI / 180;

/* ---------- small helpers ---------- */
export function rng(seed) {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
const easeOut = x => 1 - (1 - x) ** 3;
const easeOutInv = y => 1 - Math.cbrt(1 - clamp01(y));
const easeBack = x => { const c = 1.4; return 1 + (c + 1) * (x - 1) ** 3 + c * (x - 1) ** 2; };
/** Two unit vectors perpendicular to a (and to each other). */
function basis(a) {
  const helper = Math.abs(a[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const u = norm(cross(a, helper));
  return [u, cross(a, u)];
}

/* ---------- species ---------- */
// Each recipe returns its petal rings for head size S. A ring: count, petal length and
// half-width, opening angle from the head's axis, curl (extra bend toward the tip),
// cup (edges bent away from the head's axis; negative wraps them toward it), outline
// profile, and tip teeth. Optional: cols
// (columns each side of the midrib, for petals that curve smoothly across), phase (the
// ring's turn offset, as a fraction) and jitter (random turn per petal, default 0.12).
const PROFILES = {
  fan: s => 0.18 + 0.82 * s ** 0.55, // carnation: narrow claw, wide frilled tip
  lance: s => Math.sin(Math.PI * s) ** 0.7, // lily, daisy: pointed both ends
  obovate: s => 0.2 + 0.8 * Math.sin(Math.PI * 0.5 * Math.min(1, s * 1.25)), // cosmos: widest near the tip
  // tulip: narrow at the base, widest past the middle, a rounded cap at the tip
  tulip: s => (s < 0.58 ? 0.62 + 0.38 * Math.sin((Math.PI / 2) * (s / 0.58)) : Math.sqrt(Math.max(0, 1 - ((s - 0.58) / 0.42) ** 2))),
  // daisy: a strap with parallel sides and a round end
  strap: s => (s < 0.12 ? 0.35 + 0.65 * (s / 0.12) : s < 0.8 ? 1 : Math.sqrt(Math.max(0, 1 - ((s - 0.8) / 0.2) ** 2))),
  // dahlia: a broad, blunt-pointed quill
  quill: s => Math.sin(Math.PI * Math.min(1, 0.04 + s * 0.96)) ** 0.5,
  leaf: s => Math.sin(Math.PI * s ** 0.75) ** 0.85,
};
const GOLDEN = 0.3819660112501051; // the golden angle, as a fraction of a turn

export const SPECIES = {
  carnation: {
    name: 'Carnation',
    calyx: true,
    rings: S => Array.from({length: 6}, (_, r) => {
      const f = r / 5;
      return {count: Math.round(7 + f * 9), len: S * (0.55 + 0.45 * f), width: S * (0.32 + 0.22 * f), theta: 12 + f * 70,
        curl: 0.25 + 0.5 * f, cup: 0.3, profile: 'fan', teeth: 8, toothLen: 0.085, base: S * 0.06 * f, vBase: -0.18 + f * 0.14, vSpan: 1, segs: 5};
    }),
  },
  lily: {
    name: 'Lily',
    stamens: 6,
    rings: S => [
      {count: 3, len: S * 2.1, width: S * 0.34, theta: 50, curl: 1.5, cup: 0.35, profile: 'lance', base: 0, vBase: 0, vSpan: 1, segs: 9},
      {count: 3, len: S * 2.0, width: S * 0.26, theta: 46, curl: 1.4, cup: 0.4, profile: 'lance', base: 0, vBase: 0.04, vSpan: 0.95, segs: 9, phase: 0.5},
    ],
  },
  tulip: {
    name: 'Tulip',
    calyx: false,
    // Six broad petals in two rings, their edges wrapping toward the centre (negative cup)
    // so together they make a closed, rounded cup with the tips turned slightly in.
    rings: S => [
      {count: 3, len: S * 1.25, width: S * 0.56, theta: 20, curl: -0.32, cup: -0.95, profile: 'tulip', base: S * 0.03, vBase: 0, vSpan: 1, segs: 12, cols: 3},
      {count: 3, len: S * 1.18, width: S * 0.5, theta: 13, curl: -0.28, cup: -0.95, profile: 'tulip', base: S * 0.01, vBase: 0.05, vSpan: 0.95, segs: 12, cols: 3, phase: 0.5},
    ],
  },
  daisy: {
    name: 'Daisy',
    // A domed yellow centre, ringed by flat strap-shaped rays with round ends.
    disc: {radius: 0.32, dots: 70, dome: 0.4, color: [1, 0.8, 0.16], dot: [0.86, 0.52, 0.05]},
    rings: S => [
      {count: 22, len: S * 1.22, width: S * 0.14, theta: 86, curl: 0.12, cup: 0.12, profile: 'strap', base: S * 0.26, vBase: 0, vSpan: 1, segs: 11},
      {count: 22, len: S * 1.1, width: S * 0.13, theta: 80, curl: 0.1, cup: 0.12, profile: 'strap', base: S * 0.24, vBase: 0.06, vSpan: 0.9, segs: 11, phase: 0.5},
    ],
  },
  cosmos: {
    name: 'Cosmos',
    disc: {radius: 0.2, dots: 22},
    rings: S => [
      {count: 8, len: S * 1.25, width: S * 0.38, theta: 74, curl: 0.2, cup: 0.25, profile: 'obovate', teeth: 3, toothLen: 0.1, base: S * 0.12, vBase: 0, vSpan: 1, segs: 6},
    ],
  },
  dahlia: {
    name: 'Dahlia',
    calyx: true,
    // About eighty petals on a golden-angle spiral, each rolled toward the flower's face
    // into a quill: tight and curled in at the centre, opening out toward the rim.
    rings: S => Array.from({length: 84}, (_, i) => {
      const f = i / 83;
      return {count: 1, phase: i * GOLDEN, jitter: 0.004, len: S * (0.26 + 0.82 * f ** 0.8), width: S * (0.14 + 0.16 * f), theta: 6 + 104 * f ** 1.15,
        curl: f < 0.35 ? -0.7 * (1 - f / 0.35) : 0.22 * (f - 0.35), cup: -1.1, profile: 'quill', base: S * 0.05 * f,
        vBase: (1 - f) * 0.25, vSpan: 0.8, segs: 7, cols: 2};
    }),
  },
};
export const SPECIES_IDS = Object.keys(SPECIES);

/* ---------- the skeleton ---------- */
function growCurve(R, base, dir, length, steps, wander, upBias) {
  const pts = [base];
  let h = norm(dir), p = base;
  const ph = [R() * TAU, R() * TAU, R() * TAU, R() * TAU], fr = [2 + R() * 2.5, 2 + R() * 2.5];
  for (let i = 1; i <= steps; i++) {
    const s = i / steps;
    const nx = Math.sin(s * fr[0] * Math.PI + ph[0]) + 0.5 * Math.sin(s * 9.1 + ph[1]);
    const nz = Math.sin(s * fr[1] * Math.PI + ph[2]) + 0.5 * Math.sin(s * 7.7 + ph[3]);
    h = norm(add(h, [nx * wander * 0.07, upBias, nz * wander * 0.07]));
    p = add(p, mul(h, length / steps));
    pts.push(p);
  }
  return pts;
}

/** Point and tangent at u (0..1) along a polyline with equal steps. */
function sample(pts, u) {
  const n = pts.length - 1, x = clamp01(u) * n, i = Math.min(n - 1, Math.floor(x)), f = x - i;
  return {p: lerp3(pts[i], pts[i + 1], f), t: norm(sub(pts[i + 1], pts[i]))};
}

function makeHead(R, cfg, species, rampCount, S) {
  const rec = SPECIES[species];
  const petals = [];
  const ringDefs = rec.rings(S);
  ringDefs.forEach((ring, r) => {
    const phase = (ring.phase ?? R()) / ring.count;
    for (let k = 0; k < ring.count; k++) {
      petals.push({
        ring: r, ringFrac: ringDefs.length > 1 ? r / (ringDefs.length - 1) : 1,
        az: (k / ring.count + phase + (R() - 0.5) * (ring.jitter ?? 0.12) / ring.count) * TAU,
        len: ring.len * (0.86 + 0.28 * R()), width: ring.width * (0.85 + 0.3 * R()),
        theta: (ring.theta + (R() - 0.5) * 10) * RAD, curl: ring.curl * (0.8 + 0.4 * R()), cup: ring.cup,
        profile: PROFILES[ring.profile], segs: ring.segs, cols: ring.cols || 1, base: ring.base,
        vBase: ring.vBase, vSpan: ring.vSpan, jit: (R() - 0.5) * 0.18,
        teeth: ring.teeth ? Array.from({length: ring.teeth}, () => ({len: ring.toothLen * (0.4 + R()), off: (R() - 0.5) * 0.4})) : null,
      });
    }
  });
  return {
    species, S, petals, rings: ringDefs.length, ramp: Math.floor(R() * rampCount),
    calyx: !!rec.calyx, stamens: rec.stamens || 0, disc: rec.disc || null,
    discSeed: R(),
  };
}

/**
 * Grow the skeleton for a config. Everything random comes from cfg.seed (plus the
 * regrow round), so the same settings always make the same plant.
 */
export function buildPlant(cfg, round = 0) {
  const R = rng(cfg.seed + round * 7919);
  const H = 1.6 * cfg.height;
  const speed = Math.max(0.05, cfg.speed);
  const G = 1.7 / speed, bloom = 1.5 / speed, leafDur = 0.7 / speed;
  const S = 0.2 * cfg.bloomSize;
  const mix = cfg.species.length ? cfg.species : ['carnation'];
  const rampCount = Math.max(1, cfg.ramps.length);
  const curves = [], heads = [], leaves = [];
  const n = cfg.stems;

  const addCurve = (pts, start, dur, r0, r1, depth) => {
    const c = {pts, start, dur, r0, r1, depth};
    curves.push(c);
    return c;
  };
  const addHead = (curve, species, scale) => {
    heads.push({curve, ...makeHead(R, cfg, species, rampCount, S * scale), openAt: curve.start + curve.dur * 0.9, bloom: bloom * (0.85 + 0.3 * R())});
  };
  const addLeaves = (curve, len, count, from, to) => {
    let az = R() * TAU;
    for (let i = 0; i < count; i++) {
      const u = from + (to - from) * ((i + 0.5 + (R() - 0.5) * 0.5) / count);
      az += Math.PI * (0.8 + 0.4 * R());
      leaves.push({curve, u, az, len: len * (0.8 + 0.4 * R()), width: len * (0.42 + 0.14 * R()), lift: (40 + R() * 25) * RAD,
        droop: 0.5 + R() * 0.6, twist: (R() - 0.5) * 0.6, born: curve.start + curve.dur * easeOutInv(u), grow: leafDur});
    }
  };

  for (let s = 0; s < n; s++) {
    // Stems fan out from a small clump; outer ones lean further.
    const spread = n > 1 ? (s / (n - 1) - 0.5) * 2 : 0;
    const baseAz = R() * TAU;
    const base = [spread * 0.05 + (R() - 0.5) * 0.04, 0, (R() - 0.5) * 0.06];
    const lean = (n > 1 ? 0.12 + Math.abs(spread) * 0.22 : 0.06) * (0.6 + 0.8 * R());
    const dir = norm([spread * lean * 1.4 + Math.cos(baseAz) * lean * 0.4, 1, Math.sin(baseAz) * lean * 0.6]);
    const len = H * (0.72 + 0.32 * R()) * (n > 1 ? 1 - Math.abs(spread) * 0.18 : 1);
    const species = mix[Math.floor(R() * mix.length)];
    const start = s * 0.12 / speed + R() * 0.25 / speed;
    const stem = addCurve(growCurve(R, base, dir, len, 28, cfg.wander, 0.012), start, G, 0.026, 0.015, 0);
    addHead(stem, species, 1);
    addLeaves(stem, 0.2 * H / 1.6, Math.round(cfg.leaves * 7 * len / H), 0.06, 0.62);

    // Side branches: each ends in a flower, the deeper ones a little smaller.
    const nb = Math.round(cfg.branching * 4 * (0.6 + 0.8 * R()));
    for (let b = 0; b < nb; b++) {
      const u = 0.42 + 0.48 * ((b + 0.3 + R() * 0.5) / nb);
      const at = sample(stem.pts, u);
      const [bu, bv] = basis(at.t);
      const az = baseAz + b * 2.39996 + (R() - 0.5) * 0.6, ang = (28 + R() * 26) * RAD;
      const bdir = norm(add(mul(at.t, Math.cos(ang)), mul(add(mul(bu, Math.cos(az)), mul(bv, Math.sin(az))), Math.sin(ang))));
      const blen = len * (1 - u) * (0.55 + 0.45 * R()) + 0.12 * H / 1.6;
      const bstart = stem.start + stem.dur * easeOutInv(u);
      const branch = addCurve(growCurve(R, at.p, bdir, blen, 14, cfg.wander, 0.045), bstart, G * 0.6, 0.018, 0.012, 1);
      const bspecies = R() < 0.8 ? species : mix[Math.floor(R() * mix.length)];
      addHead(branch, bspecies, 0.8 + 0.25 * R());
      if (cfg.leaves > 0.3 && R() < 0.6) addLeaves(branch, 0.13 * H / 1.6, 1, 0.2, 0.5);
      // A second level now and then, when branching is high.
      if (cfg.branching > 0.6 && R() < (cfg.branching - 0.5) * 0.8) {
        const u2 = 0.45 + R() * 0.3, at2 = sample(branch.pts, u2), [cu, cv] = basis(at2.t), az2 = R() * TAU, ang2 = (30 + R() * 20) * RAD;
        const cdir = norm(add(mul(at2.t, Math.cos(ang2)), mul(add(mul(cu, Math.cos(az2)), mul(cv, Math.sin(az2))), Math.sin(ang2))));
        const twig = addCurve(growCurve(R, at2.p, cdir, blen * 0.55, 10, cfg.wander, 0.05), branch.start + branch.dur * easeOutInv(u2), G * 0.45, 0.013, 0.01, 2);
        addHead(twig, bspecies, 0.65 + 0.2 * R());
      }
    }
  }

  // Bounds of the finished plant (tips plus a head's reach), for framing.
  let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const c of curves) for (const p of c.pts) { lo = lo.map((v, i) => Math.min(v, p[i])); hi = hi.map((v, i) => Math.max(v, p[i])); }
  const reach = S * 1.5;
  // The frame bottom cuts the stems a little above the base, as in a cropped photo.
  lo = [lo[0] - reach, H * 0.14, lo[2] - reach]; hi = [hi[0] + reach, hi[1] + reach, hi[2] + reach];
  const doneAt = Math.max(...heads.map(h => h.openAt + h.bloom * 1.3));
  return {curves, heads, leaves, lo, hi, H, doneAt, phase: [R() * TAU, R() * TAU], stemLut: makeLut(cfg.stem), luts: cfg.ramps.map(makeLut)};
}

/* ---------- meshing ---------- */
/** A growable float buffer of triangles: x y z r g b per vertex. */
export class Mesh {
  constructor() { this.f = new Float32Array(1 << 18); this.n = 0; }
  reset() { this.n = 0; }
  get count() { return this.n / 6; }
  ensure(extra) {
    if (this.n + extra <= this.f.length) return;
    const g = new Float32Array(Math.max(this.f.length * 2, this.n + extra));
    g.set(this.f.subarray(0, this.n));
    this.f = g;
  }
  v(p, lut, i) { const f = this.f, n = this.n; f[n] = p[0]; f[n + 1] = p[1]; f[n + 2] = p[2]; f[n + 3] = lut[i]; f[n + 4] = lut[i + 1]; f[n + 5] = lut[i + 2]; this.n = n + 6; }
  tri(a, b, c, lut, ia, ib, ic) { this.ensure(18); this.v(a, lut, ia); this.v(b, lut, ib); this.v(c, lut, ic); }
  quad(a, b, c, d, lut, ia, ib, ic, id) { this.tri(a, b, c, lut, ia, ib, ic); this.tri(a, c, d, lut, ia, ic, id); }
}

/** Wind: a smooth sideways push that grows with height, the same field for every part. */
function windAt(p, t, plant, sway) {
  if (!sway) return p;
  const k = sway * 0.07 * (p[1] / plant.H) ** 2;
  return [
    p[0] + k * (Math.sin(t * 1.1 + p[1] * 1.7 + plant.phase[0]) + 0.35 * Math.sin(t * 2.3 + p[1] * 3.1)),
    p[1],
    p[2] + k * 0.6 * Math.sin(t * 0.9 + p[1] * 1.3 + plant.phase[1]),
  ];
}

/** A camera-facing strip along points, dark on one edge and light on the other. */
function ribbon(mesh, pts, radii, eye, lut) {
  const lo = lutIndex(0.1), hi = lutIndex(0.95);
  let prevL = null, prevR = null;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const t = norm(sub(pts[Math.min(pts.length - 1, i + 1)], pts[Math.max(0, i - 1)]));
    const side = mul(norm(cross(t, sub(eye, p))), radii[i]);
    const L = sub(p, side), Rr = add(p, side);
    if (prevL) mesh.quad(prevL, prevR, Rr, L, lut, lo, hi, hi, lo);
    prevL = L; prevR = Rr;
  }
}

function petal(mesh, O, A, U, V, P, open, scale, lut) {
  const r = add(mul(U, Math.cos(P.az)), mul(V, Math.sin(P.az)));
  const w = add(mul(U, -Math.sin(P.az)), mul(V, Math.cos(P.az)));
  const theta = 6 * RAD + (P.theta - 6 * RAD) * open;
  const curl = P.curl * open;
  const L = P.len * scale, HW = P.width * scale;
  let p = add(O, mul(r, P.base * scale));
  let prev = null, prevIdx = null, d = A;
  const vOf = s => P.vBase + s * P.vSpan + P.jit;
  // Each row runs across the petal: 2·C + 1 points from edge to edge. Edges lift toward the
  // axis by cup·x², and the midrib is a shade lighter. With C = 1 this is the original
  // three-point petal: edges lifted, a flat V.
  const C = P.cols;
  for (let i = 0; i <= P.segs; i++) {
    const s = i / P.segs;
    const th = theta + curl * s * s;
    d = add(mul(A, Math.cos(th)), mul(r, Math.sin(th)));
    const hw = HW * P.profile(s);
    const n = cross(w, d);
    const row = [], idx = [];
    for (let j = -C; j <= C; j++) {
      const x = j / C;
      row.push(add(add(p, mul(w, x * hw)), mul(n, hw * P.cup * 0.6 * x * x)));
      idx.push(lutIndex(vOf(s) + 0.05 * (1 - Math.abs(x))));
    }
    if (prev) for (let j = 0; j < 2 * C; j++) mesh.quad(prev[j], prev[j + 1], row[j + 1], row[j], lut, prevIdx[j], prevIdx[j + 1], idx[j + 1], idx[j]);
    prev = row; prevIdx = idx;
    if (i < P.segs) p = add(p, mul(d, L / P.segs));
  }
  if (P.teeth && prev) {
    const n = P.teeth.length, tip = lutIndex(vOf(1) + 0.04), edge = prevIdx[0];
    const a0 = prev[0], a1 = prev[2 * C];
    for (let k = 0; k < n; k++) {
      const a = lerp3(a0, a1, k / n), b = lerp3(a0, a1, (k + 1) / n);
      const apex = add(lerp3(a, b, 0.5 + P.teeth[k].off * 0.5), mul(d, L * P.teeth[k].len));
      mesh.tri(a, b, apex, lut, edge, edge, tip);
    }
  }
}

/** A disc in the plane spanned by U and V; with `apex`, its centre rises to that point (a low cone). */
function disc(mesh, c, U, V, rad, lut, idx, sides = 10, apex = c) {
  for (let i = 0; i < sides; i++) {
    const a0 = (i / sides) * TAU, a1 = ((i + 1) / sides) * TAU;
    const p0 = add(c, mul(add(mul(U, Math.cos(a0)), mul(V, Math.sin(a0))), rad));
    const p1 = add(c, mul(add(mul(U, Math.cos(a1)), mul(V, Math.sin(a1))), rad));
    mesh.tri(apex, p0, p1, lut, idx, idx, idx);
  }
}

function head(mesh, plant, H, O, A, bud, open, cam) {
  const lut = plant.luts[H.ramp % plant.luts.length] || plant.stemLut;
  const [U, V] = basis(A);
  const budScale = 0.32;
  // Calyx: a few green sepals cupping the base.
  if (H.calyx) {
    const sep = {len: H.S * 0.5, width: H.S * 0.13, theta: 16 * RAD, curl: 0.1, cup: 0.5, profile: PROFILES.lance, segs: 3, base: 0, vBase: 0.2, vSpan: 0.6, jit: 0};
    for (let k = 0; k < 5; k++) petal(mesh, sub(O, mul(A, H.S * 0.3)), A, U, V, {...sep, az: (k / 5) * TAU}, 1, bud, plant.stemLut);
  }
  for (const P of H.petals) {
    // Outer rings open first; each ring overshoots a touch as it settles.
    const stag = 0.45;
    const o = clamp01(open * (1 + stag) - (1 - P.ringFrac) * stag);
    const e = o > 0 ? easeBack(o) : 0;
    const scale = bud * (budScale + (1 - budScale) * Math.min(1.05, e));
    petal(mesh, O, A, U, V, P, Math.min(1.08, e), scale, lut);
  }
  const eo = easeOut(open);
  if (H.disc && eo > 0) {
    const D = H.disc;
    const rad = H.S * D.radius * bud * (0.4 + 0.6 * eo);
    const c = add(O, mul(A, rad * 0.25));
    // A domed centre (daisy) rises toward its middle; its florets follow the dome.
    const dome = (D.dome || 0) * rad;
    // A disc with its own colours (daisy yellow) ignores the petal ramp.
    const discLut = D.color ? new Float32Array([...D.color, ...(D.dot || D.color)]) : lut;
    const face = D.color ? 0 : lutIndex(0.92), dot = D.color ? 3 : lutIndex(0.02);
    disc(mesh, c, U, V, rad, discLut, face, 18, add(c, mul(A, dome)));
    const dots = D.dots;
    for (let i = 0; i < dots; i++) {
      const q = (i + 0.5) / dots, rr = rad * 0.9 * Math.sqrt(q), a = i * 2.39996 + H.discSeed * TAU;
      const h = dome * (1 - rr / rad) + rad * 0.05 + 0.002;
      const pc = add(add(c, mul(add(mul(U, Math.cos(a)), mul(V, Math.sin(a))), rr)), mul(A, h));
      disc(mesh, pc, U, V, rad * (D.color ? 0.07 : 0.085), discLut, dot, 6);
    }
  }
  if (H.stamens && eo > 0) {
    for (let k = 0; k < H.stamens; k++) {
      const az = (k / H.stamens) * TAU + 0.3, r = add(mul(U, Math.cos(az)), mul(V, Math.sin(az)));
      const d = norm(add(mul(A, Math.cos(24 * RAD)), mul(r, Math.sin(24 * RAD))));
      const len = H.S * 1.25 * bud * eo;
      const pts = [O, add(O, mul(d, len * 0.5)), add(add(O, mul(d, len)), mul(r, len * 0.12))];
      ribbon(mesh, pts, [H.S * 0.03, H.S * 0.025, H.S * 0.02], cam.eye, lut);
      // The anther: a small dot facing the camera, in a warm accent.
      disc(mesh, pts[2], cam.right, cam.up, H.S * 0.075 * bud, ANTHER, 0, 8);
    }
  }
}
const ANTHER = new Float32Array([1, 0.62, 0.1]);

function leaf(mesh, plant, L, t, sway, lut) {
  const g = clamp01((t - L.born) / L.grow);
  if (g <= 0) return;
  const at = sample(L.curve.pts, L.u);
  const [bu, bv] = basis(at.t);
  const out = add(mul(bu, Math.cos(L.az)), mul(bv, Math.sin(L.az)));
  const d0 = norm(add(mul(at.t, Math.cos(L.lift)), mul(out, Math.sin(L.lift))));
  const side0 = norm(cross(d0, out));
  const len = L.len * easeOut(g), segs = 6;
  let p = at.p, prev = null;
  const lo = lutIndex(0.05), mid = lutIndex(0.45), hi = lutIndex(0.95);
  for (let i = 0; i <= segs; i++) {
    const s = i / segs;
    const d = norm(add(d0, [0, -L.droop * s * s, 0]));
    const side = norm(add(side0, mul(out, L.twist * s)));
    const hw = L.width * easeOut(g) * PROFILES.leaf(s) * 0.5;
    const wp = windAt(p, t, plant, sway);
    const row = [sub(wp, mul(side, hw)), add(wp, mul(out, hw * 0.15)), add(wp, mul(side, hw))];
    if (prev) {
      mesh.quad(prev[0], prev[1], row[1], row[0], lut, lo, mid, mid, lo);
      mesh.quad(prev[1], prev[2], row[2], row[1], lut, mid, hi, hi, mid);
    }
    prev = row;
    p = add(p, mul(d, len / segs));
  }
}

/**
 * Mesh the plant at time t into mesh (reset first). cam: {eye, right, up}.
 */
export function meshPlant(plant, t, cfg, cam, mesh) {
  mesh.reset();
  const sway = cfg.sway;
  for (const c of plant.curves) {
    const g = easeOut(clamp01((t - c.start) / c.dur));
    if (g <= 0) continue;
    const n = c.pts.length - 1, x = g * n, last = Math.floor(x);
    const pts = [], radii = [];
    for (let i = 0; i <= Math.min(last, n); i++) pts.push(c.pts[i]);
    if (last < n) pts.push(lerp3(c.pts[last], c.pts[last + 1], x - last));
    if (pts.length < 2) continue;
    for (let i = 0; i < pts.length; i++) radii.push(c.r0 + (c.r1 - c.r0) * (i / n));
    ribbon(mesh, pts.map(p => windAt(p, t, plant, sway)), radii, cam.eye, plant.stemLut);
  }
  for (const L of plant.leaves) leaf(mesh, plant, L, t, sway, plant.stemLut);
  for (const H of plant.heads) {
    const c = H.curve;
    const g = easeOut(clamp01((t - c.start) / c.dur));
    if (g <= 0.02) continue;
    // The bud rides up the growing stem, then opens once the stem is done.
    const at = sample(c.pts, g), behind = sample(c.pts, Math.max(0, g - 0.08));
    const O = windAt(at.p, t, plant, sway), B = windAt(behind.p, t, plant, sway);
    // Heads follow their stem's direction, so they stay put as the camera drifts.
    const A = norm(sub(O, B));
    const bud = 0.35 + 0.65 * g;
    const open = clamp01((t - H.openAt) / H.bloom);
    head(mesh, plant, H, add(O, mul(A, H.S * 0.15)), A, bud, open, cam);
  }
  return mesh;
}
