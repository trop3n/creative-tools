// Patterns: procedural gray fields used as a source. GLYF turns them into glyph patterns
// (with Fit or Random rotation, a palette, any glyph set) and exports them as SVG or PNG,
// so the same few fields make very different whole-image patterns. Framework-free: it
// fills an RGBA array, so scripts/families-check.mjs can run it too.

export const PATTERNS = [
  {id: 'noise', name: 'Noise', hint: 'Soft clouds of light and dark. Detail adds finer layers.'},
  {id: 'waves', name: 'Waves', hint: 'Crossing ripples. Detail adds more wave directions; Angle turns them.'},
  {id: 'radial', name: 'Rings', hint: 'Rings around the middle. Detail wobbles them.'},
  {id: 'spiral', name: 'Spiral', hint: 'Arms winding out from the middle. Detail adds arms.'},
  {id: 'cells', name: 'Cells', hint: 'Stones or bubbles: each point takes its distance to the nearest of many seeds.'},
  {id: 'gradient', name: 'Gradient', hint: 'A plain ramp from light to dark. Angle turns it; Detail bends it into a wave.'},
];

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Smooth value noise on a lattice of `size` random values, wrapped. */
function valueNoise(seed, size = 64) {
  const R = rng(seed), v = Float32Array.from({length: size * size}, R), m = size - 1;
  const at = (x, y) => v[(y & m) * size + (x & m)];
  const s = t => t * t * (3 - 2 * t);
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), fx = s(x - xi), fy = s(y - yi);
    const a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), d = at(xi + 1, yi + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
}

/**
 * Fill data (RGBA, W × H) with pattern p: {kind, scale 1..20, detail 0..1, angle degrees,
 * seed}. Light is 255, dark 0.
 */
export function drawPattern(data, W, H, p) {
  const S = Math.max(W, H), ang = (p.angle * Math.PI) / 180, ca = Math.cos(ang), sa = Math.sin(ang);
  const R = rng(p.seed * 9973 + 7), noise = valueNoise(p.seed);
  const octaves = 1 + Math.round(p.detail * 4);
  const dirs = Array.from({length: 1 + Math.round(p.detail * 3)}, (_, i) => ang + (i * Math.PI) / (1 + Math.round(p.detail * 3)) + R() * 0.3);
  const seeds = p.kind === 'cells' ? Array.from({length: Math.round(4 + p.scale * p.scale * 0.6)}, () => [R(), R()]) : [];
  const arms = 1 + Math.round(p.detail * 5);
  let lo = Infinity, hi = -Infinity;
  const f = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const u = x / S, v = y / S, cu = (x - W / 2) / S, cv = (y - H / 2) / S;
    let val;
    switch (p.kind) {
      case 'waves': val = dirs.reduce((a, d) => a + Math.sin((u * Math.cos(d) + v * Math.sin(d)) * p.scale * 6.283), 0); break;
      case 'radial': {
        const r = Math.hypot(cu, cv), wob = p.detail * 0.6 * noise(cu * 3 + 10, cv * 3 + 10);
        val = Math.cos((r + wob * 0.1) * p.scale * 12.566); break;
      }
      case 'spiral': {
        const r = Math.hypot(cu, cv), a = Math.atan2(cv, cu);
        val = Math.cos(r * p.scale * 12.566 - a * arms + ang); break;
      }
      case 'cells': {
        let d1 = Infinity, d2 = Infinity;
        for (const [sx, sy] of seeds) { const d = Math.hypot(u - sx * (W / S), v - sy * (H / S)); if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d; }
        val = (1 - p.detail) * d1 + p.detail * (d2 - d1); break;
      }
      case 'gradient': {
        const t = cu * ca + cv * sa, n = -cu * sa + cv * ca;
        val = t + p.detail * 0.15 * Math.sin(n * p.scale * 6.283); break;
      }
      default: { // noise
        let amp = 1, freq = p.scale * 0.8; val = 0;
        for (let o = 0; o < octaves; o++) { val += amp * noise((u * ca - v * sa) * freq, (u * sa + v * ca) * freq); amp *= 0.5; freq *= 2; }
      }
    }
    f[y * W + x] = val; if (val < lo) lo = val; if (val > hi) hi = val;
  }
  const k = hi > lo ? 255 / (hi - lo) : 0;
  for (let i = 0; i < W * H; i++) { const g = (f[i] - lo) * k; data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = g; data[i * 4 + 3] = 255; }
}
