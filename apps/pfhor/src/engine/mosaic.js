// PFHOR's mosaic: a quadtree over an image. Flat regions stay as big cells; detailed ones
// split into smaller cells. Each cell takes a palette colour and is drawn as a circle,
// square, rounded square or one of GLYF's glyphs (picked by tone). Nothing is kept between frames: splits ease in as the
// threshold passes them, so the "resolve" animation and exports come out the same every time.
import {parseColor, linearToOklab} from '@studio/core/gradient';

export const SHAPES = {circle: 'Circles', square: 'Squares', rounded: 'Rounded squares', mixed: 'Mixed', glyph: 'Glyphs (from GLYF)'};
export const METRICS = {variance: 'Tone', edge: 'Edges', both: 'Tone and edges'};
export const MAPPINGS = {ramp: 'Lightness ramp', nearest: 'Nearest color'};

/* ---------- analysis ---------- */
const toLin = v => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));

/**
 * Summed-area tables for an RGBA image (aW × aH): luminance, luminance², r, g, b and edge
 * strength, so any rectangle's mean and variance cost four lookups.
 * contrast and brightness adjust luminance before anything else.
 */
export function analyze(data, aW, aH, contrast = 1, brightness = 0) {
  const n = aW * aH;
  const lum = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const l = (0.2126 * data[i * 4] + 0.7152 * data[i * 4 + 1] + 0.0722 * data[i * 4 + 2]) / 255;
    lum[i] = Math.min(1, Math.max(0, (l - 0.5) * contrast + 0.5 + brightness));
  }
  // Sobel edge strength.
  const edge = new Float32Array(n);
  for (let y = 1; y < aH - 1; y++) {
    for (let x = 1; x < aW - 1; x++) {
      const i = y * aW + x;
      const gx = lum[i - aW + 1] + 2 * lum[i + 1] + lum[i + aW + 1] - lum[i - aW - 1] - 2 * lum[i - 1] - lum[i + aW - 1];
      const gy = lum[i + aW - 1] + 2 * lum[i + aW] + lum[i + aW + 1] - lum[i - aW - 1] - 2 * lum[i - aW] - lum[i - aW + 1];
      edge[i] = Math.min(1, Math.hypot(gx, gy) / 4);
    }
  }
  const W1 = aW + 1, size = W1 * (aH + 1);
  const T = {l: new Float64Array(size), l2: new Float64Array(size), r: new Float64Array(size), g: new Float64Array(size), b: new Float64Array(size), e: new Float64Array(size)};
  for (let y = 0; y < aH; y++) {
    let sl = 0, sl2 = 0, sr = 0, sg = 0, sb = 0, se = 0;
    for (let x = 0; x < aW; x++) {
      const i = y * aW + x, l = lum[i];
      sl += l; sl2 += l * l; se += edge[i];
      sr += data[i * 4] / 255; sg += data[i * 4 + 1] / 255; sb += data[i * 4 + 2] / 255;
      const o = (y + 1) * W1 + x + 1, u = y * W1 + x + 1;
      T.l[o] = T.l[u] + sl; T.l2[o] = T.l2[u] + sl2; T.e[o] = T.e[u] + se;
      T.r[o] = T.r[u] + sr; T.g[o] = T.g[u] + sg; T.b[o] = T.b[u] + sb;
    }
  }
  return {aW, aH, W1, T};
}

/** Mean values over the rectangle [x0, x1) × [y0, y1), clamped to the image; null if empty. */
function region(A, x0, y0, x1, y1) {
  x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0));
  x1 = Math.min(A.aW, Math.ceil(x1)); y1 = Math.min(A.aH, Math.ceil(y1));
  const area = (x1 - x0) * (y1 - y0);
  if (area <= 0) return null;
  const {W1, T} = A;
  const s = t => (t[y1 * W1 + x1] - t[y0 * W1 + x1] - t[y1 * W1 + x0] + t[y0 * W1 + x0]) / area;
  const l = s(T.l);
  return {l, sd: Math.sqrt(Math.max(0, s(T.l2) - l * l)), e: s(T.e), r: s(T.r), g: s(T.g), b: s(T.b)};
}

/* ---------- palette ---------- */
/** Palette lookups: colours sorted for the ramp, and Oklab values for nearest-colour matching. */
export function preparePalette(cfg) {
  const labs = cfg.colors.map(c => parseColor(c) || [0, 0, 0]);
  const order = cfg.colors.map((_, i) => i);
  if (cfg.order === 'light') order.sort((a, b) => labs[a][0] - labs[b][0]);
  return {colors: cfg.colors, labs, order};
}
function colorFor(P, cfg, st) {
  if (cfg.mapping === 'ramp') {
    const N = P.order.length;
    return P.colors[P.order[Math.min(N - 1, Math.floor(st.l * N))]];
  }
  const lab = linearToOklab([toLin(st.r), toLin(st.g), toLin(st.b)]);
  let best = 0, bd = Infinity;
  P.labs.forEach((q, i) => {
    const d = (q[0] - lab[0]) ** 2 + (q[1] - lab[1]) ** 2 + (q[2] - lab[2]) ** 2;
    if (d < bd) { bd = d; best = i; }
  });
  return P.colors[best];
}

