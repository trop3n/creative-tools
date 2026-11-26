// GLYF's matching: how a source cell becomes a glyph. Framework-free (no DOM), so the
// Node checks in scripts/match-check.mjs can run it.
//
// Tone: Classic (the default) matches ink to the screen value, which suits marks seen one
// by one. Linear matches it to light, as print does: a glyph covering 50% of its cell
// reflects half the light, which looks like sRGB 188 from a distance, not 128.
//
// Detail: each cell is read as a GRID × GRID patch and compared with each glyph's own
// patch (and, with Fit rotation, its four turns), so a cell with an edge or a diagonal
// gets a glyph shaped like it, not just one with the same amount of ink. Flat cells are
// matched on tone alone, so smooth areas keep the varied texture of plain dithering. What a choice
// gets wrong in tone is spread to the neighbours (error diffusion), as in plain dithering.

export const GRID = 4;

const s2l = v => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)); // sRGB 0..1 -> linear
const l2s = v => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/**
 * How much ink a pixel wants (0 none .. 1 full), from 8-bit RGB. o: {tone: 'linear' |
 * 'classic', contrast, bright, gamma, invert}. Contrast, brightness and gamma act on the
 * perceived lightness, as the sliders suggest; linear tone then converts to light.
 */
export function inkOf(r, g, b, o) {
  const lin = o.tone !== 'classic';
  let L = lin ? l2s(0.2126 * s2l(r / 255) + 0.7152 * s2l(g / 255) + 0.0722 * s2l(b / 255)) : (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  L = clamp((L - 0.5) * o.contrast + 0.5 + o.bright, 0, 1);
  L = Math.pow(L, 1 / o.gamma);
  if (lin) L = s2l(L);
  return o.invert ? L : 1 - L;
}

/** A GRID × GRID patch (row by row) turned a quarter clockwise, as the canvas turns the glyph. */
export function turn(v) {
  const out = new Float32Array(GRID * GRID);
  for (let R = 0; R < GRID; R++) for (let C = 0; C < GRID; C++) out[R * GRID + C] = v[(GRID - 1 - C) * GRID + R];
  return out;
}

/**
 * The candidates to choose from: each glyph's patch shifted so its mean is its tone level
 * (keeping its shape, scaled by k so the darkest glyph spans 0..1), at each rotation in
 * `rots`, with exact duplicates dropped (a disc looks the same all four ways). `blank`
 * adds the empty cell at level 0.
 * glyphs: [{gl, level, patch (raw ink, GRID²)}]. Returns [{gl, rot, vec, mean}].
 */
export function candidates(glyphs, rots, blank) {
  const means = glyphs.map(g => g.patch.reduce((a, b) => a + b, 0) / g.patch.length);
  const k = 1 / Math.max(1e-6, ...means);
  const out = blank ? [{gl: null, rot: 0, vec: new Float32Array(GRID * GRID), mean: 0}] : [];
  glyphs.forEach((g, i) => {
    let p = Float32Array.from(g.patch, v => g.level + (v - means[i]) * k);
    const seen = [];
    for (let r = 0; r < 4; r++) {
      if (rots.includes(r) && !seen.some(q => q.every((v, j) => Math.abs(v - p[j]) < 1e-4))) {
        seen.push(p);
        out.push({gl: g.gl, rot: r, vec: p, mean: g.level});
      }
      p = turn(p);
    }
  });
  return out;
}

/** A cell whose ink varies this much (standard deviation, 0..0.5) counts as a full edge. */
const EDGE = 0.2;

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/**
 * Choose a candidate for every cell. ink: Float32Array of (cols·GRID) × (rows·GRID) ink
 * values. cands(x, y): the candidates allowed at that cell (rotation may be fixed per
 * cell). detail 0..1: 0 matches tone only, 1 matches the whole patch where the cell has an
 * edge (flat cells always match on tone). method: 'fs' |
 * 'atk' | 'bayer' | 'none'. Returns the chosen candidate per cell.
 */
export function matchCells(ink, cols, rows, cands, detail, method) {
  const n = GRID * GRID, W = cols * GRID, err = new Float32Array(cols * rows), out = new Array(cols * rows);
  const c = new Float32Array(n);
  const step = 1 / 8; // Bayer spread, about one tone level
  const add = (x, y, e) => { if (x >= 0 && x < cols && y < rows) err[y * cols + x] += e; };
  for (let y = 0; y < rows; y++) {
    const rev = method === 'fs' && y & 1, dir = rev ? -1 : 1;
    for (let k = 0; k < cols; k++) {
      const x = rev ? cols - 1 - k : k, i = y * cols + x;
      let off = err[i];
      if (method === 'bayer') off += ((BAYER[(y & 3) * 4 + (x & 3)] + 0.5) / 16 - 0.5) * step;
      let mean = 0;
      for (let r = 0; r < GRID; r++) for (let q = 0; q < GRID; q++) {
        const v = ink[(y * GRID + r) * W + x * GRID + q] + off;
        c[r * GRID + q] = v; mean += v;
      }
      mean /= n;
      // Shape only counts where the cell has some: a flat cell is matched on tone alone, so
      // smooth areas keep the varied texture of plain dithering, and edges get shaped glyphs.
      let v = 0;
      for (let j = 0; j < n; j++) v += (c[j] - mean) * (c[j] - mean);
      const w = detail * Math.min(1, Math.sqrt(v / n) / EDGE);
      let best = null, bd = Infinity;
      for (const cand of cands(x, y)) {
        const dm = mean - cand.mean;
        let d = (1 - w) * n * dm * dm;
        if (w > 0) { let s = 0; for (let j = 0; j < n; j++) { const e = c[j] - cand.vec[j]; s += e * e; } d += w * s; }
        if (d < bd) { bd = d; best = cand; }
      }
      out[i] = best;
      if (method !== 'fs' && method !== 'atk') continue;
      const e = mean - best.mean; // the tone this choice missed by (mean already includes the diffused error)
      if (method === 'fs') { add(x + dir, y, (e * 7) / 16); add(x - dir, y + 1, (e * 3) / 16); add(x, y + 1, (e * 5) / 16); add(x + dir, y + 1, e / 16); }
      else { const e8 = e / 8; add(x + 1, y, e8); add(x + 2, y, e8); add(x - 1, y + 1, e8); add(x, y + 1, e8); add(x + 1, y + 1, e8); add(x, y + 2, e8); }
    }
  }
  return out;
}
