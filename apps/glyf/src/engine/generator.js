// Generator: rasterize glyphs, measure their ink, map source tones onto them.
import {S, emit, saveGen, setLibListener, toast, saveFile} from './store.js';
import {copyText} from '@studio/core';
import {FRAME_RATIOS, cropRect, fixedSize, frameRatio} from '@studio/core/frames';
import {glyphSVG, shapeInner, n2, slug} from './shapes.js';
import {media, refreshPattern} from './media.js';
import {GRID, inkOf, candidates, matchCells} from './match.js';

const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export {mk};

let outCv = null, layerCv = null, last = null, tok = 0, queued = false;
export const setOutCanvas = c => { outCv = c; schedule(); };
export const getOutCanvas = () => outCv;
export const isBusy = () => media.exporting;

const rasterCache = new Map();
function rasterGlyph(shape) {
  const key = JSON.stringify(shape.els);
  if (rasterCache.has(key)) return rasterCache.get(key);
  const p = new Promise(res => {
    const img = new Image(), SZ = 256;
    img.onload = () => {
      const c = mk(SZ, SZ), x = c.getContext('2d', {willReadFrequently: true});
      x.drawImage(img, 0, 0, SZ, SZ);
      const d = x.getImageData(0, 0, SZ, SZ).data;
      let a = 0; for (let i = 3; i < d.length; i += 4) a += d[i];
      res({cv: c, cov: a / (255 * SZ * SZ)});
    };
    img.onerror = () => res({cv: null, cov: 0});
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(glyphSVG(shape, SZ));
  });
  rasterCache.set(key, p);
  return p;
}

/** A glyph's ink as a GRID × GRID patch, drawn at its size in the cell (the gap around it). */
const patchCache = new WeakMap();
function glyphPatch(cv, gap) {
  const hit = patchCache.get(cv);
  if (hit && hit.gap === gap) return hit.patch;
  const SZ = 64, b = SZ / GRID, c = mk(SZ, SZ), x = c.getContext('2d', {willReadFrequently: true}), s = SZ * (1 - gap), o = (SZ - s) / 2;
  x.drawImage(cv, o, o, s, s);
  const d = x.getImageData(0, 0, SZ, SZ).data, patch = new Float32Array(GRID * GRID);
  for (let y = 0; y < SZ; y++) for (let X = 0; X < SZ; X++) patch[((y / b) | 0) * GRID + ((X / b) | 0)] += d[(y * SZ + X) * 4 + 3] / 255 / (b * b);
  patchCache.set(cv, {gap, patch});
  return patch;
}

function sampleGrid(src, cols, rows, crop) {
  let c = src, w = src.width, h = src.height;
  if (crop.w !== w || crop.h !== h) {
    // Frame: keep the middle of the source, at its own resolution.
    w = Math.max(1, Math.round(crop.w)); h = Math.max(1, Math.round(crop.h));
    c = mk(w, h); c.getContext('2d').drawImage(src, crop.x, crop.y, crop.w, crop.h, 0, 0, w, h);
  }
  while (w > cols * 4 && h > rows * 4) {
    const nw = Math.max(cols, w >> 1), nh = Math.max(rows, h >> 1), t = mk(nw, nh), tx = t.getContext('2d');
    tx.imageSmoothingQuality = 'high'; tx.drawImage(c, 0, 0, nw, nh); c = t; w = nw; h = nh;
  }
  const t = mk(cols, rows), x = t.getContext('2d', {willReadFrequently: true});
  x.imageSmoothingQuality = 'high'; x.drawImage(c, 0, 0, cols, rows);
  return x.getImageData(0, 0, cols, rows).data;
}
function hash(x, y, s) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(s, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}
function quantize(val, cols, rows, lv, method) {
  const n = lv.length, out = new Uint8Array(cols * rows);
  const near = v => { let b = 0, bd = 9; for (let k = 0; k < n; k++) { const d = Math.abs(v - lv[k]); if (d < bd) { bd = d; b = k; } } return b; };
  if (method === 'none' || method === 'bayer') {
    const B = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5], step = n > 1 ? 1 / (n - 1) : 1;
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const i = y * cols + x; let v = val[i];
      if (method === 'bayer') v += ((B[(y & 3) * 4 + (x & 3)] + 0.5) / 16 - 0.5) * step;
      out[i] = near(v);
    }
    return out;
  }
  const buf = Float32Array.from(val);
  const add = (x, y, e) => { if (x >= 0 && x < cols && y < rows) buf[y * cols + x] += e; };
  for (let y = 0; y < rows; y++) {
    const rev = method === 'fs' && y & 1, dir = rev ? -1 : 1;
    for (let k = 0; k < cols; k++) {
      const x = rev ? cols - 1 - k : k, i = y * cols + x, q = near(buf[i]), err = buf[i] - lv[q];
      out[i] = q;
      if (method === 'fs') { add(x + dir, y, (err * 7) / 16); add(x - dir, y + 1, (err * 3) / 16); add(x, y + 1, (err * 5) / 16); add(x + dir, y + 1, err / 16); }
      else { const e8 = err / 8; add(x + 1, y, e8); add(x + 2, y, e8); add(x - 1, y + 1, e8); add(x, y + 1, e8); add(x + 1, y + 1, e8); add(x, y + 2, e8); }
    }
  }
  return out;
}

