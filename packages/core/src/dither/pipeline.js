// The DURANDAL processing pipeline, framework-free so it runs in a worker or Node:
//
//   RGBA → (saturation, sharpen, noise) → luminance → tone (brightness, contrast, midtones, highlights, shadows)
//        → blur → shrink to block size (nearest) → dither → invert
//
// The result is a 1-bit mask at block resolution; `paintMask` scales it back up
// with hard edges and paints it in any two colors.
//
// Palette mode (settings.mode = 'palette') runs the same steps on the R, G and B
// channels and returns palette indices instead; see ditherColor(). CMYK mode
// (settings.mode = 'cmyk') splits the color into four process inks, dithers each
// ink on its own with the style, and returns indices into the 16 ink overprints;
// see ditherCMYK().
import {STYLE_BY_ID, defaultParams} from './styles.js';
import {KERNELS} from './diffusion.js';
import {FIELDS, equalize, mulberry32} from './fields.js';
import {MAX_COLORS, paletteRGB, paletteField, paletteDiffuse, paletteScanlines, nearestColor} from './palette.js';
import {paletteOstromukhov} from './ostromukhov.js';

export const DEFAULT_SETTINGS = {
  style: 'floyd-steinberg',
  params: {},
  block: 4, // pixel size: the image is dithered at 1/block resolution
  threshold: 50, // percent, 0..100
  invert: false,
  brightness: 0, contrast: 0, midtones: 0, highlights: 0, shadows: 0, // -100..100
  blur: 0, // radius in source pixels
  mode: 'mono', // 'mono' (two tones), 'palette' or 'cmyk'
  colors: null, // palette mode: hex colors, 2..16
  strength: 100, // palette mode: how hard to dither, percent
  black: 100, // CMYK mode: how much of the shared gray goes to black ink, percent
  saturation: 0, // -100..100, palette and CMYK modes (two tones only see brightness)
  sharpen: 0, // 0..100, an unsharp mask about half a cell wide
  noise: 0, // 0..100, grain added to the source before dithering
};

const clamp255 = v => (v < 0 ? 0 : v > 255 ? 255 : v);
const inColor = s => s.mode === 'palette' || s.mode === 'cmyk';

/** True when saturation, sharpen or noise would change the source (the GPU path leaves these to the CPU). */
export const needsPrep = (s = {}) => !!(s.sharpen > 0 || s.noise > 0 || (s.saturation && inColor(s)));

/**
 * Saturation, sharpen and noise on the source RGBA, in that order, before anything
 * else sees it. Returns a new array, or rgba itself when they're all off.
 */
export function prepareRGBA(rgba, w, h, settings) {
  const s = {...DEFAULT_SETTINGS, ...settings};
  if (!needsPrep(s)) return rgba;
  const out = new Uint8ClampedArray(rgba), n = w * h;
  if (s.saturation && inColor(s)) {
    const k = 1 + s.saturation / 100;
    for (let p = 0; p < n * 4; p += 4) {
      const l = 0.299 * out[p] + 0.587 * out[p + 1] + 0.114 * out[p + 2];
      out[p] = l + (out[p] - l) * k; out[p + 1] = l + (out[p + 1] - l) * k; out[p + 2] = l + (out[p + 2] - l) * k;
    }
  }
  if (s.sharpen > 0) {
    // Unsharp mask at the scale of a cell, so it crisps what the dither will show.
    const r = Math.max(1, Math.round(Math.max(1, Math.floor(s.block)) / 2)), amount = (s.sharpen / 100) * 2;
    for (let c = 0; c < 3; c++) {
      const plane = new Float32Array(n);
      for (let i = 0; i < n; i++) plane[i] = out[i * 4 + c];
      const soft = blur(Float32Array.from(plane), w, h, r);
      for (let i = 0; i < n; i++) out[i * 4 + c] = plane[i] + (plane[i] - soft[i]) * amount;
    }
  }
  if (s.noise > 0) {
    const rand = mulberry32(1), amp = s.noise * 1.28; // the same grain every redraw
    for (let p = 0; p < n * 4; p += 4) {
      const d = (rand() * 2 - 1) * amp;
      out[p] += d; out[p + 1] += d; out[p + 2] += d;
    }
  }
  return out;
}

