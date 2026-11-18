// The DURANDAL processing pipeline, framework-free so it runs in a worker or Node:
//
//   RGBA → luminance → tone (brightness, contrast, midtones, highlights, shadows)
//        → blur → shrink to block size (nearest) → dither → invert
//
// The result is a 1-bit mask at block resolution; `paintMask` scales it back up
// with hard edges and paints it in any two colors.
import {STYLE_BY_ID, defaultParams} from './styles.js';

export const DEFAULT_SETTINGS = {
  style: 'floyd-steinberg',
  params: {},
  block: 4, // pixel size: the image is dithered at 1/block resolution
  threshold: 50, // percent, 0..100
  invert: false,
  brightness: 0, contrast: 0, midtones: 0, highlights: 0, shadows: 0, // -100..100
  blur: 0, // radius in source pixels
};

const clamp255 = v => (v < 0 ? 0 : v > 255 ? 255 : v);

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

/** Full pipeline from RGBA pixels (e.g. ImageData.data). */
export const ditherRGBA = (rgba, w, h, settings) => ditherGray(luminance(rgba, w, h), w, h, settings);

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
