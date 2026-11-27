// BLOOM's app state, the animation loop and every action the UI takes. Engine code
// mutates S and calls emit(); React reads it through useStore().
import {useSyncExternalStore} from 'react';
import {toolStore, saveFile, copyText, encodeFramesToMp4, canEncodeVideo, createLiveSender} from '@studio/core';
import {buildPlant, meshPlant, Mesh} from './plant.js';
import {createBloomRenderer, frameCamera} from './renderer.js';
import {toRGB} from './color.js';
import {frameDims} from '@studio/core/frames';
import {cleanConfig, presetConfig, randomConfig, paletteColors, PRESETS, aspectOf, MAX_RAMPS, MAX_RAMP_STOPS} from './config.js';

export const saved = toolStore('bloom');
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
  playing: true,
  time: reduceMotion ? 6 : 0, // reduced motion: start on the finished bouquet, paused
  supported: true,
  looks: (saved.get('looks.v1', []) || []).filter(l => l && typeof l.name === 'string' && l.config),
  exportSize: saved.get('exportSize', 1440),
  exportLength: saved.get('exportLength', 8),
  exporting: null, // {done, total} while an MP4 renders
  toast: null, // set by the app: (message, kind) => void
};
if (reduceMotion) S.playing = false;
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
// The plant is rebuilt when the config changes, and per regrow round when cycling.
let plantCache = {cfg: null, round: -1, plant: null};
function plantFor(cfg, round) {
  if (plantCache.cfg !== cfg || plantCache.round !== round) plantCache = {cfg, round, plant: buildPlant(cfg, round)};
  return plantCache.plant;
}
/** Which regrow round and local time a timeline time falls in. */
export function localTime(cfg, t) {
  if (cfg.cycle > 0) return {round: Math.floor(t / cfg.cycle), t: t % cfg.cycle};
  return {round: 0, t};
}
const mesh = new Mesh();
function sceneFrame(cfg, t, aspect) {
  const lt = localTime(cfg, t);
  const plant = plantFor(cfg, lt.round);
  const cam = frameCamera(plant, cfg, lt.t, aspect);
  meshPlant(plant, lt.t, cfg, cam, mesh);
  return {mesh, viewProj: cam.viewProj, near: cam.near, far: cam.far, focus: cam.focus, blur: cfg.blur, background: cfg.background.map(toRGB)};
}
/** Seconds until the current plant has fully opened. */
export const doneAt = () => plantFor(S.config, localTime(S.config, S.time).round).doneAt;

/* ---------- the canvas and the loop ---------- */
let renderer = null, canvas = null, resize = null, raf = 0, last = 0, lastEmit = 0;
// Offer the stage to other windows of the suite (a new watcher gets one fresh draw).
const live = createLiveSender({label: () => PRESETS.find(p => p.id === S.preset)?.name || '', onWatch: () => draw()});

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

function draw() {
  if (!renderer || renderer.lost || canvas.width <= 1) return;
  renderer.render(sceneFrame(S.config, S.time, canvas.width / canvas.height));
  live.frame(canvas); // in the same task as the WebGL render, before the buffer clears
}

function tick(now) {
  raf = requestAnimationFrame(tick);
  const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
  last = now;
  if (!S.playing || S.exporting) return;
  S.time += dt;
  draw();
  if (now - lastEmit > 250) { lastEmit = now; emit(); }
}

/** Hand the stage canvas over (null to let go). */
export function attachCanvas(c) {
  resize?.disconnect();
  cancelAnimationFrame(raf);
  canvas = c;
  if (!c) { renderer?.dispose(); renderer = null; return; }
  try { renderer = createBloomRenderer(c); }
  catch (e) { console.error(e); renderer = null; }
  S.supported = !!renderer;
  resize = new ResizeObserver(fit);
  resize.observe(c.parentElement);
  fit();
  last = 0;
  raf = requestAnimationFrame(tick);
  emit();
}

/* ---------- editing ---------- */
function setConfig(cfg, preset = '') {
  const prev = S.config;
  S.config = cleanConfig(cfg);
  S.preset = preset;
  persist();
  if (aspectOf(prev) !== aspectOf(S.config)) fit(); else draw();
  emit();
}
/** Change one field (e.g. set('stems', 4)). */
export const set = (key, value) => setConfig({...S.config, [key]: value});
/** Change a colour field and drop the palette name (it's custom now). */
const setColors = patch => setConfig({...S.config, ...patch, palette: ''});

export const applyPreset = id => { setConfig(presetConfig(id), id); restart(); };
export const randomize = () => { setConfig(randomConfig()); restart(); };
export const reseed = () => { set('seed', Math.floor(Math.random() * 1e9)); restart(); };
export function togglePlay() { S.playing = !S.playing; last = 0; emit(); }
export function restart() { S.time = 0; draw(); emit(); }
/** Jump to the fully open plant. */
export function skipToBloom() { S.time = localTime(S.config, S.time).round * (S.config.cycle || 0) + doneAt(); draw(); emit(); }

export function toggleSpecies(id, on) {
  const cur = S.config.species;
  const next = on ? [...new Set([...cur, id])] : cur.filter(s => s !== id);
  if (!next.length) return toast('Keep at least one kind of flower', 'info');
  set('species', next);
}