/** ITU-R 601 luma, rounded the same way Pillow's "L" conversion does. */
export function luminance(rgba, w, h) {
  const out = new Float32Array(w * h);
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    out[i] = (rgba[p] * 19595 + rgba[p + 1] * 38470 + rgba[p + 2] * 7471 + 0x8000) >> 16;
  }
  return out;
}

/** 256-entry lookup table for the tone sliders (each -100..100, 0 = no change). */
export function toneTable({brightness = 0, contrast = 0, midtones = 0, highlights = 0, shadows = 0} = {}) {
  const lut = new Float32Array(256);
  const gain = Math.pow(4, contrast / 100); // ×0.25 .. ×4 around mid-gray
  const gamma = Math.pow(2, -midtones / 50); // >0 lifts midtones, <0 sinks them
  for (let i = 0; i < 256; i++) {
    let v = i + brightness * 1.28;
    v = clamp255((v - 128) * gain + 128);
    v = 255 * Math.pow(v / 255, gamma);
    if (v > 128) { const t = (v - 128) / 127; v += highlights * 0.64 * t * t; }
    else { const t = (128 - v) / 128; v += shadows * 0.64 * t * t; }
    lut[i] = clamp255(v);
  }
  return lut;
}

const isIdentity = s => !s.brightness && !s.contrast && !s.midtones && !s.highlights && !s.shadows;

export function applyTone(buf, settings) {
  if (isIdentity(settings)) return buf;
  const lut = toneTable(settings);
  for (let i = 0; i < buf.length; i++) {
    const v = buf[i], lo = Math.floor(v), f = v - lo;
    buf[i] = lo >= 255 ? lut[255] : lut[lo] + (lut[lo + 1] - lut[lo]) * f;
  }
  return buf;
}

/** Three box-blur passes per axis: a cheap, close stand-in for a Gaussian. */
export function blur(buf, w, h, radius) {
  const r = Math.round(radius);
  if (r < 1) return buf;
  const tmp = new Float32Array(buf.length);
  const pass = (src, dst, len, count, stride, step) => {
    const norm = 1 / (2 * r + 1);
    for (let line = 0; line < count; line++) {
      const base = line * stride;
      const at = i => src[base + Math.min(len - 1, Math.max(0, i)) * step];
      let acc = 0;
      for (let i = -r; i <= r; i++) acc += at(i);
      for (let i = 0; i < len; i++) {
        dst[base + i * step] = acc * norm;
        acc += at(i + r + 1) - at(i - r);
      }
    }
  };
  for (let k = 0; k < 3; k++) {
    pass(buf, tmp, w, h, w, 1); // rows
    pass(tmp, buf, h, w, 1, w); // columns
  }
  return buf;
}

/** Nearest-neighbour resize, sampling pixel centres (matches Pillow's NEAREST). */
export function resizeNearest(src, sw, sh, dw, dh, Out = Float32Array) {
  const out = new Out(dw * dh);
  const xs = new Int32Array(dw);
  for (let x = 0; x < dw; x++) xs[x] = Math.min(sw - 1, Math.floor(((x + 0.5) * sw) / dw));
  for (let y = 0; y < dh; y++) {
    const row = Math.min(sh - 1, Math.floor(((y + 0.5) * sh) / dh)) * sw;
    for (let x = 0; x < dw; x++) out[y * dw + x] = src[row + xs[x]];
  }
  return out;
}

export const blockSize = (w, h, block) => {
  const f = Math.max(1, Math.floor(block));
  return {w: Math.max(1, Math.floor(w / f)), h: Math.max(1, Math.floor(h / f))};
};

/**
 * Dither a grayscale buffer (0..255) at block resolution.
 * Returns {mask: Uint8Array of 0/255, w, h} at the reduced size.
 */
