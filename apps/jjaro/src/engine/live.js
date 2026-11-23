// JJARO's app state, the simulation loop, pointer handling and every action the UI
// takes. Engine code mutates S and calls emit(); React reads it through useStore().
import {useSyncExternalStore} from 'react';
import {toolStore, saveFile, copyText, encodeFramesToMp4, canEncodeVideo} from '@studio/core';
import {parseColor, oklabToLinear} from '@studio/core/gradient';
import {Cloth, QUALITY, rng} from './cloth.js';
import {lightDirs, dropLayout, PATTERN_IDS, PRINT_IDS} from './foil.js';
import {artFromFile, artFromData, artData, sampleArt} from './art.js';
import {createRenderer, frameCamera, screenRay, pickParticle, onViewPlane, focusDistance, effectReach} from './renderer.js';
import {frameDims} from '@studio/core/frames';
import {cleanConfig, presetConfig, randomConfig, DEFAULT_CONFIG, PRESETS, aspectOf, REBUILD_KEYS} from './config.js';

export const saved = toolStore('jjaro');
const reduceMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- links ---------- */
// A link holds the settings (not the artwork, which is too big for a URL) as base64url JSON.
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
const fromLink = typeof location === 'undefined' ? null : configFromHash();
const stored = saved.get('config.v1', null);

export const S = {
  config: fromLink || (stored ? cleanConfig(stored) : presetConfig(PRESETS[0].id)),
  preset: fromLink ? '' : saved.get('preset', stored ? '' : PRESETS[0].id) || '',
  looks: (saved.get('looks.v1', []) || []).filter(l => l && typeof l.name === 'string' && l.config),
  playing: !reduceMotion,
  time: 0, // seconds of light motion
  supported: true,
  grabbing: false,
  exportSize: saved.get('exportSize', 2160), // PNG, long side
  videoSize: saved.get('videoSize', 1080), // MP4, long side
  loops: saved.get('loops', 1), // MP4 length, in light loops
  sway: saved.get('sway', true), // MP4: turn the camera gently
  transparent: saved.get('transparent', false), // PNG: no backdrop
  exporting: null, // {done, total} while an MP4 renders
  art: null, // {canvas, name, custom, alpha, aspect}: what the print modes print
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

let saveTimer = 0;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { saved.set('config.v1', S.config); saved.set('preset', S.preset); }, 250);
}

const encode = v => { v = Math.min(1, Math.max(0, v)); return v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055; };
const toLinear = c => oklabToLinear(parseColor(c) || [0, 0, 0]);
const toRGB = c => toLinear(c).map(encode);

/* ---------- the sheet ---------- */
let cloth = null;
function build() {
  const c = S.config;
  cloth = new Cloth({setup: c.setup, res: QUALITY[c.quality], seed: c.seed});
  tune();
  // Reduced motion: show the settled sheet rather than its fall.
  if (reduceMotion) for (let i = 0; i < 240; i++) cloth.advance(1 / 60);
}
function tune() {
  const c = S.config;
  Object.assign(cloth.params, {gravity: c.gravity, bend: c.stiffness, wind: c.wind});
}
build();

/* ---------- the artwork ---------- */
// A loaded image is kept in localStorage as a PNG data URL (it's capped at 1024 px, so
// it fits); if it doesn't fit, it lasts until the page closes.
function showArt(art) { S.art = art; draw(); emit(); }
if (typeof document !== 'undefined') {
  S.art = sampleArt();
  const kept = saved.get('art.v1', null);
  if (kept?.data) artFromData(kept.data, kept.name).then(showArt, () => {});
}

/** Load an image file as the artwork; switches to a kinegram if nothing prints yet. */
export async function loadArt(file) {
  try {
    const art = await artFromFile(file);
    if (!saved.set('art.v1', {data: artData(art), name: art.name})) S.toast?.('That image is too big to keep after the page closes', 'info');
    showArt(art);
    if (S.config.print === 'none') set('print', 'kinegram');
  } catch (e) {
    S.toast?.(e.message || 'That image could not be read', 'error');
  }
}
/** Go back to the sample artwork. */
export function clearArt() { saved.set('art.v1', null); showArt(sampleArt()); }

/* ---------- the canvas and the loop ---------- */
let renderer = null, canvas = null, resize = null, raf = 0, last = 0, cam = null;

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

// The droplets' layout only changes with these settings, so keep the last one.
let dropCache = {key: '', value: null};
function dropsFor(c) {
  const key = c.drops + '|' + c.dropSize + '|' + c.seed;
  if (dropCache.key !== key) dropCache = {key, value: c.drops > 0 ? dropLayout(c.drops, c.dropSize, c.seed, rng) : null};
  return dropCache.value;
}