/**
 * Each cell's colour in the Palette mode: the palette colour nearest the source's
 * (match 'nearest'), or the one at the cell's tone, lightest ink first ('tone').
 * Returns RGBA, one pixel per cell.
 */
function paletteColors(px, val, N, g) {
  const pal = (g.palette.length ? g.palette : ['#000000']).map(h => [1, 3, 5].map(k => parseInt(h.slice(k, k + 2), 16) || 0)), n = pal.length;
  const out = new Uint8ClampedArray(N * 4);
  for (let i = 0; i < N; i++) {
    let b = 0;
    if (g.match === 'tone') b = Math.min(n - 1, Math.floor(val[i] * n));
    else {
      let bd = Infinity;
      const r = px[i * 4], gg = px[i * 4 + 1], bl = px[i * 4 + 2];
      for (let k = 0; k < n; k++) {
        // Weighted RGB distance ("redmean"): close enough to how different colours look.
        const dr = r - pal[k][0], dg = gg - pal[k][1], db = bl - pal[k][2], rm = (r + pal[k][0]) / 2;
        const d = (2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db;
        if (d < bd) { bd = d; b = k; }
      }
    }
    out[i * 4] = pal[b][0]; out[i * 4 + 1] = pal[b][1]; out[i * 4 + 2] = pal[b][2]; out[i * 4 + 3] = 255;
  }
  return out;
}

export function schedule() {
  if (S.view !== 'gen' || queued || media.exporting) return;
  queued = true;
  requestAnimationFrame(() => { queued = false; render(); });
}
setLibListener(schedule);
/** Change a generator setting, persist it and re-render. */
export function setGen(k, v) { S.gen[k] = v; saveGen(); emit(); schedule(); }

let rampKey = '';
export async function render(quiet) {
  refreshPattern(); // a pattern source redraws itself when its settings or the frame change
  const my = ++tok, set = S.lib.shapes.filter(s => s.inSet), src = media.src;
  const rs = await Promise.all(set.map(rasterGlyph));
  if (my !== tok) return;
  set.forEach((s, i) => (S.cov[s.id] = rs[i].cov));
  const glyphs = set.map((s, i) => ({s, cv: rs[i].cv, cov: rs[i].cov})).filter(g => g.cv && g.cov > 0.002).sort((a, b) => a.cov - b.cov);
  const rk = glyphs.map(g => g.s.id + ':' + g.cov).join();
  if (rk !== rampKey) { rampKey = rk; S.ramp = glyphs.map(g => ({id: g.s.id, cov: g.cov})); quiet = false; }
  if (!outCv || !glyphs.length || !src) { last = null; S.stats = ''; emit(); return; }

  const g = S.gen, m = glyphs.length, cols = g.cols;
  const custom = [g.customW, g.customH];
  const crop = cropRect(src.width, src.height, frameRatio(g.frame, FRAME_RATIOS, custom) || 0), fixed = fixedSize(g.frame, custom);
  const rows = Math.max(1, Math.round((cols * crop.h) / crop.w));
  const px = sampleGrid(src, cols, rows, crop), N = cols * rows, val = new Float32Array(N);
  const toneOpts = {tone: g.tone, contrast: g.contrast, bright: g.bright, gamma: g.gamma, invert: g.invert};
  for (let i = 0; i < N; i++) val[i] = inkOf(px[i * 4], px[i * 4 + 1], px[i * 4 + 2], toneOpts);
  const maxC = glyphs[m - 1].cov;
  const lv = glyphs.map((gl, i) => ({gl, v: g.steps === 'even' ? (g.blank ? (i + 1) / m : m > 1 ? i / (m - 1) : 1) : gl.cov / maxC}));
  if (g.blank) lv.unshift({gl: null, v: 0});
  else if (g.steps !== 'even' && m > 1) { const lo = lv[0].v; lv.forEach(l => (l.v = (l.v - lo) / (1 - lo || 1))); }
  const size = g.mode === 'size';
  const rotAt = (x, y) => (g.rot === 'random' ? hash(x, y, g.seed * 2 + 1) % 4 : g.rot === 'checker' ? (x + y) & 1 : 0);
  // Detail and Fit read each cell as a patch and match glyph shapes (match.js); otherwise
  // each cell's tone picks the glyph with the nearest ink, as before.
  const shaped = !size && g.pick !== 'mixed' && (g.detail > 0 || g.rot === 'fit');
  let chosen = null, idx = null;
  if (shaped) {
    const sub = sampleGrid(src, cols * GRID, rows * GRID, crop), ink = new Float32Array(sub.length / 4);
    for (let j = 0; j < ink.length; j++) ink[j] = inkOf(sub[j * 4], sub[j * 4 + 1], sub[j * 4 + 2], toneOpts);
    const levelOf = new Map(lv.filter(l => l.gl).map(l => [l.gl, l.v]));
    const base = glyphs.map(gl => ({gl, level: levelOf.get(gl), patch: glyphPatch(gl.cv, g.gap)}));
    if (g.rot === 'fit') { const all = candidates(base, [0, 1, 2, 3], g.blank); chosen = matchCells(ink, cols, rows, () => all, g.detail, g.dither); }
    else {
      const byRot = [0, 1, 2, 3].map(r => candidates(base, [r], g.blank));
      chosen = matchCells(ink, cols, rows, (x, y) => byRot[rotAt(x, y)], g.detail, g.dither);
    }
  } else if (!size) idx = quantize(val, cols, rows, lv.map(l => l.v), g.dither);

  const moving = media.kind === 'video' || media.kind === 'camera' || media.kind === 'ribbons';
  const cell = Math.max(4, Math.min(40, Math.floor((moving ? 1920 : 2400) / Math.max(cols, rows))));
  // A fixed frame (the LED wall) draws at exactly its size; cells then aren't whole pixels.
  const W = fixed ? fixed[0] : cols * cell, H = fixed ? fixed[1] : rows * cell, cw = W / cols, ch = H / rows;
  if (outCv.width !== W || outCv.height !== H) { outCv.width = W; outCv.height = H; }
  if (!layerCv || layerCv.width !== W || layerCv.height !== H) layerCv = mk(W, H);
  const lx = layerCv.getContext('2d');
  lx.setTransform(1, 0, 0, 1, 0, 0); lx.globalCompositeOperation = 'source-over'; lx.clearRect(0, 0, W, H); lx.imageSmoothingQuality = 'high';
  const marks = [], gi = new Map(glyphs.map((gl, i) => [gl, i]));
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const i = y * cols + x; let gl, sc = 1;
    if (size) { const v = val[i]; if (v < 0.03) continue; gl = glyphs[m > 1 ? hash(x, y, g.seed) % m : 0]; sc = Math.sqrt(v); }
    else if (chosen) { gl = chosen[i].gl; if (!gl) continue; }
    else {
      gl = lv[idx[i]].gl; if (!gl) continue;
      // Mixed: tone only decides whether a cell is marked; which glyph is fixed per cell.
      if (g.pick === 'mixed' && m > 1) gl = glyphs[hash(x, y, g.seed + 101) % m];
    }
    const rot = chosen ? chosen[i].rot : rotAt(x, y);
    const s = Math.min(cw, ch) * (1 - g.gap) * sc, cx = x * cw + cw / 2, cy = y * ch + ch / 2;
    lx.setTransform(1, 0, 0, 1, cx, cy); if (rot) lx.rotate((rot * Math.PI) / 2);
    lx.drawImage(gl.cv, -s / 2, -s / 2, s, s);
    marks.push([x, y, gi.get(gl), sc, rot]);
  }
  lx.setTransform(1, 0, 0, 1, 0, 0); lx.globalCompositeOperation = 'source-in';
  const cellCol = g.color === 'source' ? px : g.color === 'palette' ? paletteColors(px, val, N, g) : null;
  if (cellCol) {
    const cc = mk(cols, rows);
    cc.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(cellCol), cols, rows), 0, 0);
    lx.imageSmoothingEnabled = false; lx.drawImage(cc, 0, 0, W, H); lx.imageSmoothingEnabled = true;
  } else { lx.fillStyle = g.ink; lx.fillRect(0, 0, W, H); }
  lx.globalCompositeOperation = 'source-over';
  const ox = outCv.getContext('2d');
  ox.fillStyle = g.paper; ox.fillRect(0, 0, W, H); ox.drawImage(layerCv, 0, 0);
  last = {cols, rows, glyphs, marks, cellCol, fixed};
  const stats = `${cols} × ${rows} cells · ${marks.length.toLocaleString()} marks · ${m} glyph${m > 1 ? 's' : ''}`;
  if (!quiet || stats !== S.stats) { S.stats = stats; emit(); }
}

