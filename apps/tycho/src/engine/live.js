// TYCHO's app state, the animation loop and every action the UI takes. Engine code
// mutates S and calls emit(); React reads it through useStore().
import {useSyncExternalStore} from 'react';
import {
  toolStore, saveFile, copyText, encodeFramesToMp4, canEncodeVideo, createLiveSender, suiteGlyphs, watchGlyphs, rasterGlyphs, tintGlyph, glyphSymbol,
  registerRecipeTool, noteStart,
} from '@studio/core';
import {buildScene, drawScene, timing, roundAt} from './modules.js';
import {CanvasPainter, SvgPainter, setGlyphs} from './paint.js';
import {frameDims} from '@studio/core/frames';
import {cleanConfig, presetConfig, randomConfig, paletteColors, PRESETS, aspectOf, MAX_COLORS} from './config.js';

export const saved = toolStore('tycho');
const reduceMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- links ---------- */
function configFromHash() {
  const m = /[#&]c=([A-Za-z0-9_-]+)/.exec(location.hash || '');
  if (!m) return null;
  try {
    const json = new TextDecoder().decode(Uint8Array.from(atob(m[1].replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)));
    return cleanConfig(JSON.parse(json));
  } catch (e) {
    return null;
  }
}
const fromLink = configFromHash();
const stored = saved.get('config.v1', null);

export const S = {
  config: fromLink || (stored ? cleanConfig(stored) : presetConfig(PRESETS[0].id)),
  preset: fromLink ? '' : saved.get('preset', stored ? '' : PRESETS[0].id) || '',
  playing: !reduceMotion,
  time: 0,
  supported: true,
  looks: (saved.get('looks.v1', []) || []).filter(l => l && typeof l.name === 'string' && l.config),
  exportSize: saved.get('exportSize', 1920),
  exportLoops: saved.get('exportLoops', 1),
  exporting: null, // {done, total} while an MP4 renders
  glyphs: 0, // how many of GLYF's glyphs a glyph layer can use
  toast: null, // set by the app: (message, kind) => void
};
if (fromLink) {
  saved.set('config.v1', S.config); saved.set('preset', '');
  history.replaceState(null, '', location.pathname + location.search);
}

let version = 0;
const subs = new Set();
export function emit() { version++; subs.forEach(f => f()); }
export function useStore() {
  useSyncExternalStore(f => { subs.add(f); return () => subs.delete(f); }, () => version);
  return S;
}
export const toast = (msg, kind = 'info') => S.toast?.(msg, kind);

let saveTimer = 0;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { saved.set('config.v1', S.config); saved.set('preset', S.preset); }, 250);
}

/* ---------- scene at a time ---------- */
// A scene (layout plus modules) is rebuilt when the config, the round of cuts or the frame shape changes.
const sceneCache = new Map();
function sceneFor(cfg, round, aspect) {
  const key = round + '|' + aspect.toFixed(4);
  if (sceneCache.cfg !== cfg) { sceneCache.clear(); sceneCache.cfg = cfg; }
  let s = sceneCache.get(key);
  if (!s) { s = buildScene(cfg, round, aspect); sceneCache.set(key, s); }
  return s;
}
/** Draw the frame at time t into a painter sized W × H. */
function paintFrame(p, cfg, W, H, t) {
  drawScene(p, sceneFor(cfg, roundAt(cfg, t), aspectOf(cfg)), cfg, W, H, t);
}
export const loopSeconds = () => timing(S.config).loop;

/* ---------- the canvas and the loop ---------- */
let canvas = null, painter = null, resize = null, raf = 0, last = 0, lastEmit = 0;

/** Fit the canvas inside its frame at the chosen aspect, then size its pixels. */
function fit() {
  if (!canvas?.parentElement) return;
  const box = canvas.parentElement.getBoundingClientRect();
  const a = aspectOf(S.config);
  let w = box.width, h = w / a;
  if (h > box.height) { h = box.height; w = h * a; }
  canvas.style.width = Math.floor(w) + 'px';
  canvas.style.height = Math.floor(h) + 'px';
  const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
  const pw = Math.max(1, Math.round(w * dpr)), ph = Math.max(1, Math.round(h * dpr));
  if (canvas.width !== pw || canvas.height !== ph) { canvas.width = pw; canvas.height = ph; }
  draw();
}