export const applyPalette = id => setConfig({...S.config, ...paletteColors(id)});
export function setRampStop(r, i, color) {
  const ramps = S.config.ramps.map(x => x.slice());
  ramps[r][i] = color;
  setColors({ramps});
}
export function addRamp() {
  const ramps = S.config.ramps;
  if (ramps.length >= MAX_RAMPS) return;
  setColors({ramps: [...ramps, ramps[ramps.length - 1].slice().reverse()]});
}
export function removeRamp(r) { if (S.config.ramps.length > 1) setColors({ramps: S.config.ramps.filter((_, k) => k !== r)}); }
export function addRampStop(r) {
  const ramps = S.config.ramps.map(x => x.slice());
  if (ramps[r].length >= MAX_RAMP_STOPS) return;
  ramps[r].push(ramps[r][ramps[r].length - 1]);
  setColors({ramps});
}
export function removeRampStop(r) {
  const ramps = S.config.ramps.map(x => x.slice());
  if (ramps[r].length <= 2) return;
  ramps[r].pop();
  setColors({ramps});
}
export const setStemColor = (i, c) => { const stem = S.config.stem.slice(); stem[i] = c; setColors({stem}); };
export const setBackground = (i, c) => { const background = S.config.background.slice(); background[i] = c; setColors({background}); };
/** Hand the ramps out to different flowers, keeping the plant's shape. */
export function shuffleColors() {
  const ramps = S.config.ramps.slice();
  for (let i = ramps.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [ramps[i], ramps[j]] = [ramps[j], ramps[i]]; }
  if (ramps.length === 1) ramps[0] = ramps[0].slice().reverse();
  setColors({ramps});
}

/* ---------- export ---------- */
let exportCanvas = null, exportRenderer = null, cancelExport = false;
function exportDims() {
  return frameDims(S.config.aspect, aspectOf(S.config), S.exportSize, [S.config.customW, S.config.customH]);
}
function exportTarget(w, h) {
  if (!exportCanvas) {
    exportCanvas = document.createElement('canvas');
    exportRenderer = createBloomRenderer(exportCanvas, {preserve: true});
  }
  exportCanvas.width = w; exportCanvas.height = h;
  return exportCanvas;
}
const fileName = () => 'bloom-' + (S.preset || S.config.species.join('-')) + '-' + S.config.seed;

export function setExportSize(v) { S.exportSize = v; saved.set('exportSize', v); emit(); }
export function setExportLength(v) { S.exportLength = v; saved.set('exportLength', v); emit(); }

/** The frame on screen as the PNG export makes it: {blob, name}. */
export async function renderPNG() {
  const [w, h] = exportDims();
  const c = exportTarget(w, h);
  exportRenderer.render(sceneFrame(S.config, S.time, w / h));
  const blob = await new Promise(res => c.toBlob(res, 'image/png'));
  if (!blob) throw new Error('Could not make the picture');
  return {blob, name: fileName() + '.png'};
}

export async function exportPNG() {
  try {
    const {blob, name} = await renderPNG();
    const r = await saveFile(name, blob, 'image/png');
    toast(r.message, r.status === 'error' ? 'error' : 'info');
  } catch (e) {
    console.error(e);
    toast('Could not save the image: ' + e.message, 'error');
  }
}

export const videoSupported = canEncodeVideo;
/** Seconds an MP4 covers: one regrow cycle, or the chosen length. */
export const videoSeconds = () => (S.config.cycle > 0 ? S.config.cycle : S.exportLength);

/** The animation as the MP4 export makes it: {blob, name, codecNote}, or null if canceled. */
export async function renderMP4() {
  if (S.exporting) return null;
  const fps = 30, frames = Math.round(videoSeconds() * fps);
  const [w, h] = exportDims();
  cancelExport = false;
  S.exporting = {done: 0, total: frames};
  emit();
  try {
    const c = exportTarget(w, h);
    const {blob, codecNote} = await encodeFramesToMp4({
      width: w, height: h, fps, frames,
      drawFrame: i => { exportRenderer.render(sceneFrame(S.config, i / fps, w / h)); return c; },
      onProgress: ({frame, total}) => { if (frame % 4 === 0 || frame === total) { S.exporting = {done: frame, total}; emit(); } },
      isCancelled: () => cancelExport,
    });
    return blob ? {blob, name: fileName() + '.mp4', codecNote} : null;
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
    if (out) {
      const r = await saveFile(out.name, out.blob, 'video/mp4');
      toast(r.message + (r.status === 'error' ? '' : out.codecNote), r.status === 'error' ? 'error' : 'info');
    } else toast('Export cancelled');
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
  const blob = new Blob([JSON.stringify({app: 'bloom', version: 1, config: S.config}, null, 2)], {type: 'application/json'});
  const r = await saveFile(fileName() + '.bloom.json', blob, 'application/json');
  toast(r.message, r.status === 'error' ? 'error' : 'info');
}

export async function openProject(file) {
  if (!file) return;
  let p;
  try { p = JSON.parse(await file.text()); } catch (e) { p = null; }
  if (!p || p.app !== 'bloom' || typeof p.config !== 'object') return toast('That file is not a BLOOM project', 'error');
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