export function ditherGray(gray, w, h, settings) {
  const s = {...DEFAULT_SETTINGS, ...settings};
  const style = STYLE_BY_ID[s.style];
  if (!style) throw new Error(`Unknown style "${s.style}"`);
  const params = {...defaultParams(style), ...s.params};

  let buf;
  const small = blockSize(w, h, s.block);
  if (s.blur > 0) {
    // Blur needs the full-size image; tone first so the blur sees the adjusted values.
    buf = blur(applyTone(Float32Array.from(gray), s), w, h, s.blur);
    buf = resizeNearest(buf, w, h, small.w, small.h);
  } else {
    // No blur: shrink first, so the tone pass only touches the small image.
    buf = applyTone(resizeNearest(gray, w, h, small.w, small.h), s);
  }

  style.run(buf, small.w, small.h, params, (s.threshold / 100) * 255);

  const mask = new Uint8Array(buf.length);
  for (let i = 0; i < buf.length; i++) mask[i] = (buf[i] >= 128) !== s.invert ? 255 : 0;
  return {mask, w: small.w, h: small.h};
}

/** The tone LUT for palette mode, applied to each channel. Invert is folded in (a negative). */
export function colorLut(settings) {
  const lut = isIdentity(settings) ? Float32Array.from({length: 256}, (_, i) => i) : toneTable(settings);
  if (settings.invert) for (let i = 0; i < 256; i++) lut[i] = 255 - lut[i];
  return lut;
}

/** For each cell of a dw×dh grid, the index of the source pixel resizeNearest would pick. */
export function sampleIndices(sw, sh, dw, dh) {
  const out = new Int32Array(dw * dh);
  for (let y = 0; y < dh; y++) {
    const row = Math.min(sh - 1, Math.floor(((y + 0.5) * sh) / dh)) * sw;
    for (let x = 0; x < dw; x++) out[y * dw + x] = row + Math.min(sw - 1, Math.floor(((x + 0.5) * sw) / dw));
  }
  return out;
}

export const paletteColors = s => (Array.isArray(s.colors) && s.colors.length >= 2 ? s.colors.slice(0, MAX_COLORS) : ['#000000', '#ffffff']);

/**
 * Palette pipeline from RGBA: per-channel tone → blur → shrink → color dither.
 * Returns {indices: Uint8Array, colors, w, h} at block resolution.
 */
/** R, G, B planes at block resolution, after per-channel tone (and invert) and blur. */
function colorPlanes(rgba, w, h, s) {
  const lut = colorLut(s);
  const small = blockSize(w, h, s.block);
  const pick = sampleIndices(w, h, small.w, small.h);
  const r = Math.round(s.blur);

  const planes = [0, 1, 2].map(c => {
    if (r >= 1) {
      const full = new Float32Array(w * h);
      for (let i = 0; i < full.length; i++) full[i] = lut[rgba[i * 4 + c]];
      blur(full, w, h, r);
      const out = new Float32Array(pick.length);
      for (let i = 0; i < pick.length; i++) out[i] = full[pick[i]];
      return out;
    }
    const out = new Float32Array(pick.length);
    for (let i = 0; i < pick.length; i++) out[i] = lut[rgba[pick[i] * 4 + c]];
    return out;
  });
  return {planes, small};
}

export function ditherColor(rgba, w, h, settings) {
  const s = {...DEFAULT_SETTINGS, ...settings};
  const style = STYLE_BY_ID[s.style];
  if (!style) throw new Error(`Unknown style "${s.style}"`);
  const params = {...defaultParams(style), ...s.params};
  const colors = paletteColors(s), pal = paletteRGB(colors);
  const {planes, small} = colorPlanes(rgba, w, h, s);

  const strength = Math.max(0, s.strength ?? 100) / 100;
  const [R, G, B] = planes;
  let indices;
  if (style.field) indices = paletteField(R, G, B, small.w, small.h, style.field(small.w, small.h, params), pal, strength);
  else if (style.id === 'ostromukhov') indices = paletteOstromukhov(R, G, B, small.w, small.h, pal, nearestColor, strength);
  else if (KERNELS[style.id]) indices = paletteDiffuse(R, G, B, small.w, small.h, KERNELS[style.id], pal, strength, !!params.serpentine);
  else indices = paletteScanlines(R, G, B, small.w, small.h, params.sigma ?? 2, pal, strength);
  return {indices, colors, w: small.w, h: small.h};
}