// Offer the stage to other windows of the suite (the live link); a new watcher gets one more draw.
const live = createLiveSender({label: '', onWatch: () => draw()});

function draw() {
  if (painter && canvas.width > 1) { paintFrame(painter, S.config, canvas.width, canvas.height, S.time); live.frame(canvas); }
}

function tick(now) {
  raf = requestAnimationFrame(tick);
  const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
  last = now;
  if (!S.playing || S.exporting) return;
  S.time = (S.time + dt) % loopSeconds();
  draw();
  if (now - lastEmit > 250) { lastEmit = now; emit(); }
}

/** Hand the stage canvas over (null to let go). */
export function attachCanvas(c) {
  resize?.disconnect();
  cancelAnimationFrame(raf);
  canvas = c;
  if (!c) { painter = null; return; }
  const ctx = c.getContext('2d');
  painter = ctx ? new CanvasPainter(ctx) : null;
  S.supported = !!painter;
  resize = new ResizeObserver(fit);
  resize.observe(c.parentElement);
  fit();
  last = 0;
  raf = requestAnimationFrame(tick);
  emit();
}

/* ---------- GLYF's glyphs ---------- */
// Rasterized once per set change; the painters tint and place them.
let glyphLoad = 0, glyphsLoaded = Promise.resolve(); // the latest rasterizing, for recipe runs
function loadGlyphs() {
  const n = ++glyphLoad;
  glyphsLoaded = rasterGlyphs(suiteGlyphs(), 256).then(list => {
    if (n !== glyphLoad) return; // a newer set is on its way
    const ok = list.filter(g => g.mask);
    setGlyphs(ok.map(g => ({tint: color => tintGlyph(g.mask, color), symbol: id => glyphSymbol(g, id)})));
    S.glyphs = ok.length;
    draw();
    emit();
  });
}
if (typeof window !== 'undefined') { loadGlyphs(); watchGlyphs(loadGlyphs); }

/* ---------- editing ---------- */
function setConfig(cfg, preset = '') {
  const prev = S.config;
  S.config = cleanConfig(cfg);
  S.preset = preset;
  S.time %= loopSeconds();
  persist();
  if (aspectOf(prev) !== aspectOf(S.config)) fit(); else draw();
  emit();
}
/** Change one field (e.g. set('grid', 5)). */
export const set = (key, value) => setConfig({...S.config, [key]: value});

const newSeed = () => Math.floor(Math.random() * 1e9);
export const applyPreset = id => { setConfig(presetConfig(id), id); restart(); };
export const randomize = () => { setConfig(randomConfig()); restart(); };
/** A new composition: new cells, the same module settings. */
export const newLayout = () => set('seed', newSeed());
/** New modules in the same cells. */
export const newModules = () => set('moduleSeed', newSeed());
export function togglePlay() { S.playing = !S.playing; last = 0; emit(); }
export function restart() { S.time = 0; draw(); emit(); }
/** Jump to the next cut. */
export function nextCut() {
  const {cut} = timing(S.config);
  if (!cut) return newModules();
  S.time = ((Math.floor(S.time / cut + 1e-9) + 1) * cut) % loopSeconds();
  draw(); emit();
}

export function toggleIn(key, id, on, keepOne) {
  const cur = S.config[key];
  const next = on ? [...new Set([...cur, id])] : cur.filter(s => s !== id);
  if (keepOne && !next.length) return toast(keepOne, 'info');
  set(key, next);
}

export const applyPalette = id => setConfig({...S.config, ...paletteColors(id)});
const setColors = colors => setConfig({...S.config, colors, palette: ''});
export function setColor(i, c) { const colors = S.config.colors.slice(); colors[i] = c; setColors(colors); }
export function addColor() {
  const cs = S.config.colors;
  if (cs.length >= MAX_COLORS) return;
  setColors([...cs, '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0')]);
}
/** Use a suite palette's colors (up to MAX_COLORS) as the color list. */
export const applySuitePalette = colors => setColors(colors.slice(0, MAX_COLORS));
export function removeColor(i) {
  if (S.config.colors.length <= 2) return toast('Keep at least two colors', 'info');
  setColors(S.config.colors.filter((_, k) => k !== i));
}

