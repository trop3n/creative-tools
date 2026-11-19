// LEELA's app state and the animation loop. Engine code mutates S and calls emit();
// React reads it through useStore().
import {useSyncExternalStore} from 'react';
import {toolStore} from '@studio/core';
import {createGradientRenderer, cleanConfig, presetConfig, randomConfig, PRESETS} from '@studio/core/gradient';

export const saved = toolStore('leela');

const reduceMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const stored = saved.get('config.v1', null);

export const S = {
  config: stored ? cleanConfig(stored) : presetConfig(PRESETS[0].id),
  preset: saved.get('preset', stored ? '' : PRESETS[0].id) || '',
  playing: !reduceMotion, // reduced motion: start on a still frame
  time: 0, // seconds of animation shown
  ms: 0, // GPU frame time, smoothed
  supported: true,
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
  if (!renderer || renderer.lost) return;
  const t0 = performance.now();
  renderer.render(S.config, S.time);
  S.ms = S.ms * 0.9 + (performance.now() - t0) * 0.1;
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

/* ---------- actions ---------- */
function setConfig(cfg, preset = '') {
  S.config = cfg;
  S.preset = preset;
  persist(); draw(); emit();
}
export const applyPreset = id => setConfig(presetConfig(id), id);
export const randomize = () => setConfig(randomConfig());
export function togglePlay() { S.playing = !S.playing; last = 0; emit(); }
export function restart() { S.time = 0; draw(); emit(); }
