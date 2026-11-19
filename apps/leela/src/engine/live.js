// LEELA's app state, the animation loop and every action the UI takes. Engine code
// mutates S and calls emit(); React reads it through useStore().
import {useSyncExternalStore} from 'react';
import {toolStore, saveFile, copyText} from '@studio/core';
import {
  createGradientRenderer, cleanConfig, presetConfig, randomConfig, spreadPoints, parseColor, oklabToHex,
  PRESETS, MAX_STOPS, MAX_POINTS,
} from '@studio/core/gradient';

export const saved = toolStore('leela');

const reduceMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** A config from the page address (#c=…), from a shared link. */
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
  playing: !reduceMotion, // reduced motion: start on a still frame
  time: 0, // seconds of animation shown
  handles: saved.get('handles', true) !== false,
  drag: -1, // mesh point being dragged (-2: the shape's center)
  supported: true,
  looks: (saved.get('looks.v1', []) || []).filter(l => l && typeof l.name === 'string' && l.config),
  toast: null, // set by the app: (message, kind) => void
};
// A shared link becomes the saved gradient, and the address goes back to plain, so a
// reload keeps the gradient and a later edit isn't undone by an old link.
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

/* ---------- the canvas and the loop ---------- */
let renderer = null, canvas = null, resize = null, raf = 0, last = 0, lastEmit = 0;

