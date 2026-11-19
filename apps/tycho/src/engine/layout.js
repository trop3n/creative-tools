// TYCHO's composition: a seeded recursive split of a unit grid into rectangular cells.
// The grid adapts to the frame: its unit is the short side divided by `grid`.

/** Seeded random numbers in [0, 1) (mulberry32). */
export function rng(seed) {
  let a = (seed >>> 0) || 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** A stable 32-bit hash of a few integers, for deriving sub-seeds. */
export function hashInts(...xs) {
  let h = 2166136261 >>> 0;
  for (const x of xs) { h ^= x >>> 0; h = Math.imul(h, 16777619) >>> 0; h ^= h >>> 13; }
  return h >>> 0;
}

/** Columns and rows of the unit grid for a frame of aspect `aspect` (width / height). */
export function gridDims(aspect, grid) {
  if (aspect >= 1) return {cols: Math.max(1, Math.round(grid * aspect)), rows: grid};
  return {cols: grid, rows: Math.max(1, Math.round(grid / aspect))};
}

/**
 * Split cols × rows into cells {x, y, w, h} (in grid units).
 * depth: most splits along any branch. minCell: smallest side, in units.
 * hold: 0..1, the chance a cell stops splitting early (so big cells survive).
 */
export function splitLayout(cols, rows, {depth, minCell, hold}, seed) {
  const R = rng(seed);
  const out = [];
  const split = (x, y, w, h, d) => {
    const canX = w >= 2 * minCell, canY = h >= 2 * minCell;
    if (d >= depth || (!canX && !canY) || (d > 0 && R() < hold)) { out.push({x, y, w, h}); return; }
    // Cut across the long side so cells stay squarish.
    let axis = w > h ? 'x' : h > w ? 'y' : R() < 0.5 ? 'x' : 'y';
    if (axis === 'x' && !canX) axis = 'y';
    if (axis === 'y' && !canY) axis = 'x';
    const len = axis === 'x' ? w : h;
    const cut = Math.min(len - minCell, Math.max(minCell, Math.round(len * (0.33 + R() * 0.34))));
    if (axis === 'x') { split(x, y, cut, h, d + 1); split(x + cut, y, w - cut, h, d + 1); }
    else { split(x, y, w, cut, d + 1); split(x, y + cut, w, h - cut, d + 1); }
  };
  split(0, 0, cols, rows, 0);
  return out;
}

/** For each cell, the indices of cells sharing an edge with it. */
export function neighbours(cells) {
  const out = cells.map(() => []);
  const overlap = (a0, a1, b0, b1) => Math.min(a1, b1) - Math.max(a0, b0) > 0;
  for (let i = 0; i < cells.length; i++) {
    const a = cells[i];
    for (let j = i + 1; j < cells.length; j++) {
      const b = cells[j];
      const side = (a.x + a.w === b.x || b.x + b.w === a.x) && overlap(a.y, a.y + a.h, b.y, b.y + b.h);
      const top = (a.y + a.h === b.y || b.y + b.h === a.y) && overlap(a.x, a.x + a.w, b.x, b.x + b.w);
      if (side || top) { out[i].push(j); out[j].push(i); }
    }
  }
  return out;
}
