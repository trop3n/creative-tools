// Generator: rasterize glyphs, measure their ink, map source tones onto them.
import {S, emit, saveGen, setLibListener, toast, saveFile} from './store.js';
import {copyText} from '@studio/core';
import {glyphSVG, shapeInner, n2, slug} from './shapes.js';
import {media} from './media.js';

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

function sampleGrid(src, cols, rows) {
  let c = src, w = src.width, h = src.height;
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
  const my = ++tok, set = S.lib.shapes.filter(s => s.inSet), src = media.src;
  const rs = await Promise.all(set.map(rasterGlyph));
  if (my !== tok) return;
  set.forEach((s, i) => (S.cov[s.id] = rs[i].cov));
  const glyphs = set.map((s, i) => ({s, cv: rs[i].cv, cov: rs[i].cov})).filter(g => g.cv && g.cov > 0.002).sort((a, b) => a.cov - b.cov);
  const rk = glyphs.map(g => g.s.id + ':' + g.cov).join();
  if (rk !== rampKey) { rampKey = rk; S.ramp = glyphs.map(g => ({id: g.s.id, cov: g.cov})); quiet = false; }
  if (!outCv || !glyphs.length || !src) { last = null; S.stats = ''; emit(); return; }

  const g = S.gen, m = glyphs.length, cols = g.cols, rows = Math.max(1, Math.round((cols * src.height) / src.width));
  const px = sampleGrid(src, cols, rows), N = cols * rows, val = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    let L = (0.2126 * px[i * 4] + 0.7152 * px[i * 4 + 1] + 0.0722 * px[i * 4 + 2]) / 255;
    L = clamp((L - 0.5) * g.contrast + 0.5 + g.bright, 0, 1);
    L = Math.pow(L, 1 / g.gamma);
    val[i] = g.invert ? L : 1 - L;
  }
  const maxC = glyphs[m - 1].cov;
  const lv = glyphs.map((gl, i) => ({gl, v: g.steps === 'even' ? (g.blank ? (i + 1) / m : m > 1 ? i / (m - 1) : 1) : gl.cov / maxC}));
  if (g.blank) lv.unshift({gl: null, v: 0});
  else if (g.steps !== 'even' && m > 1) { const lo = lv[0].v; lv.forEach(l => (l.v = (l.v - lo) / (1 - lo || 1))); }
  const size = g.mode === 'size';
  const idx = size ? null : quantize(val, cols, rows, lv.map(l => l.v), g.dither);

  const cell = Math.max(4, Math.min(40, Math.floor((media.kind === 'video' || media.kind === 'camera' ? 1920 : 2400) / Math.max(cols, rows))));
  const W = cols * cell, H = rows * cell;
  if (outCv.width !== W || outCv.height !== H) { outCv.width = W; outCv.height = H; }
  if (!layerCv || layerCv.width !== W || layerCv.height !== H) layerCv = mk(W, H);
  const lx = layerCv.getContext('2d');
  lx.setTransform(1, 0, 0, 1, 0, 0); lx.globalCompositeOperation = 'source-over'; lx.clearRect(0, 0, W, H); lx.imageSmoothingQuality = 'high';
  const marks = [], gi = new Map(glyphs.map((gl, i) => [gl, i]));
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const i = y * cols + x; let gl, sc = 1;
    if (size) { const v = val[i]; if (v < 0.03) continue; gl = glyphs[m > 1 ? hash(x, y, g.seed) % m : 0]; sc = Math.sqrt(v); }
    else { gl = lv[idx[i]].gl; if (!gl) continue; }
    const rot = g.rot === 'random' ? hash(x, y, g.seed * 2 + 1) % 4 : g.rot === 'checker' ? (x + y) & 1 : 0;
    const s = cell * (1 - g.gap) * sc, cx = x * cell + cell / 2, cy = y * cell + cell / 2;
    lx.setTransform(1, 0, 0, 1, cx, cy); if (rot) lx.rotate((rot * Math.PI) / 2);
    lx.drawImage(gl.cv, -s / 2, -s / 2, s, s);
    marks.push([x, y, gi.get(gl), sc, rot]);
  }
  lx.setTransform(1, 0, 0, 1, 0, 0); lx.globalCompositeOperation = 'source-in';
  if (g.color === 'source') {
    const cc = mk(cols, rows);
    cc.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(px), cols, rows), 0, 0);
    lx.imageSmoothingEnabled = false; lx.drawImage(cc, 0, 0, W, H); lx.imageSmoothingEnabled = true;
  } else { lx.fillStyle = g.ink; lx.fillRect(0, 0, W, H); }
  lx.globalCompositeOperation = 'source-over';
  const ox = outCv.getContext('2d');
  ox.fillStyle = g.paper; ox.fillRect(0, 0, W, H); ox.drawImage(layerCv, 0, 0);
  last = {cols, rows, glyphs, marks, px};
  const stats = `${cols} × ${rows} cells · ${marks.length.toLocaleString()} marks · ${m} glyph${m > 1 ? 's' : ''}`;
  if (!quiet || stats !== S.stats) { S.stats = stats; emit(); }
}

const hex = (r, g, b) => '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
export function buildSVG() {
  if (!last) return null;
  const {cols, rows, glyphs, marks, px} = last, g = S.gen, cs = 10, W = cols * cs, H = rows * cs, used = new Set(marks.map(m => m[2]));
  const defs = glyphs.map((gl, i) => (used.has(i) ? `<symbol id="g${i}" viewBox="0 0 100 100" overflow="visible">${shapeInner(gl.s, 'g' + i)}</symbol>` : '')).join('');
  const body = marks.map(([x, y, i, sc, rot]) => {
    const s = cs * (1 - g.gap) * sc, cx = x * cs + cs / 2, cy = y * cs + cs / 2, p = (y * cols + x) * 4;
    return `<use xlink:href="#g${i}" x="${n2(cx - s / 2)}" y="${n2(cy - s / 2)}" width="${n2(s)}" height="${n2(s)}"${rot ? ` transform="rotate(${rot * 90} ${cx} ${cy})"` : ''}${g.color === 'source' ? ` color="${hex(px[p], px[p + 1], px[p + 2])}"` : ''}/>`;
  }).join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" color="${g.ink}">\n` +
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
