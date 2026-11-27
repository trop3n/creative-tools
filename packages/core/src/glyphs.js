// GLYF's glyph set, shared with the suite. GLYF publishes the glyphs in its set as SVG
// markup in a 100 × 100 box (filled with currentColor); other tools draw them as cells
// or shapes, as pictures (rasterGlyphs, tintGlyph) or in their SVG files (glyphSymbol).
import {readJSON, writeJSON} from './storage.js';

const KEY = 'studio.shared.glyphs.v1', MAX_GLYPHS = 64, MAX_MARKUP = 200000;
const listeners = new Set();

/** GLYF calls this when its set changes: [{id, name, svg}]. */
export function publishGlyphs(glyphs) {
  const list = (glyphs || []).slice(0, MAX_GLYPHS).map(g => ({id: String(g.id), name: String(g.name || 'Glyph'), svg: String(g.svg || '')}));
  writeJSON(KEY, {at: Date.now(), glyphs: list});
  listeners.forEach(f => f());
}

/** GLYF's current set: [{id, name, svg}] (empty until GLYF has been opened once). */
export function suiteGlyphs() {
  const v = readJSON(KEY, null);
  return v && Array.isArray(v.glyphs) ? v.glyphs.filter(g => g && typeof g.svg === 'string' && g.svg && g.svg.length < MAX_MARKUP) : [];
}

/** Call fn() when the shared set changes, here or in another tab. Returns a stop function. */
export function watchGlyphs(fn) {
  const onStorage = e => { if (e.key === KEY || e.key === null) fn(); };
  if (typeof window !== 'undefined') window.addEventListener('storage', onStorage);
  listeners.add(fn);
  return () => { if (typeof window !== 'undefined') window.removeEventListener('storage', onStorage); listeners.delete(fn); };
}

/** A glyph as a standalone SVG document of `size` pixels in one color. */
export const glyphDocument = (g, size = 100, color = '#000000') =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="${size}" height="${size}" color="${color}">${g.svg}</svg>`;

/** A <symbol> for a tool's SVG export; draw it with <use href="#id" … color="…"/>. */
export const glyphSymbol = (g, id) => `<symbol id="${id}" viewBox="0 0 100 100" overflow="visible">${g.svg}</symbol>`;

const rasterCache = new Map();
/**
 * Draw glyphs as masks (black ink on clear, size × size) and measure their ink (0..1).
 * Resolves to [{id, name, svg, mask, ink}] in the same order; a glyph that fails to draw
 * gets mask null and ink 0.
 */
export function rasterGlyphs(glyphs, size = 128) {
  return Promise.all((glyphs || []).map(g => {
    const key = size + '|' + g.svg;
    if (!rasterCache.has(key)) {
      rasterCache.set(key, new Promise(resolve => {
        const img = new Image();
        img.onload = () => {
          const c = document.createElement('canvas');
          c.width = c.height = size;
          const x = c.getContext('2d', {willReadFrequently: true});
          x.drawImage(img, 0, 0, size, size);
          const d = x.getImageData(0, 0, size, size).data;
          let a = 0;
          for (let i = 3; i < d.length; i += 4) a += d[i];
          resolve({mask: c, ink: a / (255 * size * size)});
        };
        img.onerror = () => resolve({mask: null, ink: 0});
        img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(glyphDocument(g, size));
      }));
    }
    return rasterCache.get(key).then(r => ({...g, ...r}));
  }));
}

const tints = new WeakMap();
/** A glyph mask painted in one color (cached per mask and color), ready to drawImage. */
export function tintGlyph(mask, color) {
  let byColor = tints.get(mask);
  if (!byColor) tints.set(mask, (byColor = new Map()));
  let c = byColor.get(color);
  if (!c) {
    c = document.createElement('canvas');
    c.width = mask.width; c.height = mask.height;
    const x = c.getContext('2d');
    x.drawImage(mask, 0, 0);
    x.globalCompositeOperation = 'source-in';
    x.fillStyle = color;
    x.fillRect(0, 0, c.width, c.height);
    byColor.set(color, c);
  }
  return c;
}

/** Glyphs sorted from least to most ink (for picking one by tone). */
export const byInk = rastered => rastered.filter(g => g.mask).sort((a, b) => a.ink - b.ink);
