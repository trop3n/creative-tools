// THOTH's app state, the animation loop and every action the UI takes. Engine code
// mutates S and calls emit(); React reads it through useStore().
import {useSyncExternalStore} from 'react';
import {
  toolStore, saveFile, copyText, encodeFramesToMp4, canEncodeVideo, makeCanvas, isVideoFile, isImageFile,
  loadImageFile, openVideoFile, seekVideo, openWebcam, cameraErrorMessage,
} from '@studio/core';
import {drawSource} from './source.js';
import {createHalftone} from './halftone.js';
import {frameDims} from '@studio/core/frames';
import {cleanConfig, presetConfig, PRESETS, aspectOf, baseFor, DEFAULT_CONFIG} from './config.js';

export const saved = toolStore('thoth');
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
  media: null, // {kind: 'image' | 'video' | 'camera', label, el, w, h, mirror, video?, file?, dispose}
  mediaBusy: false,
  looks: (saved.get('looks.v1', []) || []).filter(l => l && typeof l.name === 'string' && l.config),
  exportSize: saved.get('exportSize', 1920),
  exportLoops: saved.get('exportLoops', 1),
  matchVideo: saved.get('matchVideo', true),
  exporting: null, // {done, total} while an MP4 renders
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
const toast = (msg, kind = 'info') => S.toast?.(msg, kind);

let saveTimer = 0;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { saved.set('config.v1', S.config); saved.set('preset', S.preset); }, 250);
}

/* ---------- drawing a frame ---------- */
// The source is drawn at half the output size: the halftone samples it once per dot, so more is wasted.
function sourceSize(w, h) {
  const k = Math.min(0.5, 1600 / Math.max(w, h));
  return [Math.max(2, Math.round(w * k)), Math.max(2, Math.round(h * k))];
}
function mediaFrame() {
  const m = S.media;
  if (!m) return null;
  if (m.video) { m.w = m.video.videoWidth || m.w; m.h = m.video.videoHeight || m.h; }
  return m.w > 1 ? m : null;
}
/** Draw the frame at time t through `ht` (a halftone renderer) using the 2D canvas `src`. */
function paintFrame(ht, src, cfg, t) {
  const [sw, sh] = sourceSize(ht.gl.canvas.width, ht.gl.canvas.height);
  if (src.width !== sw || src.height !== sh) { src.width = sw; src.height = sh; }
  drawSource(src.getContext('2d'), cfg, sw, sh, t, mediaFrame());
  ht.render(src, cfg);
}

/* ---------- the canvas and the loop ---------- */
let canvas = null, renderer = null, resize = null, raf = 0, last = 0, lastEmit = 0;
const liveSource = makeCanvas(2, 2);

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

function draw() {
  if (renderer && !renderer.lost && canvas.width > 1) paintFrame(renderer, liveSource, S.config, S.time);
}

function tick(now) {
  raf = requestAnimationFrame(tick);
  const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
  last = now;
  if (S.exporting) return;
  if (S.playing) S.time = (S.time + dt) % S.config.loop;
  // Video and webcam frames keep arriving while paused only if they play; draw whenever anything moves.
  if (S.playing || (S.media?.video && !S.media.video.paused)) draw();
  if (S.playing && now - lastEmit > 250) { lastEmit = now; emit(); }
}

const onLost = e => { e.preventDefault(); };
const onRestored = () => { try { renderer?.rebuild(); draw(); } catch (e) { console.error(e); } };

/** Hand the stage canvas over (null to let go). The renderer survives a detach and re-attach of the same canvas. */
export function attachCanvas(c) {
  resize?.disconnect();
  cancelAnimationFrame(raf);
  if (!c) return;
  if (c !== canvas) {
    canvas?.removeEventListener('webglcontextlost', onLost);
    canvas?.removeEventListener('webglcontextrestored', onRestored);
    canvas = c;
    try { renderer = createHalftone(c); } catch (e) { console.error(e); renderer = null; }
    c.addEventListener('webglcontextlost', onLost);
    c.addEventListener('webglcontextrestored', onRestored);
  }
  S.supported = !!renderer;
  resize = new ResizeObserver(fit);
  resize.observe(c.parentElement);
  fit();
  last = 0;
  raf = requestAnimationFrame(tick);
  emit();
}

