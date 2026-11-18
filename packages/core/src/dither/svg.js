// SVG export. Every cell is a square in a viewBox one unit per cell, so the file
// scales to any size with hard edges. The most common color becomes a background
// rect; every other color is one <path> of rectangles: runs along each row, merged
// down the rows while the run below starts and ends in the same place.

/**
 * Build an SVG from palette indices (one per cell, row by row).
 * @param {ArrayLike<number>} indices  cell colors, as indexes into `colors`
 * @param {number} w  cells across
 * @param {number} h  cells down
 * @param {string[]} colors  hex colors
 * @param {{width?: number, height?: number, title?: string}} [opts]  output size in px (default: one per cell)
 * @returns {string}
 */
export function indicesToSVG(indices, w, h, colors, {width = w, height = h, title = ''} = {}) {
  const n = colors.length;
  // The most common color is the background, so the flattest area costs nothing.
  const counts = new Uint32Array(n);
  for (let i = 0; i < w * h; i++) counts[indices[i]]++;
  let bg = 0;
  for (let k = 1; k < n; k++) if (counts[k] > counts[bg]) bg = k;

  const paths = colors.map(() => []);
  const emit = r => paths[r.k].push(`M${r.x} ${r.y}h${r.len}v${r.h}h-${r.len}z`);
  let open = new Map(); // run start x -> rectangle still growing down
  for (let y = 0; y < h; y++) {
    const next = new Map(), row = y * w;
    for (let x = 0; x < w;) {
      const k = indices[row + x];
      let e = x + 1;
      while (e < w && indices[row + e] === k) e++;
      if (k !== bg) {
        const r = open.get(x);
        if (r && r.k === k && r.len === e - x) { r.h++; open.delete(x); next.set(x, r); }
        else next.set(x, {x, y, len: e - x, h: 1, k});
      }
      x = e;
    }
    for (const r of open.values()) emit(r); // runs that stopped at this row
    open = next;
  }
  for (const r of open.values()) emit(r);

  const esc = s => String(s).replace(/[<>&"]/g, c => ({'<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;'})[c]);
  const out = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${w} ${h}" shape-rendering="crispEdges">`,
  ];
  if (title) out.push(`<title>${esc(title)}</title>`);
  out.push(`<rect width="${w}" height="${h}" fill="${colors[bg]}"/>`);
  paths.forEach((d, k) => { if (d.length) out.push(`<path fill="${colors[k]}" d="${d.join('')}"/>`); });
  out.push('</svg>\n');
  return out.join('\n');
}

/** A two-tone mask (0 = ink, anything else = paper) as an SVG. */
export const maskToSVG = (mask, w, h, ink, paper, opts) => {
  const idx = new Uint8Array(w * h);
  for (let i = 0; i < idx.length; i++) idx[i] = mask[i] !== 0 ? 1 : 0;
  return indicesToSVG(idx, w, h, [ink, paper], opts);
};
