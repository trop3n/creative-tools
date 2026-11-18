// SVG export. Every cell is a square in a viewBox one unit per cell, so the file
// scales to any size with hard edges. The most common color becomes a background
// rect; every other color is one <path> of rectangles: runs along each row, merged
// down the rows while the run below starts and ends in the same place.
// Shaped cells (cells.js) draw every cell as its own dot, diamond or square on a
// background in the gap color; lines join along each row.
import {isPlainCells} from './cells.js';

/**
 * Build an SVG from palette indices (one per cell, row by row).
 * @param {ArrayLike<number>} indices  cell colors, as indexes into `colors`
 * @param {number} w  cells across
 * @param {number} h  cells down
 * @param {string[]} colors  hex colors
 * @param {{width?: number, height?: number, title?: string, shape?: string, gap?: number, gapColor?: string}} [opts]
 *   output size in px (default: one per cell), and the cell shape
 * @returns {string}
 */
export function indicesToSVG(indices, w, h, colors, opts = {}) {
  const {width = w, height = h, title = ''} = opts;
  if (!isPlainCells(opts.shape, opts.gap)) return shapedSVG(indices, w, h, colors, opts);
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

  return wrap(w, h, width, height, title, colors[bg], colors, paths, ' shape-rendering="crispEdges"');
}

const esc = s => String(s).replace(/[<>&"]/g, c => ({'<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;'})[c]);
const num = v => String(+v.toFixed(4));

function wrap(w, h, width, height, title, background, colors, paths, extra = '') {
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${w} ${h}"${extra}>`];
  if (title) out.push(`<title>${esc(title)}</title>`);
  out.push(`<rect width="${w}" height="${h}" fill="${background}"/>`);
  paths.forEach((d, k) => { if (d.length) out.push(`<path fill="${colors[k]}" d="${d.join('')}"/>`); });
  out.push('</svg>\n');
  return out.join('\n');
}

/** Every cell as its own shape on a gap-colored background. */
function shapedSVG(indices, w, h, colors, {width = w, height = h, title = '', shape = 'square', gap = 0, gapColor = '#000000'}) {
  const s = Math.max(0, 1 - gap), r = s / 2, o = (1 - s) / 2;
  const paths = colors.map(() => []);
  // A cell in the gap color is invisible, so it is left out.
  const skip = colors.map(c => c.toLowerCase() === String(gapColor).toLowerCase());
  if (s > 0) for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w;) {
      const k = indices[row + x];
      if (shape === 'lines') {
        let e = x + 1;
        while (e < w && indices[row + e] === k) e++;
        if (!skip[k]) paths[k].push(`M${x} ${num(y + o)}h${e - x}v${num(s)}h-${e - x}z`);
        x = e;
        continue;
      }
      if (!skip[k]) {
        const d = paths[k];
        if (shape === 'dot') d.push(`M${num(x + o)} ${num(y + 0.5)}a${num(r)} ${num(r)} 0 1 0 ${num(s)} 0a${num(r)} ${num(r)} 0 1 0 -${num(s)} 0z`);
        else if (shape === 'diamond') d.push(`M${num(x + 0.5)} ${num(y + o)}l${num(r)} ${num(r)}l-${num(r)} ${num(r)}l-${num(r)} -${num(r)}z`);
        else d.push(`M${num(x + o)} ${num(y + o)}h${num(s)}v${num(s)}h-${num(s)}z`);
      }
      x++;
    }
  }
  return wrap(w, h, width, height, title, gapColor, colors, paths);
}

/** A two-tone mask (0 = ink, anything else = paper) as an SVG. */
export const maskToSVG = (mask, w, h, ink, paper, opts) => {
  const idx = new Uint8Array(w * h);
  for (let i = 0; i < idx.length; i++) idx[i] = mask[i] !== 0 ? 1 : 0;
  return indicesToSVG(idx, w, h, [ink, paper], opts);
};
