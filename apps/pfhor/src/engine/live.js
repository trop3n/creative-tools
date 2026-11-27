// PFHOR's app state, the animation loop and every action the UI takes. Engine code
// mutates S and calls emit(); React reads it through useStore().
import {useSyncExternalStore} from 'react';
import {
  toolStore, saveFile, copyText, encodeFramesToMp4, canEncodeVideo, makeCanvas, isVideoFile, isImageFile,
  loadImageFile, openVideoFile, seekVideo, openWebcam, cameraErrorMessage, takeSent, TOOL_NAMES,
  createLiveSender, openLiveSource, suiteGlyphs, watchGlyphs, rasterGlyphs, byInk, tintGlyph, glyphSymbol,
} from '@studio/core';
import {analyze, buildCells, drawCells, thresholdAt, canvasPainter, svgPainter} from './mosaic.js';
import {sampleCanvas} from './samples.js';
import {frameDims} from '@studio/core/frames';
import {cleanConfig, presetConfig, paletteColors, PRESETS, aspectOf, MAX_COLORS} from './config.js';

export const saved = toolStore('pfhor');
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
  cells: 0, // how many cells the last frame drew
  media: null, // {kind: 'image' | 'video' | 'camera', label, el, w, h, video?, live?, dispose}
  mediaBusy: false,
  glyphCount: 0, // glyphs in GLYF's shared set
  looks: (saved.get('looks.v1', []) || []).filter(l => l && typeof l.name === 'string' && l.config),
  exportSize: saved.get('exportSize', 1440),
  exportLoops: saved.get('exportLoops', 1),
  matchVideo: saved.get('matchVideo', true),
  exporting: null,
  toast: null,
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

/* ---------- analysis ---------- */
// The source is drawn, cover-fit, into a small canvas at the frame's aspect, then analysed.
// Still sources are analysed once per setting change; video and webcam every new frame.
const work = makeCanvas(2, 2);
const workCtx = work.getContext('2d', {willReadFrequently: true});
let cache = {key: '', A: null};

function sourceOf() {
  const m = S.media;
  if (m) {
    if (m.video) { m.w = m.video.videoWidth || m.w; m.h = m.video.videoHeight || m.h; }
    if (m.w > 1) return m;
  }
  const c = sampleCanvas(S.config.sample);
  return {kind: 'sample', el: c, w: c.width, h: c.height};
}

function analysisFor(cfg) {
  const a = aspectOf(cfg);
  const aW = a >= 1 ? cfg.detail : Math.round(cfg.detail * a), aH = a >= 1 ? Math.round(cfg.detail / a) : cfg.detail;
  const src = sourceOf();
  const frame = src.video ? src.video.currentTime + ':' + (src.video.paused ? 'p' : performance.now()) : '';
  const mirror = src.kind === 'camera' && !src.live && cfg.mirror; // a live link is never mirrored
  const key = [src.kind === 'sample' ? cfg.sample : src.label, aW, aH, cfg.contrast, cfg.brightness, mirror, frame].join('|');
  if (cache.key === key && cache.A) return cache.A;
  if (work.width !== aW || work.height !== aH) { work.width = aW; work.height = aH; }
  const k = Math.max(aW / src.w, aH / src.h);
  workCtx.setTransform(1, 0, 0, 1, 0, 0);
  workCtx.fillStyle = '#808080';
  workCtx.fillRect(0, 0, aW, aH);
  if (mirror) workCtx.setTransform(-1, 0, 0, 1, aW, 0);
  workCtx.drawImage(src.el, (aW - src.w * k) / 2, (aH - src.h * k) / 2, src.w * k, src.h * k);
  workCtx.setTransform(1, 0, 0, 1, 0, 0);
  const A = analyze(workCtx.getImageData(0, 0, aW, aH).data, aW, aH, cfg.contrast, cfg.brightness);
  cache = {key, A};
  return A;
}

/* ---------- GLYF's glyphs ---------- */
// The Glyphs shape draws GLYF's shared set, sorted by ink. Each set is rasterized once per
// size (128 px on the stage, 256 px for PNG and MP4) and again when GLYF changes it.
let glyphSets = {}, stageGlyphs = [], glyphLoads = 0;
function glyphsAt(size) {
  if (!glyphSets[size]) {
    // Every size keeps the 128 px ink order, so the stage and the files pick the same glyphs.
    const list = suiteGlyphs();
    glyphSets[size] = Promise.all([rasterGlyphs(list, 128), rasterGlyphs(list, size)]).then(([small, big]) => byInk(small.map((g, i) => ({...g, mask: g.mask && big[i].mask}))).map((g, i) => ({
      ...g, sym: 'glyph-' + i, symbol: glyphSymbol(g, 'glyph-' + i), tint: color => tintGlyph(g.mask, color),
    })));
  }
  return glyphSets[size];
}
function loadGlyphs() {
  const n = ++glyphLoads;
  glyphSets = {};
  S.glyphCount = suiteGlyphs().length;
  glyphsAt(128).then(gs => { if (n !== glyphLoads) return; stageGlyphs = gs; draw(); emit(); });
}
if (typeof window !== 'undefined') { loadGlyphs(); watchGlyphs(loadGlyphs); }