/* ---------- the tree ---------- */
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const metricOf = (cfg, st) => (cfg.metric === 'variance' ? st.sd * 2 : cfg.metric === 'edge' ? st.e : Math.max(st.sd * 2, st.e));

/** The threshold at loop phase lp: with Resolve on, the image coarsens toward mid-loop and sharpens back. */
export function thresholdAt(cfg, lp) {
  return cfg.threshold * (1 + cfg.resolve * 8 * (0.5 - 0.5 * Math.cos(2 * Math.PI * lp)));
}

/**
 * Cells for an analysis at threshold thr: [{cx, cy, sz, color, l, id}] in analysis pixels
 * (l: the cell's mean luminance, 0..1, for picking a glyph by tone).
 * With `ease`, a cell whose detail is just over the threshold is only part-way split: its
 * children start stacked on the parent and spread to their own places as the detail rises,
 * so an animated threshold never pops.
 */
export function buildCells(A, cfg, thr, ease = true) {
  const P = preparePalette(cfg);
  const out = [];
  const root = Math.max(4, Math.min(A.aW, A.aH) / cfg.roots);
  // Without easing (a still threshold), splits are all-or-nothing, so no cell rests half-split.
  const soft = ease ? thr * 0.45 + 0.004 : 1e-9;
  // `cap`: a cell is never more split than its parent, so a subtree eases out with it.
  const visit = (x, y, size, depth, dcx, dcy, dsz, inherit, cap, inheritL) => {
    const st = region(A, x, y, x + size, y + size);
    if (!st) return;
    const own = colorFor(P, cfg, st);
    const canSplit = depth < cfg.maxDepth && size / 2 >= cfg.minSize;
    const s = canSplit ? Math.min(cap, smooth(thr, thr + soft, metricOf(cfg, st))) : 0;
    if (s <= 0) { out.push({cx: dcx, cy: dcy, sz: dsz, color: inherit || own, l: inherit ? inheritL : st.l, id: ((x * 73856093) ^ (y * 19349663) ^ (size * 83492791)) >>> 0}); return; }
    const h = size / 2, k = dsz / size;
    for (let j = 0; j < 2; j++) {
      for (let i = 0; i < 2; i++) {
        const ox = (i - 0.5) * h, oy = (j - 0.5) * h; // child centre relative to this cell's centre
        visit(x + i * h, y + j * h, h, depth + 1, dcx + s * ox * k, dcy + s * oy * k, dsz * (1 - s / 2), s < 0.5 ? inherit || own : null, s, inherit ? inheritL : st.l);
      }
    }
  };
  for (let y = 0; y < A.aH; y += root) for (let x = 0; x < A.aW; x += root) visit(x, y, root, 0, x + root / 2, y + root / 2, root, null, 1);
  return out;
}

/* ---------- drawing ---------- */
const hash = (id, k) => { let h = (id ^ Math.imul(k + 1, 0x9e3779b1)) >>> 0; h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d); h = Math.imul(h ^ (h >>> 12), 0x297a2d39); return ((h ^ (h >>> 15)) >>> 0) / 4294967296; };

/** How far the cells are scattered at loop phase lp (0..1). */
export const scatterAt = (cfg, lp) => cfg.scatter * Math.pow(Math.sin(Math.PI * lp), 2);

/**
 * Draw cells (analysis pixels, scaled by k to output pixels) into a painter of size W × H.
 * Scatter flings each cell away from home along its own direction and swirl, then back.
 */
