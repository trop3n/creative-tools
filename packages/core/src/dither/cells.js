// Cell shapes: draw each cell as a square, a round dot, a diamond or a horizontal
// line, with a gap around it in a background color. Dot-matrix, LED and CRT looks.
//
// The rule works on pixel centers in whole numbers, so the CPU painter and the GPU
// shader agree exactly. For a cell k pixels wide, pixel i (0..k-1) sits at
// d = 2i + 1 − k half-pixels from the middle, and is inside the shape when
//   square   max(|dx|, |dy|) ≤ R        dot    dx² + dy² ≤ R²
//   diamond  |dx| + |dy| ≤ R            lines  |dy| ≤ R
// with R = k × (1 − gap), as float32 (and R² rounded to float32 once, here).
import {hexToRGB} from './palette.js';

export const SHAPES = [
  {id: 'square', name: 'Squares'},
  {id: 'dot', name: 'Round dots'},
  {id: 'diamond', name: 'Diamonds'},
  {id: 'lines', name: 'Lines'},
];
export const SHAPE_CODE = {square: 0, dot: 1, diamond: 2, lines: 3};

/** True when cells are plain squares that touch (the classic look, nothing to draw). */
export const isPlainCells = (shape, gap) => (!shape || shape === 'square') && !(gap > 0);

/** The shape test's numbers, shared by the CPU stamp and the GPU uniforms. */
export function shapeRadius(k, gap = 0) {
  const r = Math.fround(k * (1 - Math.min(1, Math.max(0, gap))));
  return {r, r2: Math.fround(r * r)};
}

/** A k×k stamp: 1 where a pixel of the cell is inside the shape, 0 in the gap. */
export function cellStamp(shape, k, gap = 0) {
  const {r, r2} = shapeRadius(k, gap), out = new Uint8Array(k * k);
  for (let j = 0; j < k; j++) {
    const dy = Math.abs(2 * j + 1 - k);
    for (let i = 0; i < k; i++) {
      const dx = Math.abs(2 * i + 1 - k);
      out[j * k + i] =
        shape === 'dot' ? dx * dx + dy * dy <= r2
        : shape === 'diamond' ? dx + dy <= r
        : shape === 'lines' ? dy <= r
        : Math.max(dx, dy) <= r;
    }
  }
  return out;
}

/** The darkest or lightest of a set of hex colors (by luma). */
export function extremeColor(colors, which = 'dark') {
  const luma = c => { const [r, g, b] = hexToRGB(c); return r * 299 + g * 587 + b * 114; };
  return colors.reduce((a, c) => ((which === 'light' ? luma(c) > luma(a) : luma(c) < luma(a)) ? c : a), colors[0]);
}

/**
 * Paint palette indices as shaped cells, k pixels per cell, into RGBA (w·k × h·k).
 * Pixels outside the shape take `gapColor`.
 */
export function paintCells(indices, w, h, k, colors, shape = 'square', gap = 0, gapColor = '#000000') {
  const rgb = colors.map(hexToRGB), bg = hexToRGB(gapColor), stamp = cellStamp(shape, k, gap);
  const W = w * k, out = new Uint8ClampedArray(W * h * k * 4);
  for (let y = 0; y < h; y++) {
    for (let j = 0; j < k; j++) {
      let p = ((y * k + j) * W) * 4;
      const srow = j * k;
      for (let x = 0; x < w; x++) {
        const c = rgb[indices[y * w + x]] || rgb[0];
        for (let i = 0; i < k; i++, p += 4) {
          const v = stamp[srow + i] ? c : bg;
          out[p] = v[0]; out[p + 1] = v[1]; out[p + 2] = v[2]; out[p + 3] = 255;
        }
      }
    }
  }
  return out;
}