/** Draw the frame at time t into painter p, W × H pixels. Returns the cell count. */
function paintFrame(p, cfg, W, H, t, glyphs = stageGlyphs) {
  const A = analysisFor(cfg);
  const lp = (t / cfg.loop) % 1;
  const cells = buildCells(A, cfg, thresholdAt(cfg, lp), cfg.resolve > 0);
  drawCells(p, cells, cfg, W, H, W / A.aW, lp, glyphs);
  return cells.length;
}

/* ---------- the canvas and the loop ---------- */
let canvas = null, painter = null, resize = null, raf = 0, last = 0, lastEmit = 0;

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

// The live link: other windows of the suite can use the stage as their source.
const live = createLiveSender({label: () => PRESETS.find(p => p.id === S.preset)?.name || 'Custom', onWatch: () => draw()});

function draw() {
  if (painter && canvas.width > 1) { S.cells = paintFrame(painter, S.config, canvas.width, canvas.height, S.time); live.frame(canvas); }
}

// Without Resolve, Scatter or a moving source, frames don't change, so the loop only redraws when needed.
const animated = () => S.config.resolve > 0 || S.config.scatter > 0;
function tick(now) {
  raf = requestAnimationFrame(tick);
  const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
  last = now;
  if (S.exporting) return;
  if (S.playing) S.time = (S.time + dt) % S.config.loop;
  const moving = S.media?.video && !S.media.video.paused;
  if ((S.playing && animated()) || moving) draw();
  if (S.playing && now - lastEmit > 250) { lastEmit = now; emit(); }
}

/** Hand the stage canvas over (null to let go). */
export function attachCanvas(c) {
  resize?.disconnect();
  cancelAnimationFrame(raf);
  if (!c) return;
  canvas = c;
  painter = canvasPainter(c.getContext('2d'));
  resize = new ResizeObserver(fit);
  resize.observe(c.parentElement);
  fit();
  last = 0;
  raf = requestAnimationFrame(tick);
  emit();
}

if (typeof document !== 'undefined' && document.fonts) {
  // The Type sample uses the suite font; redraw once it's ready.
  document.fonts.load('800 64px montserrat').then(() => { cache.key = ''; draw(); }).catch(() => {});
}

/* ---------- editing ---------- */
function setConfig(cfg, preset = '') {
  const prev = S.config;
  S.config = cleanConfig(cfg);
  S.preset = preset;
  S.time %= S.config.loop;
  persist();
  if (aspectOf(prev) !== aspectOf(S.config)) fit(); else draw();
  emit();
}
export const set = (key, value) => setConfig({...S.config, [key]: value});
export const applyPreset = id => setConfig({...presetConfig(id), sample: S.config.sample, aspect: S.config.aspect, customW: S.config.customW, customH: S.config.customH}, id);
export function randomize() {
  const R = Math.random, pick = a => a[Math.floor(R() * a.length)];
  const base = presetConfig(pick(PRESETS).id);
  setConfig({
    ...base, sample: S.config.sample, aspect: S.config.aspect, customW: S.config.customW, customH: S.config.customH,
    ...paletteColors(pick(['robo', 'ketchup', 'blueprint', 'tealpop', 'sorbet', 'navygold'])),
    shape: pick(['circle', 'circle', 'square', 'rounded', 'mixed']),
    mapping: R() < 0.8 ? 'ramp' : 'nearest',
    threshold: 0.04 + R() * 0.1, roots: 2 + Math.floor(R() * 4), maxDepth: 4 + Math.floor(R() * 4),
    fill: 0.8 + R() * 0.2, gap: R() * 0.15, stroke: pick([0, 1, 1.5, 2]),
    resolve: R() < 0.4 ? 0.3 + R() * 0.5 : 0, scatter: R() < 0.3 ? 0.4 + R() * 0.5 : 0,
  });
}
export const applyPalette = id => setConfig({...S.config, ...paletteColors(id)});
const setColors = colors => setConfig({...S.config, colors, palette: ''});
/** Use a suite palette's colors (up to MAX_COLORS). */
export const applySuiteColors = colors => setColors(colors.slice(0, MAX_COLORS));
export function setColor(i, c) { const colors = S.config.colors.slice(); colors[i] = c; setColors(colors); }
export function addColor() {
  if (S.config.colors.length >= MAX_COLORS) return;
  setColors([...S.config.colors, '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0')]);
}
export function removeColor() {
  if (S.config.colors.length <= 2) return toast('Keep at least two colors', 'info');
  setColors(S.config.colors.slice(0, -1));
}
/** Reverse the palette's order (for the lightness ramp in listed order, this flips light and dark). */
export const reverseColors = () => setColors(S.config.colors.slice().reverse());