/* ---------- CMYK ---------- */

// Process inks (cyan, magenta, yellow, black) as they look printed on white paper.
export const INKS = [
  {id: 'c', name: 'Cyan', color: '#00aeef', angle: 15},
  {id: 'm', name: 'Magenta', color: '#ec008c', angle: 75},
  {id: 'y', name: 'Yellow', color: '#fff200', angle: 0},
  {id: 'k', name: 'Black', color: '#231f20', angle: 45},
];
// Screens without an angle are nudged apart instead, so the inks don't stack.
const INK_SHIFT = [[0, 0], [2, 1], [1, 3], [3, 2]];
const EVEN_FIELDS = new Set(['bayer', 'bittone', 'stipple', 'noise', 'crosshatch', 'diamonds']);

/**
 * The 16 colors overprinting the inks can make, indexed by ink bits
 * (1 cyan, 2 magenta, 4 yellow, 8 black): each ink multiplies the paper.
 */
export function inkColors(paper = '#ffffff') {
  const toHex = rgb => '#' + rgb.map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
  const paperRGB = hexRGB(paper), inks = INKS.map(i => hexRGB(i.color));
  return Array.from({length: 16}, (_, bits) => {
    const c = paperRGB.slice();
    inks.forEach((ink, i) => { if (bits & (1 << i)) for (let j = 0; j < 3; j++) c[j] = (c[j] * ink[j]) / 255; });
    return toHex(c);
  });
}

/**
 * Per-cell ink cutoffs for a screen style in CMYK, interleaved [c, m, y, k] per cell
 * as float32: an ink prints where its amount reaches the cutoff. Each ink's screen
 * is turned (angle), reseeded (noise) or nudged, then evened out over the frame so
 * the printed coverage matches the ink amount. 50% threshold = true coverage.
 */
export function cmykCutoffs(style, params, sw, sh, threshold) {
  const n = sw * sh, out = new Float32Array(n * 4), scale = threshold / 50;
  INKS.forEach((spec, i) => {
    const p = {...params};
    let shift = null;
    if ('angle' in p) p.angle = (p.angle ?? 0) + spec.angle;
    else if ('seed' in p) p.seed = (p.seed ?? 1) + 101 * i;
    else shift = INK_SHIFT[i];
    const f = FIELDS[style.id](sw, sh, p);
    const moved = shift ? (x, y) => f((x + shift[0]) % sw, (y + shift[1]) % sh) : f;
    const field = EVEN_FIELDS.has(style.id) ? moved : equalize(moved, sw, sh, 128);
    // Ink shows where 255·(1 − amount) ≤ field·scale, i.e. amount ≥ 1 − field·scale/255.
    for (let y = 0, q = 0; y < sh; y++) for (let x = 0; x < sw; x++, q++) out[q * 4 + i] = 1 - (field(x, y) * scale) / 255;
  });
  return out;
}

/**
 * Screen the inks: R, G, B planes (0..255) against cmykCutoffs. Every step is a
 * float32 add, subtract or multiply, with no division, so a GPU shader doing the
 * same steps gets the same bits. Bits: 1 cyan, 2 magenta, 4 yellow, 8 black.
 */
export function cmykScreen(R, G, B, cuts, black) {
  const f = Math.fround, gcr = f(Math.min(1, Math.max(0, black / 100))), n = R.length, out = new Uint8Array(n);
  for (let p = 0; p < n; p++) {
    const r = R[p], g = G[p], b = B[p];
    // Black takes `gcr` of the gray the three share; the colors split what's left.
    const K = f(f(255 - Math.max(r, g, b)) * gcr), rest = f(255 - K);
    const nc = f(f(255 - r) - K), nm = f(f(255 - g) - K), ny = f(f(255 - b) - K);
    const q = p * 4;
    let bits = 0;
    // amount = num / den ≥ cut  ⇔  num ≥ cut · den (den > 0); nothing asked, nothing printed.
    if (nc > 0 && nc >= f(cuts[q] * rest)) bits |= 1;
    if (nm > 0 && nm >= f(cuts[q + 1] * rest)) bits |= 2;
    if (ny > 0 && ny >= f(cuts[q + 2] * rest)) bits |= 4;
    if (K > 0 && K >= f(cuts[q + 3] * 255)) bits |= 8;
    out[p] = bits;
  }
  return out;
}

