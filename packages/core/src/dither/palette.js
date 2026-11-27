// Color palette dithering. Instead of two tones, every cell becomes the nearest of
// up to 16 palette colors (plain RGB distance), and the rounding error is pushed on
// per channel (diffusion styles) or the pixel is nudged by the pattern before the
// nearest-color pick (pattern styles: ordered dithering).
import {gaussian1d} from './diffusion.js';

export const MAX_COLORS = 16;

export const PALETTES = [
  {id: 'brand', name: 'Brand', colors: ['#242222', '#00304e', '#4c3046', '#505050', '#90a344', '#c99530', '#dfdfdf', '#ffffff']},
  {id: 'gray4', name: 'Gray, 4 levels', colors: ['#000000', '#555555', '#aaaaaa', '#ffffff']},
  {id: 'gray8', name: 'Gray, 8 levels', colors: ['#000000', '#242424', '#494949', '#6d6d6d', '#929292', '#b6b6b6', '#dbdbdb', '#ffffff']},
  {id: 'print', name: 'Process print', colors: ['#000000', '#00a0e4', '#e5007e', '#ffed00', '#ffffff']},
  {id: 'primaries', name: 'RGB corners', colors: ['#000000', '#ff0000', '#00ff00', '#0000ff', '#00ffff', '#ff00ff', '#ffff00', '#ffffff']},
  {id: 'olive', name: 'Olive LCD', colors: ['#1d2b12', '#3f5a1f', '#8a9a3b', '#c6d08a']},
  {id: 'sepia', name: 'Sepia', colors: ['#2b1d14', '#6b4a32', '#b08a62', '#ecdcc0']},
  {id: 'dusk', name: 'Plum and gold', colors: ['#1b1420', '#4c3046', '#8c5a6e', '#c99530', '#f2e3c0']},
];
export const PALETTE_BY_ID = Object.fromEntries(PALETTES.map(p => [p.id, p]));