export function togglePlay() {
  S.playing = !S.playing; last = 0;
  const v = S.media?.kind === 'video' ? S.media.video : null;
  if (v) S.playing ? v.play().catch(() => {}) : v.pause();
  emit();
}
export function restart() {
  S.time = 0;
  if (S.media?.kind === 'video') S.media.video.currentTime = 0;
  draw(); emit();
}

/* ---------- sources ---------- */
function setMedia(m) {
  S.media?.dispose?.();
  S.media = m;
  cache.key = '';
  draw(); emit();
}
export function pickSample(id) { setMedia(null); set('sample', id); }
export async function openMedia(file) {
  if (!file) return;
  S.mediaBusy = true; emit();
  try {
    if (isImageFile(file)) {
      const c = await loadImageFile(file, 1600);
      setMedia({kind: 'image', label: file.name, el: c, w: c.width, h: c.height, dispose: () => {}});
    } else if (isVideoFile(file)) {
      const v = await openVideoFile(file, {muted: true, loop: true});
      v.video.play().catch(() => {});
      setMedia({kind: 'video', label: file.name, el: v.video, video: v.video, file, w: v.video.videoWidth, h: v.video.videoHeight, dispose: v.dispose});
    } else toast('Open an image or a video', 'info');
  } catch (e) {
    console.error(e);
    toast(e.message || 'Could not open that file', 'error');
  } finally {
    S.mediaBusy = false; emit();
  }
}
/** Open the picture another tool sent here (Send to → PFHOR), if any. */
export async function openSent() {
  const file = await takeSent();
  if (!file) return;
  await openMedia(file);
  toast(`Opened ${file.name} from ${TOOL_NAMES[file.from] || 'another tool'}`);
}
/** Use a camera-like source: open() resolves to openWebcam()'s shape; a live link is never mirrored. */
async function openCamera(open, isLive) {
  S.mediaBusy = true; emit();
  try {
    const cam = await open();
    setMedia({kind: 'camera', live: isLive, label: cam.label || 'Webcam', el: cam.video, video: cam.video, w: cam.video.videoWidth, h: cam.video.videoHeight, dispose: cam.dispose});
  } catch (e) {
    toast(isLive ? e.message || 'Could not open the live picture' : cameraErrorMessage(e), 'error');
  } finally {
    S.mediaBusy = false; emit();
  }
}
export const startCamera = () => openCamera(openWebcam, false);
/** Use another window of the suite (Live from another window) as the source. */
export const startLive = (id, name) => openCamera(() => openLiveSource(id, 'Live: ' + name), true);

/* ---------- export ---------- */
let exportCanvas = null, exportPainter = null, cancelExport = false;
function exportDims() {
  return frameDims(S.config.aspect, aspectOf(S.config), S.exportSize, [S.config.customW, S.config.customH]);
}
function exportTarget(w, h) {
  if (!exportCanvas) { exportCanvas = document.createElement('canvas'); exportPainter = canvasPainter(exportCanvas.getContext('2d')); }
  exportCanvas.width = w; exportCanvas.height = h;
  return exportCanvas;
}
const fileName = () => 'pfhor-' + (S.preset || 'custom') + '-' + (S.media ? S.media.label.replace(/\.[^.]+$/, '').replace(/[^\w-]+/g, '-').slice(0, 30) : S.config.sample);
const report = r => toast(r.message, r.status === 'error' ? 'error' : 'info');

export function setExportSize(v) { S.exportSize = v; saved.set('exportSize', v); emit(); }
export function setExportLoops(v) { S.exportLoops = v; saved.set('exportLoops', v); emit(); }
export function setMatchVideo(v) { S.matchVideo = v; saved.set('matchVideo', v); emit(); }