function fit() {
  if (!canvas) return;
  const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
  const w = Math.max(1, Math.round(canvas.clientWidth * dpr)), h = Math.max(1, Math.round(canvas.clientHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; draw(); }
}

function draw() {
  if (renderer && !renderer.lost) renderer.render(S.config, S.time);
}

function tick(now) {
  raf = requestAnimationFrame(tick);
  const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
  last = now;
  if (!S.playing) return;
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
  try { renderer = createGradientRenderer(c); }
  catch (e) { console.error(e); renderer = null; }
  S.supported = !!renderer;
  resize = new ResizeObserver(fit);
  resize.observe(c);
  fit(); draw();
  last = 0;
  raf = requestAnimationFrame(tick);
  emit();
}

/* ---------- editing the config ---------- */
function setConfig(cfg, preset = '') {
  S.config = cleanConfig(cfg);
  S.preset = preset;
  persist(); draw(); emit();
}
/** Change one field (e.g. set('warp', 0.4)). */
export const set = (key, value) => setConfig({...S.config, [key]: value});
/** Change one half of a pair field (center, size). */
export const setPair = (key, i, value) => { const p = S.config[key].slice(); p[i] = value; set(key, p); };

export const applyPreset = id => setConfig(presetConfig(id), id);
export const randomize = () => setConfig(randomConfig());
export const reseed = () => set('seed', Math.floor(Math.random() * 1e9));
export function togglePlay() { S.playing = !S.playing; last = 0; emit(); }
export function restart() { S.time = 0; draw(); emit(); }
export function toggleHandles() { S.handles = !S.handles; saved.set('handles', S.handles); emit(); }

/** Colors are stored as written; pickers want hex. */
export const asHex = c => { const lab = parseColor(c); return lab ? oklabToHex(lab) : '#000000'; };

export function setShape(shape) {
  const cfg = {...S.config, shape};
  // Mesh with no points yet: spread the palette (and background) over the frame.
  if (shape === 'mesh' && !cfg.mesh.length) {
    const colors = [...cfg.palette, cfg.background].slice(0, 6);
    cfg.mesh = spreadPoints(Math.random, colors.length).map(([x, y], i) => ({x: +x.toFixed(3), y: +y.toFixed(3), color: colors[i]}));
  }
  setConfig(cfg);
}

/* palette */
export const setStop = (i, color) => { const p = S.config.palette.slice(); p[i] = color; set('palette', p); };
export function addStop() {
  const p = S.config.palette;
  if (p.length >= MAX_STOPS) return;
  set('palette', [...p, p[p.length - 1]]);
}
export function removeStop(i) {
  const p = S.config.palette;
  if (p.length <= 2) return;
  set('palette', p.filter((_, k) => k !== i));
}
export const reversePalette = () => set('palette', S.config.palette.slice().reverse());

/* mesh points */
export const setPoint = (i, patch) => set('mesh', S.config.mesh.map((p, k) => (k === i ? {...p, ...patch} : p)));
export function addPoint() {
  const m = S.config.mesh;
  if (m.length >= MAX_POINTS) return;
  // Put it in the emptiest spot among a few candidates.
  let best = [0.5, 0.5], bestGap = -1;
  for (let k = 0; k < 24; k++) {
    const c = [0.1 + 0.8 * Math.random(), 0.1 + 0.8 * Math.random()];
    const gap = Math.min(...m.map(p => Math.hypot(p.x - c[0], p.y - c[1])), 9);
    if (gap > bestGap) { bestGap = gap; best = c; }
  }
  const colors = S.config.palette;
  set('mesh', [...m, {x: +best[0].toFixed(3), y: +best[1].toFixed(3), color: colors[m.length % colors.length]}]);
}
export const removePoint = i => { if (S.config.mesh.length > 2) set('mesh', S.config.mesh.filter((_, k) => k !== i)); };

/* ---------- dragging on the canvas ---------- */
const HIT = 28; // css px
function local(ev) {
  const b = canvas.getBoundingClientRect();
  return {x: (ev.clientX - b.left) / b.width, y: (ev.clientY - b.top) / b.height, w: b.width, h: b.height};
}
const clamp01 = v => Math.min(1, Math.max(0, v));

export function pointerDown(ev) {
  if (!canvas) return;
  const p = local(ev);
  let pick = -1, best = HIT;
  if (S.config.shape === 'mesh') {
    S.config.mesh.forEach((pt, i) => { const d = Math.hypot((pt.x - p.x) * p.w, (pt.y - p.y) * p.h); if (d < best) { best = d; pick = i; } });
  } else if (Math.hypot((S.config.center[0] - p.x) * p.w, (S.config.center[1] - p.y) * p.h) < HIT * 1.5) {
    pick = -2;
  }
  if (pick === -1) return;
  ev.preventDefault();
  canvas.setPointerCapture(ev.pointerId);
  S.drag = pick;
  emit();
}
export function pointerMove(ev) {
  if (S.drag === -1 || !canvas?.hasPointerCapture(ev.pointerId)) return;
  const p = local(ev), x = +clamp01(p.x).toFixed(4), y = +clamp01(p.y).toFixed(4);
  if (S.drag === -2) set('center', [x, y]);
  else setPoint(S.drag, {x, y});
}
export function pointerUp() { if (S.drag !== -1) { S.drag = -1; emit(); } }

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
  if (l) setConfig(l.config);
}
export function deleteLook(name) { S.looks = S.looks.filter(l => l.name !== name); storeLooks(); emit(); }

const fileName = () => 'leela-' + (S.preset || S.config.shape) + '-' + S.config.seed;

export async function saveProject() {
  const blob = new Blob([JSON.stringify({app: 'leela', version: 1, config: S.config}, null, 2)], {type: 'application/json'});
  const res = await saveFile(fileName() + '.leela.json', blob, 'application/json');
  toast(res.message, res.status === 'error' ? 'error' : 'info');
}

export async function openProject(file) {
  if (!file) return;
  let p;
  try { p = JSON.parse(await file.text()); } catch (e) { p = null; }
  if (!p || p.app !== 'leela' || typeof p.config !== 'object') return toast('That file is not a LEELA project', 'error');
  setConfig(p.config);
  toast('Opened ' + file.name);
}

/** Copy a link that opens LEELA with this gradient. */
export async function copyLink() {
  const bytes = new TextEncoder().encode(JSON.stringify(S.config));
  const b64 = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const url = location.origin + location.pathname + '#c=' + b64;
  toast((await copyText(url)) ? 'Link copied' : 'Could not copy the link', 'info');
}