export const hexToRGB = hex => {
  const n = parseInt(String(hex).replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
export const rgbToHex = ([r, g, b]) => '#' + [r, g, b].map(v => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('');

/** Palette as a flat Float32Array [r0, g0, b0, r1, …]. */
/**
 * Colors from a palette file: GIMP .gpl ("R G B name" lines), or any text holding
 * rrggbb codes, with or without # (Lospec .hex, a list, JSON). In order, repeats
 * dropped, at most MAX_COLORS.
 */
export function parsePalette(text) {
  const out = [], src = String(text || '');
  const add = hex => { hex = hex.toLowerCase(); if (!out.includes(hex)) out.push(hex); };
  if (/^\s*GIMP Palette/i.test(src)) {
    for (const line of src.split(/\r?\n/)) {
      const m = /^\s*(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})(\s|$)/.exec(line);
      if (m) add(rgbToHex([+m[1], +m[2], +m[3]]));
    }
  } else for (const m of src.matchAll(/(?:^|[^0-9a-z])#?([0-9a-f]{6})(?![0-9a-z])/gi)) add('#' + m[1]);
  return out.slice(0, MAX_COLORS);
}

/** A palette as a Lospec-style .hex file: one rrggbb per line. */
export const paletteHexFile = colors => colors.map(c => c.replace('#', '').toLowerCase()).join('\n') + '\n';

export const paletteRGB = colors => Float32Array.from(colors.slice(0, MAX_COLORS).flatMap(hexToRGB));

/** Index of the palette color nearest to (r, g, b). Ties go to the earlier color. */
export function nearestColor(pal, r, g, b) {
  let best = 0, bestD = Infinity;
  for (let i = 0, p = 0; p < pal.length; i++, p += 3) {
    const dr = r - pal[p], dg = g - pal[p + 1], db = b - pal[p + 2];
    const d = dr * dr + dg * dg + db * db;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

/**
 * How far apart the palette's colors sit, per channel: the mean distance from each
 * color to its nearest neighbour, over √3. Ordered dithering nudges pixels by up to
 * about this much, so the pattern spans one step between neighbouring colors.
 */
export function paletteSpread(pal) {
  const n = pal.length / 3;
  if (n < 2) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    let best = Infinity;
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const dr = pal[i * 3] - pal[j * 3], dg = pal[i * 3 + 1] - pal[j * 3 + 1], db = pal[i * 3 + 2] - pal[j * 3 + 2];
      best = Math.min(best, Math.sqrt(dr * dr + dg * dg + db * db));
    }
    sum += best;
  }
  return sum / n / Math.sqrt(3);
}

/**
 * Per-pixel offsets for ordered dithering: (field / 255 − ½) × amount, as float32.
 * The GPU path uploads exactly these values, so both engines add the same nudge.
 */
export function fieldOffsets(field, w, h, amount) {
  const out = new Float32Array(w * h);
  for (let y = 0, p = 0; y < h; y++) for (let x = 0; x < w; x++, p++) out[p] = (field(x, y) / 255 - 0.5) * amount;
  return out;
}

const clamp255 = v => (v < 0 ? 0 : v > 255 ? 255 : v);

/** Ordered dithering of three channel planes against a field. Returns palette indices. */
export function paletteField(R, G, B, w, h, field, pal, strength = 1) {
  const off = fieldOffsets(field, w, h, paletteSpread(pal) * strength);
  const out = new Uint8Array(w * h);
  const f = Math.fround;
  // Float32 adds, as on the GPU.
  for (let i = 0; i < out.length; i++) out[i] = nearestColor(pal, f(R[i] + off[i]), f(G[i] + off[i]), f(B[i] + off[i]));
  return out;
}

/** Error diffusion in color: each channel's error goes to the same neighbours. */
export function paletteDiffuse(R, G, B, w, h, kernel, pal, strength = 1, serpentine = false) {
  const n = kernel.length;
  const dys = kernel.map(t => t[0]), dxs = kernel.map(t => t[1]), wts = kernel.map(t => t[2] * strength);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const flip = serpentine && (y & 1) === 1;
    const dir = flip ? -1 : 1;
    for (let i = 0, x = flip ? w - 1 : 0; i < w; i++, x += dir) {
      const p = y * w + x;
      const k = nearestColor(pal, R[p], G[p], B[p]);
      out[p] = k;
      const er = R[p] - pal[k * 3], eg = G[p] - pal[k * 3 + 1], eb = B[p] - pal[k * 3 + 2];
      if (!er && !eg && !eb) continue;
      for (let t = 0; t < n; t++) {
        const ny = y + dys[t], nx = x + dxs[t] * dir;
        if (ny >= h || nx < 0 || nx >= w) continue;
        const q = ny * w + nx, wt = wts[t];
        R[q] = clamp255(R[q] + er * wt); G[q] = clamp255(G[q] + eg * wt); B[q] = clamp255(B[q] + eb * wt);
      }
    }
  }
  return out;
}

/** Scanline diffusion in color: error only runs forward along each row. */
export function paletteScanlines(R, G, B, w, h, sigma, pal, strength = 1) {
  const {kernel, radius} = gaussian1d(sigma);
  const taps = kernel.slice(radius + 1);
  const total = taps.reduce((a, b) => a + b, 0);
  if (total > 0) for (let i = 0; i < taps.length; i++) taps[i] = (taps[i] / total) * strength;
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const p = row + x, k = nearestColor(pal, R[p], G[p], B[p]);
      out[p] = k;
      const er = R[p] - pal[k * 3], eg = G[p] - pal[k * 3 + 1], eb = B[p] - pal[k * 3 + 2];
      for (let i = 0; i < taps.length && x + 1 + i < w; i++) {
        const q = p + 1 + i, wt = taps[i];
        R[q] = clamp255(R[q] + er * wt); G[q] = clamp255(G[q] + eg * wt); B[q] = clamp255(B[q] + eb * wt);
      }
    }
  }
  return out;
}

/**
 * Pick n colors that represent an image (median cut, cutting at the least-variance point). Samples at most ~16k pixels.
 * Returns hex colors, darkest first.
 */
export function adaptivePalette(rgba, w, h, n = 6) {
  n = Math.max(2, Math.min(MAX_COLORS, Math.round(n)));
  const total = w * h, step = Math.max(1, Math.floor(total / 16384));
  const px = [];
  for (let i = 0; i < total; i += step) px.push([rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]]);
  const range = box => {
    let best = 0, ch = 0;
    for (let c = 0; c < 3; c++) {
      let lo = 255, hi = 0;
      for (const p of box) { if (p[c] < lo) lo = p[c]; if (p[c] > hi) hi = p[c]; }
      if (hi - lo > best) { best = hi - lo; ch = c; }
    }
    return {span: best, ch};
  };
  let boxes = [px];
  while (boxes.length < n) {
    // Split the box with the most spread × pixels.
    let pick = -1, score = 0, ch = 0;
    boxes.forEach((b, i) => { if (b.length < 2) return; const r = range(b); const s = r.span * Math.sqrt(b.length); if (s > score) { score = s; pick = i; ch = r.ch; } });
    if (pick < 0) break;
    // Cut where the two halves have the least total variance along that channel,
    // so clusters of different sizes come apart cleanly.
    const b = boxes[pick].sort((p, q) => p[ch] - q[ch]);
    const len = b.length, pre = new Float64Array(len + 1), pre2 = new Float64Array(len + 1);
    for (let i = 0; i < len; i++) { const v = b[i][ch]; pre[i + 1] = pre[i] + v; pre2[i + 1] = pre2[i] + v * v; }
    const sse = (i, j) => pre2[j] - pre2[i] - ((pre[j] - pre[i]) ** 2) / (j - i);
    let cut = len >> 1, bestE = Infinity;
    for (let i = 1; i < len; i++) {
      if (b[i][ch] === b[i - 1][ch]) continue;
      const e = sse(0, i) + sse(i, len);
      if (e < bestE) { bestE = e; cut = i; }
    }
    boxes.splice(pick, 1, b.slice(0, cut), b.slice(cut));
  }
  const colors = boxes.filter(b => b.length).map(b => {
    const s = [0, 0, 0];
    for (const p of b) { s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; }
    return s.map(v => v / b.length);
  });
  colors.sort((a, b) => (a[0] * 299 + a[1] * 587 + a[2] * 114) - (b[0] * 299 + b[1] * 587 + b[2] * 114));
  return colors.map(rgbToHex);
}

/**
 * Paint palette indices into RGBA at (outW, outH), with hard nearest-neighbour edges.
 */
export function paintIndices(indices, mw, mh, outW, outH, colors) {
  const rgb = colors.map(hexToRGB);
  const out = new Uint8ClampedArray(outW * outH * 4);
  const xs = new Int32Array(outW);
  for (let x = 0; x < outW; x++) xs[x] = Math.min(mw - 1, Math.floor(((x + 0.5) * mw) / outW));
  for (let y = 0, p = 0; y < outH; y++) {
    const row = Math.min(mh - 1, Math.floor(((y + 0.5) * mh) / outH)) * mw;
    for (let x = 0; x < outW; x++, p += 4) {
      const c = rgb[indices[row + xs[x]]] || rgb[0];
      out[p] = c[0]; out[p + 1] = c[1]; out[p + 2] = c[2]; out[p + 3] = 255;
    }
  }
  return out;
}
