// Ordered / threshold-field dithering. Every pixel is compared with a value from a
// spatial pattern (the "field", 0..255), so pixels never depend on each other.
// That makes these styles cheap and a good fit for a GPU shader later.
//
//   white  if  pixel > field(x, y) * threshold / 127.5
//
// so the default threshold (50%, 127.5) compares against the field itself and a flat
// gray keeps its tone, as in CMYK. Higher thresholds darken, lower ones lighten.
//
// New looks come from new field functions; the rule stays the same.

/** Recursive Bayer matrix of size n (a power of two ≥ 2), values 0..n²-1. */
export function bayerMatrix(n) {
  let m = [[0, 2], [3, 1]];
  for (let size = 2; size < n; size *= 2) {
    const next = [];
    for (let y = 0; y < size * 2; y++) {
      next.push([]);
      for (let x = 0; x < size * 2; x++) {
        const base = 4 * m[y % size][x % size];
        const quad = [[0, 2], [3, 1]][y < size ? 0 : 1][x < size ? 0 : 1];
        next[y].push(base + quad);
      }
    }
    m = next;
  }
  return m;
}

/** A tiled matrix as a field: (cell + 0.5) / cells * 255. */
export function matrixField(matrix) {
  const n = matrix.length;
  const cells = n * matrix[0].length;
  const table = new Float32Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) table[y * n + x] = (matrix[y][x] + 0.5) / cells * 255;
  return (x, y) => table[(y % n) * n + (x % n)];
}

// A 4×4 clustered matrix (values 1..16) that grows dots from the middle out, for a
// coarser, print-like grain than Bayer.
export const BITTONE_MATRIX = [[7, 13, 11, 4], [12, 16, 14, 8], [10, 15, 6, 2], [5, 9, 3, 1]].map(r => r.map(v => v - 1));

/** Small, fast, seedable PRNG so a "noise" frame looks the same every redraw. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Blue-noise rank matrix (void and cluster, Ulichney 1993) of size n×n on a torus.
 * Values 0..n²-1; thresholding it gives evenly spread dots with no grid.
 */
export function blueNoiseMatrix(n = 64, sigma = 1.5, seed = 7) {
  const N = n * n;
  // Toroidal Gaussian, indexed by wrapped offset.
  const g = new Float64Array(N);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const dx = Math.min(x, n - x), dy = Math.min(y, n - y);
    g[y * n + x] = Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma));
  }
  const on = new Uint8Array(N), energy = new Float64Array(N);
  const flip = (p, sign) => {
    on[p] = sign > 0 ? 1 : 0;
    const px = p % n, py = (p / n) | 0;
    for (let y = 0; y < n; y++) {
      const gy = ((y - py + n) % n) * n, row = y * n;
      for (let x = 0; x < n; x++) energy[row + x] += sign * g[gy + ((x - px + n) % n)];
    }
  };
  const tightest = () => { let b = -1, e = -Infinity; for (let p = 0; p < N; p++) if (on[p] && energy[p] > e) { e = energy[p]; b = p; } return b; };
  const largestVoid = () => { let b = -1, e = Infinity; for (let p = 0; p < N; p++) if (!on[p] && energy[p] < e) { e = energy[p]; b = p; } return b; };
  // 1. A random starting set of about a tenth of the pixels, then even it out.
  const rand = mulberry32(seed), start = Math.max(1, Math.floor(N / 10));
  for (let k = 0; k < start;) { const p = Math.floor(rand() * N); if (!on[p]) { flip(p, 1); k++; } }
  for (let guard = 0; guard < N * 4; guard++) {
    const c = tightest();
    flip(c, -1);
    const v = largestVoid();
    if (v === c) { flip(c, 1); break; }
    flip(v, 1);
  }
  const rank = new Int32Array(N), initial = on.slice(), initialEnergy = energy.slice();
  // 2. Rank the starting set by taking out the tightest cluster each time.
  for (let r = start - 1; r >= 0; r--) { const c = tightest(); rank[c] = r; flip(c, -1); }
  // 3. From the starting set, fill the largest void each time for the rest.
  on.set(initial); energy.set(initialEnergy);
  for (let r = start; r < N; r++) { const v = largestVoid(); rank[v] = r; flip(v, 1); }
  return Array.from({length: n}, (_, y) => Array.from(rank.subarray(y * n, y * n + n)));
}
let blueNoise = null;

const TAU = Math.PI * 2;

/**
 * Spread a field's values evenly over 0..255 while keeping their order, so a flat
 * gray of tone t comes out about t/255 white. Samples up to n×n points spread over
 * a w×h area (by default the 256×256 patch at the origin).
 */
export function equalize(field, w = 256, h = 256, n = 256) {
  const nx = Math.min(n, w), ny = Math.min(n, h), N = nx * ny, samples = new Float64Array(N);
  let lo = Infinity, hi = -Infinity;
  for (let j = 0, p = 0; j < ny; j++) {
    const y = Math.floor(((j + 0.5) * h) / ny);
    for (let i = 0; i < nx; i++, p++) {
      const v = field(Math.floor(((i + 0.5) * w) / nx), y);
      samples[p] = v; if (v < lo) lo = v; if (v > hi) hi = v;
    }
  }
  if (!(hi > lo)) return () => 127.5;
  // Cumulative histogram: a value's place is the share of samples below it,
  // interpolated across its bin, so the mapping stays smooth and in order.
  const B = 4096, scale = B / (hi - lo), below = new Float64Array(B + 1);
  for (let p = 0; p < N; p++) below[Math.min(B - 1, Math.floor((samples[p] - lo) * scale)) + 1]++;
  for (let b = 0; b < B; b++) below[b + 1] += below[b];
  for (let b = 0; b <= B; b++) below[b] = (below[b] / N) * 255;
  return (x, y) => {
    const t = (field(x, y) - lo) * scale;
    if (t <= 0) return below[0];
    if (t >= B) return below[B];
    const b = Math.floor(t);
    return below[b] + (below[b + 1] - below[b]) * (t - b);
  };
}
const rad = deg => (deg * Math.PI) / 180;