// Text needs its font before the first frame looks right.
if (typeof document !== 'undefined' && document.fonts) {
  Promise.all([400, 700, 900].map(w => document.fonts.load(`${w} 64px montserrat`).catch(() => null))).then(() => draw());
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
/** Change a top-level field. */
export const set = (key, value) => setConfig({...S.config, [key]: value});
/** Change a field of a layer (backdrop, media, shape, text). */
export const setIn = (layer, key, value) => setConfig({...S.config, [layer]: {...S.config[layer], [key]: value}});
/** Change a field of a layer's fill (shape, text). */
export const setFill = (layer, key, value) => setIn(layer, 'fill', {...S.config[layer].fill, [key]: value});
export function setBackdropColor(i, c) { const colors = S.config.backdrop.colors.slice(); colors[i] = c; setIn('backdrop', 'colors', colors); }

/** Switch screens; a black or white solid backdrop flips so the frame isn't flooded with ink. */
export function setMode(mode) {
  const b = S.config.backdrop;
  const flip = b.kind === 'solid' && ['#000000', '#ffffff'].includes(b.colors[0]);
  const colors = flip ? [baseFor(mode), ...b.colors.slice(1)] : b.colors;
  setConfig({...S.config, mode, backdrop: {...b, colors}});
}

export const applyPreset = id => { setConfig(presetConfig(id), id); restart(); };
export function randomize() {
  const R = Math.random, pick = a => a[Math.floor(R() * a.length)];
  const base = presetConfig(pick(PRESETS).id);
  const mode = pick(['rgb', 'rgb', 'cmyk', 'mono']);
  const hues = ['#ff2a6d', '#ffb000', '#3f6bff', '#2fd0a0', '#b44dff', '#ffffff', '#ff5a2a'];
  setConfig({
    ...base, mode,
    pitch: 8 + Math.round(R() * 20), dot: 0.9 + R() * 0.6, dotShape: pick(['circle', 'circle', 'square', 'diamond', 'line']),
    angle: pick([0, 0, 15, -20, 45]), spread: pick([0, 0, 10, 20]), split: R() * 0.3,
    hueCycles: 1 + Math.floor(R() * 3), hueSteps: pick([0, 0, 4, 6, 8]),
    backdrop: {...base.backdrop, colors: mode === 'rgb' ? base.backdrop.colors : [baseFor(mode), ...base.backdrop.colors.slice(1)]},
    shape: {...base.shape, kind: pick(['heart', 'circle', 'star', 'ring', 'square', 'triangle']), fill: {...base.shape.fill, a: pick(hues), b: pick(hues)}},
  });
  restart();
}
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

/* ---------- media ---------- */
function setMedia(m) {
  S.media?.dispose?.();
  S.media = m;
  if (m && !S.config.media.on) S.config = cleanConfig({...S.config, media: {...S.config.media, on: true}});
  draw(); emit();
}
export async function openMedia(file) {
  if (!file) return;
  S.mediaBusy = true; emit();
  try {
    if (isImageFile(file)) {
      const c = await loadImageFile(file, 2000);
      setMedia({kind: 'image', label: file.name, el: c, w: c.width, h: c.height, mirror: false, dispose: () => {}});
    } else if (isVideoFile(file)) {
      const v = await openVideoFile(file, {muted: true, loop: true});
      v.video.play().catch(() => {});
      setMedia({kind: 'video', label: file.name, el: v.video, video: v.video, file, w: v.video.videoWidth, h: v.video.videoHeight, mirror: false, dispose: v.dispose});
    } else toast('Open an image or a video', 'info');
  } catch (e) {
    console.error(e);
    toast(e.message || 'Could not open that file', 'error');
  } finally {
    S.mediaBusy = false; emit();
  }
}
export async function startCamera() {
  S.mediaBusy = true; emit();
  try {
    const cam = await openWebcam();
    setMedia({kind: 'camera', label: cam.label || 'Webcam', el: cam.video, video: cam.video, w: cam.video.videoWidth, h: cam.video.videoHeight, mirror: true, dispose: cam.dispose});
  } catch (e) {
    toast(cameraErrorMessage(e), 'error');
  } finally {
    S.mediaBusy = false; emit();
  }
}
export function removeMedia() { setMedia(null); }

/* ---------- export ---------- */
let exportCanvas = null, exportRenderer = null, cancelExport = false;
const exportSource = makeCanvas(2, 2);
function exportDims() {
  return frameDims(S.config.aspect, aspectOf(S.config), S.exportSize, [S.config.customW, S.config.customH]);
}
function exportTarget(w, h) {
  if (!exportCanvas || exportRenderer?.lost) {
    exportCanvas = document.createElement('canvas');
    exportRenderer = createHalftone(exportCanvas, {preserve: true});
  }
  exportCanvas.width = w; exportCanvas.height = h;
  return exportCanvas;
}
const fileName = () => 'thoth-' + (S.preset || S.config.mode) + '-' + Math.round(S.time * 10);

export function setExportSize(v) { S.exportSize = v; saved.set('exportSize', v); emit(); }
export function setExportLoops(v) { S.exportLoops = v; saved.set('exportLoops', v); emit(); }
export function setMatchVideo(v) { S.matchVideo = v; saved.set('matchVideo', v); emit(); }
const report = r => toast(r.message, r.status === 'error' ? 'error' : 'info');

export async function exportPNG() {
  try {
    const [w, h] = exportDims();
    const c = exportTarget(w, h);
    paintFrame(exportRenderer, exportSource, S.config, S.time);
    const blob = await new Promise(res => c.toBlob(res, 'image/png'));
    if (!blob) throw new Error('the graphics card could not read the frame back');
    report(await saveFile(fileName() + '.png', blob, 'image/png'));
  } catch (e) {
    console.error(e);
    toast('Could not save the image: ' + e.message, 'error');
  }
}

export const videoSupported = () => canEncodeVideo() && S.media?.kind !== 'camera';
/** Seconds an MP4 covers: the video's length when matching a video, else whole loops. */
export function videoSeconds() {
  const v = S.media?.kind === 'video' ? S.media.video : null;
  if (v && S.matchVideo && isFinite(v.duration) && v.duration > 0) return v.duration;
  return S.config.loop * S.exportLoops;
}

export async function exportMP4() {
  if (S.exporting) return;
  const cfg = S.config; // edits during the render don't leak in
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
    const c = exportTarget(w, h);
    const {blob} = await encodeFramesToMp4({
      width: w, height: h, fps, frames,
      drawFrame: async i => {
        const t = i / fps;
        if (v) await seekVideo(v, Math.min(v.duration - 0.001, t % v.duration));
        if (exportRenderer.lost) throw new Error('The graphics card was reset during the render. Try again.');
        paintFrame(exportRenderer, exportSource, cfg, t);
        return c;
      },
      onProgress: ({frame, total}) => { if (frame % 4 === 0 || frame === total) { S.exporting = {done: frame, total}; emit(); } },
      isCancelled: () => cancelExport,
    });
    if (blob) report(await saveFile(name + '.mp4', blob, 'video/mp4'));
    else toast('Export cancelled');
  } catch (e) {
    console.error(e);
    toast(e.message || 'Could not make the video', 'error');
  } finally {
    S.exporting = null;
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
export function applyLook(name) {
  const l = S.looks.find(x => x.name === name);
  if (l) { setConfig(l.config); restart(); }
}
export function deleteLook(name) { S.looks = S.looks.filter(l => l.name !== name); storeLooks(); emit(); }

export async function saveProject() {
  const blob = new Blob([JSON.stringify({app: 'thoth', version: 1, config: S.config}, null, 2)], {type: 'application/json'});
  report(await saveFile(fileName() + '.thoth.json', blob, 'application/json'));
}

/** Open a project file, or an image or video as the media layer. */
export async function openFile(file) {
  if (!file) return;
  if (isImageFile(file) || isVideoFile(file)) return openMedia(file);
  let p;
  try { p = JSON.parse(await file.text()); } catch (e) { p = null; }
  if (!p || p.app !== 'thoth' || typeof p.config !== 'object') return toast('That file is not a THOTH project, an image or a video', 'error');
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

export {DEFAULT_CONFIG};