const hex = (r, g, b) => '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
export function buildSVG() {
  if (!last) return null;
  const {cols, rows, glyphs, marks, cellCol: px, fixed} = last, g = S.gen, cs = 10, W = cols * cs, H = rows * cs, used = new Set(marks.map(m => m[2]));
  const [outW, outH] = fixed || [W, H]; // the LED wall: same drawing, sized to the wall
  const defs = glyphs.map((gl, i) => (used.has(i) ? `<symbol id="g${i}" viewBox="0 0 100 100" overflow="visible">${shapeInner(gl.s, 'g' + i)}</symbol>` : '')).join('');
  const body = marks.map(([x, y, i, sc, rot]) => {
    const s = cs * (1 - g.gap) * sc, cx = x * cs + cs / 2, cy = y * cs + cs / 2, p = (y * cols + x) * 4;
    return `<use xlink:href="#g${i}" x="${n2(cx - s / 2)}" y="${n2(cy - s / 2)}" width="${n2(s)}" height="${n2(s)}"${rot ? ` transform="rotate(${rot * 90} ${cx} ${cy})"` : ''}${px ? ` color="${hex(px[p], px[p + 1], px[p + 2])}"` : ''}/>`;
  }).join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${W} ${H}" width="${outW}" height="${outH}" color="${g.ink}">\n` +
    (g.transparent ? '' : `<rect width="${W}" height="${H}" fill="${g.paper}"/>\n`) + `<defs>${defs}</defs>\n${body}\n</svg>`;
}
export const fileBase = () => 'glyf-' + slug(S.media.label.replace(/\(sample\)|\.[a-z0-9]+$/gi, '')) + '-' + S.gen.cols;

export const exportPNG = () => {
  if (!last) return toast('Nothing to export yet');
  let cv = outCv;
  if (S.gen.transparent) { cv = mk(outCv.width, outCv.height); cv.getContext('2d').drawImage(layerCv, 0, 0); }
  cv.toBlob(b => (b ? saveFile(fileBase() + '.png', b, 'image/png') : toast('PNG export failed', 'error')), 'image/png');
};
export const exportSVG = () => { const s = buildSVG(); s ? saveFile(fileBase() + '.svg', s, 'image/svg+xml') : toast('Nothing to export yet'); };
export const copySVG = () => {
  const s = buildSVG(); if (!s) return toast('Nothing to export yet');
  copyText(s).then(ok => (ok ? toast('SVG copied') : toast('Clipboard blocked here. Use Save SVG.', 'error')));
};