/** The frame on screen at export size, as a PNG blob. */
async function pngBlob() {
  const glyphs = await glyphsAt(256);
  const [w, h] = exportDims();
  const c = exportTarget(w, h);
  paintFrame(exportPainter, S.config, w, h, S.time, glyphs);
  return new Promise(res => c.toBlob(res, 'image/png'));
}
export async function exportPNG() {
  try {
    const blob = await pngBlob();
    report(await saveFile(fileName() + '.png', blob, 'image/png'));
  } catch (e) {
    console.error(e);
    toast('Could not save the image: ' + e.message, 'error');
  }
}
/** The picture as Save PNG makes it, to send to another tool. */
export async function stillBlob() {
  const blob = await pngBlob();
  if (!blob) throw new Error('Could not make the picture');
  return {blob, name: fileName() + '.png'};
}
export async function exportSVG() {
  try {
    const [w, h] = exportDims();
    const p = svgPainter();
    paintFrame(p, S.config, w, h, S.time);
    report(await saveFile(fileName() + '.svg', new Blob([p.toString()], {type: 'image/svg+xml'}), 'image/svg+xml'));
  } catch (e) {
    console.error(e);
    toast('Could not save the SVG: ' + e.message, 'error');
  }
}

export const videoSupported = () => canEncodeVideo() && S.media?.kind !== 'camera';
export function videoSeconds() {
  const v = S.media?.kind === 'video' ? S.media.video : null;
  if (v && S.matchVideo && isFinite(v.duration) && v.duration > 0) return v.duration;
  return S.config.loop * S.exportLoops;
}
export async function exportMP4() {
  if (S.exporting) return;
  const cfg = S.config;
  const fps = 30, frames = Math.max(1, Math.round(videoSeconds() * fps));
  const [w, h] = exportDims();
  const name = fileName();
  const v = S.media?.kind === 'video' ? S.media.video : null;
  const wasPlaying = v && !v.paused;
  v?.pause();
  cancelExport = false;
  S.exporting = {done: 0, total: frames};
  emit();
  try {
    const glyphs = await glyphsAt(256);
    const c = exportTarget(w, h);
    const {blob, codecNote} = await encodeFramesToMp4({
      width: w, height: h, fps, frames,
      drawFrame: async i => {
        const t = i / fps;
        if (v) { await seekVideo(v, Math.min(v.duration - 0.001, t % v.duration)); cache.key = ''; }
        paintFrame(exportPainter, cfg, w, h, t, glyphs);
        return c;
      },
      onProgress: ({frame, total}) => { if (frame % 4 === 0 || frame === total) { S.exporting = {done: frame, total}; emit(); } },
      isCancelled: () => cancelExport,
    });
    if (blob) { const r = await saveFile(name + '.mp4', blob, 'video/mp4'); report(r.status === 'error' ? r : {...r, message: r.message + codecNote}); }
    else toast('Export cancelled');
  } catch (e) {
    console.error(e);
    toast(e.message || 'Could not make the video', 'error');
  } finally {
    S.exporting = null;
    cache.key = '';
    if (wasPlaying) v.play().catch(() => {});
    last = 0;
    draw();
    emit();
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
export function applyLook(name) { const l = S.looks.find(x => x.name === name); if (l) setConfig(l.config); }
export function deleteLook(name) { S.looks = S.looks.filter(l => l.name !== name); storeLooks(); emit(); }

export async function saveProject() {
  const blob = new Blob([JSON.stringify({app: 'pfhor', version: 1, config: S.config}, null, 2)], {type: 'application/json'});
  report(await saveFile(fileName() + '.pfhor.json', blob, 'application/json'));
}
/** Open a project file, or an image or video as the source. */
export async function openFile(file) {
  if (!file) return;
  if (isImageFile(file) || isVideoFile(file)) return openMedia(file);
  let p;
  try { p = JSON.parse(await file.text()); } catch (e) { p = null; }
  if (!p || p.app !== 'pfhor' || typeof p.config !== 'object') return toast('That file is not a PFHOR project, an image or a video', 'error');
  setConfig(p.config);
  toast('Opened ' + file.name);
}
export async function copyLink() {
  const bytes = new TextEncoder().encode(JSON.stringify(S.config));
  const b64 = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  toast((await copyText(location.origin + location.pathname + '#c=' + b64)) ? 'Link copied' : 'Could not copy the link', 'info');
}
// A link pasted into an open tab only changes the hash, so apply it without a reload.
if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => {
    const cfg = configFromHash();
    if (!cfg) return;
    history.replaceState(null, '', location.pathname + location.search);
    setConfig(cfg);
    toast('Opened the linked look');
  });
}