// Field builders: (w, h, params) => (x, y) => 0..255
export const FIELDS = {
  bayer: (w, h, p) => matrixField(bayerMatrix(p.size ?? 4)),
  bittone: () => matrixField(BITTONE_MATRIX),
  // A sine that runs once across the width and drifts down the rows.
  wave: (w, h, p) => {
    const cycles = p.cycles ?? 1, slant = p.slant ?? 10;
    return (x, y) => 128 + 127 * Math.sin((TAU * cycles * x) / w + y / slant);
  },
  // Concentric rings around the middle of the frame.
  rings: (w, h, p) => {
    const cx = Math.floor(w / 2), cy = Math.floor(h / 2), spacing = p.spacing ?? 5;
    return (x, y) => 128 + 127 * Math.sin(Math.hypot(x - cx, y - cy) / spacing);
  },
  noise: (w, h, p) => {
    const rand = mulberry32(p.seed ?? 1);
    const table = new Float32Array(w * h);
    for (let i = 0; i < table.length; i++) table[i] = rand() * 255;
    return (x, y) => table[y * w + x];
  },
  // Round dots on a rotated grid, like a newspaper halftone screen.
  dots: (w, h, p) => {
    const cell = p.cell ?? 6, a = rad(p.angle ?? 45), c = Math.cos(a), s = Math.sin(a);
    return (x, y) => {
      const u = x * c + y * s, v = -x * s + y * c;
      return (0.5 + 0.25 * (Math.cos((TAU * u) / cell) + Math.cos((TAU * v) / cell))) * 255;
    };
  },
  // Evenly scattered dots with no grid, like hand stippling (blue noise).
  stipple: () => (blueNoise ??= matrixField(blueNoiseMatrix())),
  // Diamond dots on a grid that grow and join as the tone darkens.
  diamonds: (w, h, p) => {
    const cell = p.cell ?? 8, a = rad(p.angle ?? 0), c = Math.cos(a), s = Math.sin(a);
    const frac = v => v - Math.floor(v);
    // Evened out so each tone covers its share of the page (raw diamond distances don't).
    return equalize((x, y) => {
      const u = frac((x * c + y * s) / cell), v = frac((-x * s + y * c) / cell);
      return 1 - (Math.abs(u - 0.5) + Math.abs(v - 0.5));
    });
  },
  // Layers of hatching: lighter tones get one direction, darker ones add more.
  crosshatch: (w, h, p) => {
    const spacing = p.spacing ?? 6, layers = Math.max(1, Math.min(4, p.layers ?? 4)), base = rad(p.angle ?? 45);
    const sets = [0, 90, 45, 135].slice(0, layers).map((deg, i) => {
      const a = base + rad(deg);
      return {c: Math.cos(a), s: Math.sin(a), level: (1 - i / layers) * 0.85, phase: i * 0.37};
    });
    // Raw values bunch up near zero (most of the page is between lines), so even them out.
    return equalize((x, y) => {
      let f = 0;
      for (const L of sets) {
        const line = 0.5 + 0.5 * Math.cos(TAU * ((x * L.c + y * L.s) / spacing + L.phase));
        f = Math.max(f, L.level * line);
      }
      return f;
    });
  },
  // Arms that wind out from the middle of the frame.
  spiral: (w, h, p) => {
    const cx = w / 2, cy = h / 2, arms = p.arms ?? 3, spacing = p.spacing ?? 8;
    return (x, y) => 128 + 127 * Math.sin(arms * Math.atan2(y - cy, x - cx) + (TAU * Math.hypot(x - cx, y - cy)) / spacing);
  },
  // Parallel lines that thicken in the shadows, like an engraving.
  lines: (w, h, p) => {
    const spacing = p.spacing ?? 6, a = rad(p.angle ?? 30), c = Math.cos(a), s = Math.sin(a);
    return (x, y) => (0.5 + 0.5 * Math.cos((TAU * (x * c + y * s)) / spacing)) * 255;
  },
};

const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);

/**
 * Per-pixel cutoffs for a field, as float32 values `c` chosen so that, for any
 * float32 pixel value v, `v > c` gives exactly the same answer as applyField's
 * `v > field(x, y) * threshold / 127.5` (worked out in doubles). A GPU shader can
 * then threshold with one float32 compare and match the CPU bit for bit.
 */
export function fieldCutoffs(field, w, h, threshold) {
  const scale = threshold / 127.5, out = new Float32Array(w * h);
  for (let y = 0, p = 0; y < h; y++) {
    for (let x = 0; x < w; x++, p++) {
      const c = field(x, y) * scale;
      f32[0] = c;
      // Rounded up past c: step one float32 down, since "v > c" = "v ≥ that float32".
      if (f32[0] > c && f32[0] > 0) u32[0]--;
      out[p] = f32[0];
    }
  }
  return out;
}

/** Threshold `buf` in place against a field. */
export function applyField(buf, w, h, field, threshold) {
  const scale = threshold / 127.5;
  for (let y = 0, p = 0; y < h; y++) {
    for (let x = 0; x < w; x++, p++) buf[p] = buf[p] > field(x, y) * scale ? 255 : 0;
  }
  return buf;
}