/* ---------- tap tempo ---------- */
let taps = [];
/** Tap along to a beat; four or more taps set the BPM from their average spacing. */
export function tapTempo() {
  const now = performance.now();
  if (taps.length && now - taps[taps.length - 1] > 2000) taps = [];
  taps.push(now);
  if (taps.length > 8) taps.shift();
  if (taps.length >= 2) {
    const gaps = taps.slice(1).map((t, i) => t - taps[i]);
    const bpm = Math.round(60000 / (gaps.reduce((a, b) => a + b, 0) / gaps.length));
    set('bpm', Math.min(200, Math.max(40, bpm)));
  }
  return taps.length;
}

/* ---------- export ---------- */
let exportCanvas = null, exportPainter = null, cancelExport = false;
function exportDims() {
  return frameDims(S.config.aspect, aspectOf(S.config), S.exportSize, [S.config.customW, S.config.customH]);
}
function exportTarget(w, h) {
  if (!exportCanvas) {
    exportCanvas = document.createElement('canvas');
    exportPainter = new CanvasPainter(exportCanvas.getContext('2d'));
  }
  exportCanvas.width = w; exportCanvas.height = h;
  return exportCanvas;
}
const fileName = () => 'tycho-' + (S.preset || S.config.palette || 'custom') + '-' + S.config.seed;

export function setExportSize(v) { S.exportSize = v; saved.set('exportSize', v); emit(); }
export function setExportLoops(v) { S.exportLoops = v; saved.set('exportLoops', v); emit(); }

async function report(r) { toast(r.message, r.status === 'error' ? 'error' : 'info'); }

/** The frame on screen at export size, as a PNG: what Save PNG saves and Send to sends. */
export async function stillBlob() {
  const [w, h] = exportDims();
  const c = exportTarget(w, h);
  paintFrame(exportPainter, S.config, w, h, S.time);
  const blob = await new Promise(res => c.toBlob(res, 'image/png'));
  if (!blob) throw new Error('the browser could not make the picture');
  return {blob, name: fileName() + '.png'};
}

export async function exportPNG() {
  try {
    const {blob, name} = await stillBlob();
    report(await saveFile(name, blob, 'image/png'));
  } catch (e) {
    console.error(e);
    toast('Could not save the image: ' + e.message, 'error');
  }
}

export async function exportSVG() {
  try {
    const [w, h] = exportDims();
    const p = new SvgPainter(w, h);
    paintFrame(p, S.config, w, h, S.time);
    report(await saveFile(fileName() + '.svg', new Blob([p.toString()], {type: 'image/svg+xml'}), 'image/svg+xml'));
  } catch (e) {
    console.error(e);
    toast('Could not save the SVG: ' + e.message, 'error');
  }
}

export const videoSupported = canEncodeVideo;
export const videoSeconds = () => loopSeconds() * S.exportLoops;

/** The loop as the MP4 export makes it: {blob, name, codecNote}, or null if canceled. */
export async function renderMP4() {
  if (S.exporting) return null;
  const cfg = S.config; // edits during the render don't leak in
  const fps = 30, frames = Math.round(videoSeconds() * fps);
  const [w, h] = exportDims();
  const name = fileName();
  cancelExport = false;
  S.exporting = {done: 0, total: frames};
  emit();
  try {
    const c = exportTarget(w, h);
    const {blob, codecNote} = await encodeFramesToMp4({
      width: w, height: h, fps, frames,
      drawFrame: i => { paintFrame(exportPainter, cfg, w, h, i / fps); return c; },
      onProgress: ({frame, total}) => { if (frame % 4 === 0 || frame === total) { S.exporting = {done: frame, total}; emit(); } },
      isCancelled: () => cancelExport,
    });
    return blob ? {blob, name: name + '.mp4', codecNote} : null;
  } finally {
    S.exporting = null;
    last = 0;
    draw();
    emit();
  }
}