export function drawCells(p, cells, cfg, W, H, k, lp, glyphs = []) {
  p.background(W, H, cfg.background);
  // Glyphs (sorted least to most ink) by tone: the further a cell is from the background's
  // lightness, the inkier its glyph. Without glyphs, glyph cells fall back to squares.
  const bg = parseInt(cfg.background.slice(1), 16);
  const lightBg = (0.2126 * (bg >> 16) + 0.7152 * ((bg >> 8) & 255) + 0.0722 * (bg & 255)) / 255 > 0.5;
  const env = scatterAt(cfg, lp);
  const S = Math.min(W, H);
  const sw = (cfg.stroke * S) / 1080;
  const order = env > 0.001 ? cells.slice().sort((a, b) => hash(a.id, 9) - hash(b.id, 9)) : cells;
  const alpha = env > 0.001 ? 1 - 0.25 * Math.min(1, env * 2) : 1;
  for (const c of order) {
    let cx = c.cx * k, cy = c.cy * k, sz = c.sz * k;
    if (env > 0.001) {
      const a = hash(c.id, 1) * Math.PI * 2 + env * (hash(c.id, 2) - 0.5) * 4;
      const d = env * (0.1 + 0.55 * hash(c.id, 3)) * S;
      cx += Math.cos(a) * d; cy += Math.sin(a) * d;
      sz *= 1 + env * (hash(c.id, 4) - 0.35) * 0.9;
    }
    const kind = cfg.shape === 'mixed' ? ['circle', 'square', 'rounded'][Math.floor(hash(c.id, 5) * 3)] : cfg.shape === 'glyph' && !glyphs.length ? 'square' : cfg.shape;
    if (kind === 'glyph') {
      const side = sz * (1 - cfg.gap), tone = lightBg ? 1 - c.l : c.l;
      if (side > 0.4) p.glyph(cx - side / 2, cy - side / 2, side, glyphs[Math.min(glyphs.length - 1, Math.floor(tone * glyphs.length))], c.color, alpha);
    } else if (kind === 'circle') {
      const r = (sz / 2) * cfg.fill;
      if (r > 0.2) p.circle(cx, cy, r, c.color, cfg.strokeColor, Math.min(sw, r * 0.5), alpha);
    } else {
      const side = sz * (1 - cfg.gap);
      if (side > 0.4) p.rect(cx - side / 2, cy - side / 2, side, side, kind === 'rounded' ? side * 0.28 : 0, c.color, cfg.strokeColor, Math.min(sw, side * 0.25), alpha);
    }
  }
}

/** A painter for a Canvas2D context. */
export function canvasPainter(ctx) {
  return {
    background(W, H, color) { ctx.globalAlpha = 1; ctx.fillStyle = color; ctx.fillRect(0, 0, W, H); },
    circle(x, y, r, fill, stroke, sw, alpha) {
      ctx.globalAlpha = alpha;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = fill; ctx.fill();
      if (sw > 0.05) { ctx.lineWidth = sw; ctx.strokeStyle = stroke; ctx.stroke(); }
    },
    rect(x, y, w, h, rad, fill, stroke, sw, alpha) {
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      if (rad > 0) ctx.roundRect(x, y, w, h, rad); else ctx.rect(x, y, w, h);
      ctx.fillStyle = fill; ctx.fill();
      if (sw > 0.05) { ctx.lineWidth = sw; ctx.strokeStyle = stroke; ctx.stroke(); }
    },
    // g.tint(color): the glyph's mask in that color (see the glyphs in live.js).
    glyph(x, y, s, g, fill, alpha) { ctx.globalAlpha = alpha; ctx.drawImage(g.tint(fill), x, y, s, s); },
  };
}

const f2 = v => +v.toFixed(2);
/** A painter that records SVG elements; toString() gives the document. */
export function svgPainter() {
  const parts = [], symbols = new Map();
  let head = '';
  const paint = (fill, stroke, sw, alpha) => `fill="${fill}"${sw > 0.05 ? ` stroke="${stroke}" stroke-width="${f2(sw)}"` : ''}${alpha < 1 ? ` opacity="${f2(alpha)}"` : ''}`;
  return {
    background(W, H, color) {
      head = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="${color}"/>`;
    },
    circle(x, y, r, fill, stroke, sw, alpha) { parts.push(`<circle cx="${f2(x)}" cy="${f2(y)}" r="${f2(r)}" ${paint(fill, stroke, sw, alpha)}/>`); },
    rect(x, y, w, h, rad, fill, stroke, sw, alpha) {
      parts.push(`<rect x="${f2(x)}" y="${f2(y)}" width="${f2(w)}" height="${f2(h)}"${rad > 0 ? ` rx="${f2(rad)}"` : ''} ${paint(fill, stroke, sw, alpha)}/>`);
    },
    // g.sym: the glyph's symbol id; g.symbol: its <symbol> markup, written once into <defs>.
    glyph(x, y, s, g, fill, alpha) {
      symbols.set(g.sym, g.symbol);
      parts.push(`<use href="#${g.sym}" x="${f2(x)}" y="${f2(y)}" width="${f2(s)}" height="${f2(s)}" color="${fill}"${alpha < 1 ? ` opacity="${f2(alpha)}"` : ''}/>`);
    },
    toString() { return head + (symbols.size ? `<defs>${[...symbols.values()].join('')}</defs>` : '') + parts.join('') + '</svg>'; },
  };
}