/**
 * Everything the renderer needs for one frame of `sheet` (the live cloth or a frozen
 * copy) at `time` seconds of light motion. `orbit` turns the camera from the config's.
 */
function sceneFrame(c, sheet, time, aspect, {orbit = 0, transparent = false, frame = 0} = {}) {
  const camera = frameCamera(orbit ? {...c, orbit: c.orbit + orbit} : c, sheet.scene, aspect);
  return {
    cloth: sheet, cam: camera, background: c.background.map(toRGB),
    post: {glow: c.glow, blur: c.blur, focus: focusDistance(camera, sheet.pos, c.focus), grain: c.grain, frame, transparent},
    foil: {
      tint: toLinear(c.tint), env: c.background.map(toLinear), rainbow: c.rainbow, spread: c.spread, spacing: c.spacing,
      scale: c.scale, angle: c.angle * Math.PI / 180, seed: (c.seed % 1000) * 0.37, pattern: PATTERN_IDS.indexOf(c.pattern),
      lights: c.lights, lightDirs: lightDirs(orbit ? {...c, orbit: c.orbit + orbit} : c, time, c.period), lightSize: c.lightSize,
      drops: dropsFor(c),
    },
    print: {mode: PRINT_IDS.indexOf(c.print), art: S.art, size: c.artSize, invert: c.invert, paper: toLinear(c.paper), ink: c.ink},
  };
}

function draw() {
  if (!renderer || renderer.lost || !canvas || canvas.width < 2) return;
  const f = sceneFrame(S.config, cloth, S.time, canvas.width / canvas.height, {frame: Math.floor(S.time * 24)});
  cam = f.cam;
  renderer.render(f);
}

function tick(now) {
  raf = requestAnimationFrame(tick);
  const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
  last = now;
  if (!S.playing && !cloth.grab) return;
  if (S.playing) S.time += dt;
  cloth.advance(dt);
  draw();
}

/** Hand the stage canvas over (null to let go). */
export function attachCanvas(c) {
  resize?.disconnect();
  cancelAnimationFrame(raf);
  canvas = c;
  if (!c) { renderer?.dispose(); renderer = null; return; }
  try { renderer = createRenderer(c); }
  catch (e) { console.error(e); renderer = null; }
  S.supported = !!renderer;
  resize = new ResizeObserver(fit);
  resize.observe(c.parentElement);
  fit();
  last = 0;
  raf = requestAnimationFrame(tick);
  emit();
}

/* ---------- pointer: drag the cloth, orbit around it, pinch or scroll to zoom ---------- */
const pointers = new Map(); // id → {x, y} in CSS pixels
let mode = null; // 'grab' | 'orbit' | 'pinch'
let pinchFrom = 0, zoomFrom = 1;

/** -1..1 screen coordinates (y up) of a pointer over the canvas. */
function toNdc(ev) {
  const b = canvas.getBoundingClientRect();
  return [((ev.clientX - b.left) / b.width) * 2 - 1, 1 - ((ev.clientY - b.top) / b.height) * 2];
}

export function pointerDown(ev) {
  if (!canvas || !cam) return;
  canvas.setPointerCapture(ev.pointerId);
  pointers.set(ev.pointerId, {x: ev.clientX, y: ev.clientY});
  if (pointers.size === 2) {
    // A second finger turns whatever the first was doing into a pinch.
    cloth.grabEnd();
    const [a, b] = [...pointers.values()];
    mode = 'pinch'; pinchFrom = Math.hypot(a.x - b.x, a.y - b.y) || 1; zoomFrom = S.config.zoom;
    S.grabbing = false; emit();
    return;
  }
  if (pointers.size > 2) return;
  const [nx, ny] = toNdc(ev);
  const radius = ev.pointerType === 'touch' ? 0.09 : 0.05;
  const i = pickParticle(cam, cloth.pos, nx, ny, radius);
  if (i >= 0) {
    const p = [cloth.pos[i * 3], cloth.pos[i * 3 + 1], cloth.pos[i * 3 + 2]];
    cloth.grabStart(i, onViewPlane(cam, screenRay(cam, nx, ny), p));
    mode = 'grab'; S.grabbing = true; emit();
  } else mode = 'orbit';
}

export function pointerMove(ev) {
  const prev = pointers.get(ev.pointerId);
  if (!prev || !cam) return;
  const dx = ev.clientX - prev.x, dy = ev.clientY - prev.y;
  pointers.set(ev.pointerId, {x: ev.clientX, y: ev.clientY});
  if (mode === 'grab' && cloth.grab) {
    const [nx, ny] = toNdc(ev);
    cloth.grabMove(onViewPlane(cam, screenRay(cam, nx, ny), cloth.grab.target));
  } else if (mode === 'orbit') {
    const c = S.config;
    let orbit = c.orbit - dx * 0.35;
    orbit = ((orbit + 540) % 360) - 180;
    setView({orbit, elevation: Math.min(70, Math.max(-30, c.elevation + dy * 0.25))});
  } else if (mode === 'pinch' && pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    setView({zoom: Math.min(2.5, Math.max(0.6, zoomFrom * Math.hypot(a.x - b.x, a.y - b.y) / pinchFrom))});
  }
}