/**
 * CMYK pipeline from RGBA: per-channel tone → blur → shrink → split into inks →
 * dither each ink with the style. Screen styles go through cmykScreen (the GPU
 * path matches it); diffusion styles diffuse each ink as a gray image.
 * Returns {indices, colors, w, h} like ditherColor; colors are the 16 overprints.
 */
export function ditherCMYK(rgba, w, h, settings) {
  const s = {...DEFAULT_SETTINGS, ...settings};
  const style = STYLE_BY_ID[s.style];
  if (!style) throw new Error(`Unknown style "${s.style}"`);
  const params = {...defaultParams(style), ...s.params};
  const {planes: [R, G, B], small} = colorPlanes(rgba, w, h, s);
  const sw = small.w, sh = small.h, n = R.length;
  if (style.field) {
    const indices = cmykScreen(R, G, B, cmykCutoffs(style, params, sw, sh, s.threshold), s.black ?? 100);
    return {indices, colors: inkColors(), w: sw, h: sh};
  }
  const gcr = Math.min(1, Math.max(0, (s.black ?? 100) / 100));
  // Ink amounts 0..1 per cell; black takes `gcr` of the gray all three share.
  const ink = INKS.map(() => new Float32Array(n));
  for (let i = 0; i < n; i++) {
    const r = R[i] / 255, g = G[i] / 255, b = B[i] / 255;
    const k = (1 - Math.max(r, g, b)) * gcr, rest = 1 - k;
    ink[3][i] = k;
    ink[0][i] = rest > 0 ? Math.max(0, (1 - r - k) / rest) : 0;
    ink[1][i] = rest > 0 ? Math.max(0, (1 - g - k) / rest) : 0;
    ink[2][i] = rest > 0 ? Math.max(0, (1 - b - k) / rest) : 0;
  }
  const t = (s.threshold / 100) * 255, indices = new Uint8Array(n);
  INKS.forEach((spec, i) => {
    // The style sees each ink as a gray image: paper is white, full ink is black.
    const buf = new Float32Array(n), amount = ink[i];
    for (let p = 0; p < n; p++) buf[p] = 255 * (1 - amount[p]);
    style.run(buf, sw, sh, params, t);
    const bit = 1 << i;
    for (let p = 0; p < n; p++) if (buf[p] < 128 && amount[p] > 0) indices[p] |= bit;
  });
  return {indices, colors: inkColors(), w: sw, h: sh};
}

/** Full pipeline from RGBA pixels (e.g. ImageData.data), in any mode. */
export function ditherRGBA(rgba, w, h, settings) {
  rgba = prepareRGBA(rgba, w, h, settings);
  return settings && settings.mode === 'palette' ? ditherColor(rgba, w, h, settings)
    : settings && settings.mode === 'cmyk' ? ditherCMYK(rgba, w, h, settings)
    : ditherGray(luminance(rgba, w, h), w, h, settings);
}

const hexRGB = hex => {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/**
 * Paint a mask into RGBA at (outW, outH), with hard nearest-neighbour edges.
 * ink colors the 0 pixels, paper the 255 pixels.
 */
export function paintMask(mask, mw, mh, outW, outH, ink = '#000000', paper = '#ffffff') {
  const big = outW === mw && outH === mh ? mask : resizeNearest(mask, mw, mh, outW, outH, Uint8Array);
  const [ir, ig, ib] = hexRGB(ink), [pr, pg, pb] = hexRGB(paper);
  const out = new Uint8ClampedArray(outW * outH * 4);
  for (let i = 0, p = 0; i < big.length; i++, p += 4) {
    const on = big[i] !== 0;
    out[p] = on ? pr : ir; out[p + 1] = on ? pg : ig; out[p + 2] = on ? pb : ib; out[p + 3] = 255;
  }
  return out;
}
