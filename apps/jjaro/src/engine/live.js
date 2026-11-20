// JJARO's app state, the simulation loop, pointer handling and every action the UI
// takes. Engine code mutates S and calls emit(); React reads it through useStore().
import {useSyncExternalStore} from 'react';
import {toolStore} from '@studio/core';
import {parseColor, oklabToLinear} from '@studio/core/gradient';
import {Cloth, QUALITY} from './cloth.js';
import {lightDirs, PATTERN_IDS, PRINT_IDS} from './foil.js';
import {artFromFile, artFromData, artData, sampleArt} from './art.js';
import {createRenderer, frameCamera, screenRay, pickParticle, onViewPlane} from './renderer.js';
import {cleanConfig, DEFAULT_CONFIG, ASPECTS, REBUILD_KEYS} from './config.js';

export const saved = toolStore('jjaro');
const reduceMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

const stored = saved.get('config.v1', null);
export const S = {
  config: stored ? cleanConfig(stored) : cleanConfig(DEFAULT_CONFIG),
  playing: !reduceMotion,
  time: 0, // seconds of light motion
  supported: true,
  grabbing: false,
  art: null, // {canvas, name, custom, alpha, aspect}: what the print modes print
  toast: null, // set by the app: (message, kind) => void
};

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
  saveTimer = setTimeout(() => saved.set('config.v1', S.config), 250);
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
  const a = ASPECTS[S.config.aspect];
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
  if (!renderer || renderer.lost || !canvas || canvas.width < 2) return;
  cam = frameCamera(S.config, cloth.scene, canvas.width / canvas.height);
  cloth.normals();
  const c = S.config;
  renderer.render({
    cloth, cam, background: c.background.map(toRGB),
    foil: {
      tint: toLinear(c.tint), env: c.background.map(toLinear), rainbow: c.rainbow, spread: c.spread, spacing: c.spacing,
      scale: c.scale, angle: c.angle * Math.PI / 180, seed: (c.seed % 1000) * 0.37, pattern: PATTERN_IDS.indexOf(c.pattern),
      lights: c.lights, lightDirs: lightDirs(c, S.time, c.period), lightSize: c.lightSize,
    },
    print: {mode: PRINT_IDS.indexOf(c.print), art: S.art, size: c.artSize, invert: c.invert, paper: toLinear(c.paper), ink: c.ink},
  });
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
function setConfig(cfg) {
  const prev = S.config;
  S.config = cleanConfig(cfg);
  persist();
  if (REBUILD_KEYS.some(k => prev[k] !== S.config[k])) build(); else tune();
  if (prev.aspect !== S.config.aspect) fit(); else draw();
  emit();
}
/** Change one field (e.g. set('wind', 0.5)). */
export const set = (key, value) => setConfig({...S.config, [key]: value});
export const setBackground = (i, c) => { const background = S.config.background.slice(); background[i] = c; setConfig({...S.config, background}); };

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