export function pointerUp(ev) {
  pointers.delete(ev.pointerId);
  if (mode === 'grab') { cloth.grabEnd(); S.grabbing = false; emit(); }
  mode = pointers.size ? mode : null;
  if (mode === 'pinch' && pointers.size < 2) mode = null;
}

export function wheel(ev) {
  ev.preventDefault();
  setView({zoom: Math.min(2.5, Math.max(0.6, S.config.zoom * Math.exp(-ev.deltaY * 0.0015)))});
}

/** Camera changes: no new sheet, and redraw now even when paused. */
function setView(patch) {
  S.config = {...S.config, ...patch};
  persist();
  draw();
  emit();
}

/* ---------- editing ---------- */
function setConfig(cfg, preset = '') {
  const prev = S.config;
  S.config = cleanConfig(cfg);
  S.preset = preset;
  persist();
  if (REBUILD_KEYS.some(k => prev[k] !== S.config[k])) build(); else tune();
  if (aspectOf(prev) !== aspectOf(S.config)) fit(); else draw();
  emit();
}
/** Change one field (e.g. set('wind', 0.5)). */
export const set = (key, value) => setConfig({...S.config, [key]: value});
export const setBackground = (i, c) => { const background = S.config.background.slice(); background[i] = c; setConfig({...S.config, background}); };

/** A preset or a whole new look: always a fresh sheet. */
export const applyPreset = id => { setConfig(presetConfig(id, S.config), id); reset(); };
export const randomize = () => { setConfig(randomConfig(S.config)); reset(); };

export function togglePlay() { S.playing = !S.playing; last = 0; emit(); }
/** Start the sheet over from its setup. */
export function reset() { build(); draw(); emit(); }
/** A new start from a different seed (a different heap, different pleats). */
export const reseed = () => set('seed', Math.floor(Math.random() * 1e9));
export function gust() {
  if (S.config.wind <= 0) return S.toast?.('Turn the wind up first', 'info');
  cloth.gust();
}
export function resetView() { setView({orbit: DEFAULT_CONFIG.orbit, elevation: DEFAULT_CONFIG.elevation, zoom: DEFAULT_CONFIG.zoom}); }

/* ---------- saved looks, project files and links ---------- */
const toast = (msg, kind = 'info') => S.toast?.(msg, kind);
const storeLooks = () => saved.set('looks.v1', S.looks);

export function saveLook(name) {
  name = String(name || '').trim().slice(0, 60);
  if (!name) return;
  const i = S.looks.findIndex(l => l.name.toLowerCase() === name.toLowerCase());
  const look = {name, config: S.config};
  if (i >= 0) S.looks[i] = look; else S.looks.push(look);
  storeLooks(); emit();
  toast(i >= 0 ? `Updated “${name}”` : `Saved “${name}”`);
}
export function applyLook(name) {
  const l = S.looks.find(x => x.name === name);
  if (l) { setConfig(l.config); reset(); }
}
export function deleteLook(name) { S.looks = S.looks.filter(l => l.name !== name); storeLooks(); emit(); }

const fileName = () => 'jjaro-' + (S.preset || S.config.setup) + '-' + S.config.seed;

/** A project file: the settings, plus the artwork when it's a loaded image. */
export async function saveProject() {
  const art = S.art?.custom ? {name: S.art.name, data: artData(S.art)} : null;
  const blob = new Blob([JSON.stringify({app: 'jjaro', version: 1, config: S.config, art}, null, 2)], {type: 'application/json'});
  const r = await saveFile(fileName() + '.jjaro.json', blob, 'application/json');
  toast(r.message, r.status === 'error' ? 'error' : 'info');
}

export async function openProject(file) {
  if (!file) return;
  let p;
  try { p = JSON.parse(await file.text()); } catch (e) { p = null; }
  if (!p || p.app !== 'jjaro' || typeof p.config !== 'object') return toast('That file is not a JJARO project', 'error');
  if (typeof p.art?.data === 'string') {
    try {
      const art = await artFromData(p.art.data, String(p.art.name || 'Artwork'));
      saved.set('art.v1', {data: p.art.data, name: art.name});
      S.art = art;
    } catch (e) { toast('The artwork in that project could not be read', 'error'); }
  }
  setConfig(p.config);
  reset();
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
    reset();
    toast('Opened the linked look');
  });
}

