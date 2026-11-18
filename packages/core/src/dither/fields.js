// Ordered / threshold-field dithering. Every pixel is compared with a value from a
// spatial pattern (the "field", 0..255), so pixels never depend on each other.
// That makes these styles cheap and a good fit for a GPU shader later.
//
//   white  if  pixel > field(x, y) * threshold / 255
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

const TAU = Math.PI * 2;
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
 * `v > field(x, y) * threshold / 255` (worked out in doubles). A GPU shader can
 * then threshold with one float32 compare and match the CPU bit for bit.
 */
export function fieldCutoffs(field, w, h, threshold) {
  const scale = threshold / 255, out = new Float32Array(w * h);
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
  const scale = threshold / 255;
  for (let y = 0, p = 0; y < h; y++) {
    for (let x = 0; x < w; x++, p++) buf[p] = buf[p] > field(x, y) * scale ? 255 : 0;
  }
  return buf;
}