export async function exportMP4() {
  if (S.exporting) return;
  try {
    const out = await renderMP4();
    if (out) { const r = await saveFile(out.name, out.blob, 'video/mp4'); report(r.status === 'error' ? r : {...r, message: r.message + out.codecNote}); }
    else toast('Export cancelled');
  } catch (e) {
    console.error(e);
    toast(e.message || 'Could not make the video', 'error');
  }
}
export function cancelMP4() { cancelExport = true; }

/* ---------- saved looks, project files and links ---------- */
const storeLooks = () => saved.set('looks.v1', S.looks);

export function saveLook(name) {
  name = String(name || '').trim().slice(0, 60);
  if (!name) return;
  const i = S.looks.findIndex(l => l.name.toLowerCase() === name.toLowerCase());
  const look = {name, config: S.config};
  if (i >= 0) S.looks[i] = look; else S.looks.push(look);
  storeLooks(); emit();
  toast(i >= 0 ? `Updated "${name}"` : `Saved "${name}"`);
}
export function applyLook(name) {
  const l = S.looks.find(x => x.name === name);
  if (l) { setConfig(l.config); restart(); }
}
export function deleteLook(name) { S.looks = S.looks.filter(l => l.name !== name); storeLooks(); emit(); }

export async function saveProject() {
  const blob = new Blob([JSON.stringify({app: 'tycho', version: 1, config: S.config}, null, 2)], {type: 'application/json'});
  report(await saveFile(fileName() + '.tycho.json', blob, 'application/json'));
}

export async function openProject(file) {
  if (!file) return;
  let p;
  try { p = JSON.parse(await file.text()); } catch (e) { p = null; }
  if (!p || p.app !== 'tycho' || typeof p.config !== 'object') return toast('That file is not a TYCHO project', 'error');
  setConfig(p.config);
  restart();
  toast('Opened ' + file.name);
}

export async function copyLink() {
  const bytes = new TextEncoder().encode(JSON.stringify(S.config));
  const b64 = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const url = location.origin + location.pathname + '#c=' + b64;
  toast((await copyText(url)) ? 'Link copied' : 'Could not copy the link', 'info');
}

// A link pasted into an open tab only changes the hash, so apply it without a reload.
if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => {
    const cfg = configFromHash();
    if (!cfg) return;
    history.replaceState(null, '', location.pathname + location.search);
    setConfig(cfg);
    restart();
    toast('Opened the linked look');
  });
}

/* ---------- recipes ---------- */
// TYCHO starts a chain. A step keeps the grid (its frame and Custom size are in the
// config), the moment shown (for a still), the export long side and the video's loops.
noteStart();
registerRecipeTool({
  // A run starts before the app mounts its toaster: wait a moment for it.
  toast: (msg, kind) => (S.toast ? S.toast(msg, kind) : setTimeout(() => toast(msg, kind), 500)),
  getSettings: () => ({config: S.config, time: S.time, exportSize: S.exportSize, exportLoops: S.exportLoops}),
  applySettings(s) {
    // Pause on the step's moment, so the still is the frame that was saved (setConfig wraps it into the loop).
    S.playing = false; S.time = Math.max(0, Number(s.time) || 0);
    if ([1080, 1920, 2560, 3840].includes(s.exportSize)) setExportSize(s.exportSize);
    if (s.exportLoops >= 1 && s.exportLoops <= 8) setExportLoops(Math.round(s.exportLoops));
    setConfig(s.config || S.config);
  },
  setSize: (w, h) => setConfig({...S.config, aspect: 'custom', customW: w, customH: h}),
  // GLYF's glyphs rasterize in the background; a glyph layer needs them before it draws.
  async ready() {
    await glyphsLoaded.catch(() => {});
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  },
  renderStill: stillBlob,
  renderVideo() {
    if (!canEncodeVideo()) throw new Error('This browser cannot encode video. Use Chrome or Edge.');
    return renderMP4();
  },
});