/* ---------- export ---------- */
// Exports draw with their own renderer and a frozen copy of the sheet as it is on the
// stage, so the stage keeps running and every frame shows the same folds.
let off = null, offCanvas = null, offAlpha = false, cancelExport = false;
function offscreen(w, h, alpha) {
  if (off && (off.lost || offAlpha !== alpha)) { off.dispose(); off = null; }
  if (!off) {
    offCanvas = document.createElement('canvas');
    off = createRenderer(offCanvas, {preserve: true, alpha});
    offAlpha = alpha;
  }
  offCanvas.width = w; offCanvas.height = h;
  return off;
}
const freeze = () => ({W: cloth.W, N: cloth.N, pos: cloth.pos.slice(), scene: cloth.scene});
const checkAlive = r => { if (r.lost) throw new Error('The graphics card reset during the render. Please try again.'); };

/** Width and height for a long side, in the frame's shape (even, for video). */
function dims(long) {
  return frameDims(S.config.aspect, aspectOf(S.config), long, [S.config.customW, S.config.customH]);
}

export function setExport(key, value) { S[key] = value; saved.set(key, value); emit(); }

const TILE = 2048;
/**
 * The frame at W × H. Up to one tile it draws in one go; bigger frames draw in tiles
 * into a 2D canvas, each padded by the blur and glow's reach so their edges match.
 */
function renderStill(W, H, sheet, transparent) {
  const c = S.config, frame = Math.floor(S.time * 24);
  if (W <= TILE && H <= TILE) {
    const r = offscreen(W, H, transparent);
    r.render(sceneFrame(c, sheet, S.time, W / H, {transparent, frame}));
    checkAlive(r);
    return offCanvas;
  }
  const out = document.createElement('canvas');
  out.width = W; out.height = H;
  const x2 = out.getContext('2d');
  if (!x2) throw new Error(`This browser cannot hold a ${W} × ${H} image. Try a smaller size.`);
  const f = sceneFrame(c, sheet, S.time, W / H, {transparent, frame});
  const pad = effectReach(f.post, W, H) + 2;
  for (let y = 0; y < H; y += TILE) {
    for (let x = 0; x < W; x += TILE) {
      const tw = Math.min(TILE, W - x), th = Math.min(TILE, H - y);
      const r = offscreen(tw + 2 * pad, th + 2 * pad, transparent);
      r.render({...f, view: {W, H, x: x - pad, y: y - pad}});
      checkAlive(r);
      x2.drawImage(offCanvas, pad, pad, tw, th, x, y, tw, th);
    }
  }
  return out;
}

export async function exportPNG() {
  try {
    const [w, h] = dims(S.exportSize);
    const c = renderStill(w, h, freeze(), S.transparent);
    const blob = await new Promise((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('PNG export failed'))), 'image/png'));
    const r = await saveFile(fileName() + '.png', blob, 'image/png');
    toast(r.message, r.status === 'error' ? 'error' : 'info');
  } catch (e) {
    console.error(e);
    toast('Could not save the image: ' + e.message, 'error');
  }
}

export const videoSupported = canEncodeVideo;
/** Seconds an MP4 covers: whole loops of the lights, so it loops cleanly. */
export const videoSeconds = () => S.config.period * S.loops;

export async function exportMP4() {
  if (S.exporting) return;
  const fps = 30, seconds = videoSeconds(), frames = Math.round(seconds * fps);
  const [w, h] = dims(S.videoSize);
  const sheet = freeze(), c = S.config, t0 = S.time;
  cancelExport = false;
  S.exporting = {done: 0, total: frames};
  emit();
  try {
    const r = offscreen(w, h, false);
    const {blob, codecNote} = await encodeFramesToMp4({
      width: w, height: h, fps, frames,
      drawFrame: i => {
        const t = i / fps;
        // The camera sways 6° each way once per video; the lights loop on their own period.
        r.render(sceneFrame(c, sheet, t0 + t, w / h, {orbit: S.sway ? 6 * Math.sin(2 * Math.PI * t / seconds) : 0, frame: Math.floor(t * 24)}));
        checkAlive(r);
        return offCanvas;
      },
      onProgress: ({frame, total}) => { if (frame % 4 === 0 || frame === total) { S.exporting = {done: frame, total}; emit(); } },
      isCancelled: () => cancelExport,
    });
    if (blob) {
      const res = await saveFile(fileName() + '.mp4', blob, 'video/mp4');
      toast(res.message + (res.status === 'error' ? '' : codecNote), res.status === 'error' ? 'error' : 'info');
    } else toast('Export cancelled');
  } catch (e) {
    console.error(e);
    toast(e.message || 'Could not make the video', 'error');
  } finally {
    S.exporting = null;
    emit();
  }
}
export function cancelMP4() { cancelExport = true; }
