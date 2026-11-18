// Error-diffusion dithering. Each pixel is snapped to black or white and the
// rounding error is pushed onto neighbours that haven't been visited yet.
//
// Kernels are lists of [dy, dx, weight]: ROW offset first (+1 = next row), then
// column offset. Swapping the two aims taps at rows that are already finished
// and quietly wrecks the output, which the tests check for.

const k = (div, taps) => taps.map(([dy, dx, w]) => [dy, dx, w / div]);

export const KERNELS = {
  'floyd-steinberg': k(16, [[0, 1, 7], [1, -1, 3], [1, 0, 5], [1, 1, 1]]),
  // Atkinson only passes on 6/8 of the error, which is what gives it its bright, crisp look.
  atkinson: k(8, [[0, 1, 1], [0, 2, 1], [1, -1, 1], [1, 0, 1], [1, 1, 1], [2, 0, 1]]),
  'jarvis-judice-ninke': k(48, [
    [0, 1, 7], [0, 2, 5],
    [1, -2, 3], [1, -1, 5], [1, 0, 7], [1, 1, 5], [1, 2, 3],
    [2, -2, 1], [2, -1, 3], [2, 0, 5], [2, 1, 3], [2, 2, 1],
  ]),
  stucki: k(42, [
    [0, 1, 8], [0, 2, 4],
    [1, -2, 2], [1, -1, 4], [1, 0, 8], [1, 1, 4], [1, 2, 2],
    [2, -2, 1], [2, -1, 2], [2, 0, 4], [2, 1, 2], [2, 2, 1],
  ]),
  burkes: k(32, [[0, 1, 8], [0, 2, 4], [1, -2, 2], [1, -1, 4], [1, 0, 8], [1, 1, 4], [1, 2, 2]]),
  sierra: k(32, [
    [0, 1, 5], [0, 2, 3],
    [1, -2, 2], [1, -1, 4], [1, 0, 5], [1, 1, 4], [1, 2, 2],
    [2, -1, 2], [2, 0, 3], [2, 1, 2], // published value; the research table had 4 here (sums to 33/32)
  ]),
  'two-row-sierra': k(16, [[0, 1, 4], [0, 2, 3], [1, -2, 1], [1, -1, 2], [1, 0, 3], [1, 1, 2], [1, 2, 1]]),
  'sierra-lite': k(4, [[0, 1, 2], [1, -1, 1], [1, 0, 1]]),
  // Stevenson & Arce (1985): designed for hexagonal grids, gives a softer, wider grain.
  'stevenson-arce': k(200, [
    [0, 2, 32],
    [1, -3, 12], [1, -1, 26], [1, 1, 30], [1, 3, 16],
    [2, -2, 12], [2, 0, 26], [2, 2, 12],
    [3, -3, 5], [3, -1, 12], [3, 1, 12], [3, 3, 5],
  ]),
};

/**
 * Dither `buf` (grayscale 0..255, length w*h) in place with an error-diffusion kernel.
 * serpentine: alternate scan direction each row, which breaks up the diagonal "worms".
 */
export function diffuse(buf, w, h, kernel, threshold, serpentine = false) {
  const n = kernel.length;
  const dys = new Int32Array(n), dxs = new Int32Array(n), wts = new Float64Array(n);
  kernel.forEach(([dy, dx, wt], i) => { dys[i] = dy; dxs[i] = dx; wts[i] = wt; });

  for (let y = 0; y < h; y++) {
    const flip = serpentine && (y & 1) === 1;
    const dir = flip ? -1 : 1;
    for (let i = 0, x = flip ? w - 1 : 0; i < w; i++, x += dir) {
      const p = y * w + x;
      const old = buf[p];
      const val = old < threshold ? 0 : 255;
      buf[p] = val;
      const err = old - val;
      if (err === 0) continue;
      for (let t = 0; t < n; t++) {
        const ny = y + dys[t];
        const nx = x + dxs[t] * dir;
        if (ny >= h || nx < 0 || nx >= w) continue;
        const q = ny * w + nx;
        const v = buf[q] + err * wts[t];
        buf[q] = v < 0 ? 0 : v > 255 ? 255 : v;
      }
    }
  }
  return buf;
}

/** Normalised Gaussian, radius = round(3σ). Returns {kernel, radius}. */
export function gaussian1d(sigma) {
  if (sigma <= 0) return {kernel: new Float64Array([1]), radius: 0};
  const r = Math.floor(3 * sigma + 0.5);
  const kernel = new Float64Array(2 * r + 1);
  let s = 0;
  for (let i = 0; i < kernel.length; i++) {
    const x = i - r;
    s += kernel[i] = Math.exp(-(x * x) / (2 * sigma * sigma));
  }
  for (let i = 0; i < kernel.length; i++) kernel[i] /= s;
  return {kernel, radius: r};
}

/**
 * Scanline diffusion: each row is dithered on its own, with error pushed only
 * forward along the row using the right half of a Gaussian. Rows don't talk to
 * each other, so the result reads as horizontal streaks, like a worn VHS tape.
 */
export function diffuseScanlines(buf, w, h, sigma, threshold) {
  const {kernel, radius} = gaussian1d(sigma);
  const taps = kernel.slice(radius + 1);
  const total = taps.reduce((a, b) => a + b, 0);
  if (total > 0) for (let i = 0; i < taps.length; i++) taps[i] /= total;

  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const old = buf[row + x];
      const val = old < threshold ? 0 : 255;
      buf[row + x] = val;
      const err = old - val;
      if (err === 0) continue;
      for (let i = 0; i < taps.length && x + 1 + i < w; i++) {
        const q = row + x + 1 + i;
        const v = buf[q] + err * taps[i];
        buf[q] = v < 0 ? 0 : v > 255 ? 255 : v;
      }
    }
  }
  return buf;
}
