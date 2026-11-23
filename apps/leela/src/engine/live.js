// LEELA's app state, the animation loop and every action the UI takes. Engine code
// mutates S and calls emit(); React reads it through useStore().
import {useSyncExternalStore} from 'react';
import {toolStore, saveFile, copyText, encodeFramesToMp4, canEncodeVideo, putHandoff} from '@studio/core';
import {
  createGradientRenderer, cleanConfig, presetConfig, randomConfig, spreadPoints, parseColor, oklabToHex,
  PRESETS, MAX_STOPS, MAX_POINTS, effectCell,
} from '@studio/core/gradient';
import {createGpuDither, ditherRGBA, paintIndices, paintMask, STYLE_BY_ID, defaultParams, MAX_COLORS} from '@studio/core/dither';
import {LED_WALL, cleanSide} from '@studio/core/frames';

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
  // Export settings (kept) and progress (not kept).
  out: {size: '1080p', w: 1920, h: 1080, fps: 30, seconds: 6, loops: 1, ...(saved.get('out.v1', {}) || {})},
  exporting: false,
  progress: '',
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
let fxCanvas = null; // the stage's dither layer, over the gradient

/* ---------- the dither effect (DURANDAL's engine) ---------- */
const byLightness = colors => colors.slice().sort((a, b) => parseColor(a)[0] - parseColor(b)[0]);

/** The gradient's colors (ramp or mesh points, plus the backdrop) as hex, darkest first, at most 16. */
export function gradientColors(cfg = S.config) {
  const src = cfg.shape === 'mesh' ? cfg.mesh.map(p => p.color) : cfg.palette;
  return byLightness([...new Set([cfg.background, ...src].map(asHex))]).slice(0, MAX_COLORS);
}

/** DURANDAL settings for the dither effect at a given cell size. */
function ditherSettings(cfg, cell) {
  const style = STYLE_BY_ID[cfg.ditherStyle];
  const base = {style: style.id, params: defaultParams(style), block: cell, threshold: 50, strength: 100, black: 100, invert: false};
  const colors = gradientColors(cfg);
  if (cfg.ditherColors === 'cmyk') return {...base, mode: 'cmyk'};
  if (cfg.ditherColors === 'two') return {...base, mode: 'mono', ink: colors[0], paper: colors[colors.length - 1]};
  return {...base, mode: 'palette', colors: colors.length >= 2 ? colors : [colors[0], '#ffffff']};
}

let dgpu; // DURANDAL's GPU engine, made on first use (null if unavailable)
let readback = null, painted = null;

/**
 * Dither a rendered w×h frame. Returns a canvas of the cells blown up to whole
 * pixels (a little smaller than w×h when w or h isn't a multiple of the cell).
 * Pattern styles run on DURANDAL's GPU path; diffusion styles on the CPU.
 */
function ditherFrame(src, w, h, cfg) {
  const cell = effectCell(cfg, w, h), st = ditherSettings(cfg, cell);
  if (dgpu && dgpu.lost) dgpu = undefined; // lost (GPU reset): make it again
  if (dgpu === undefined) { try { dgpu = createGpuDither(); } catch (e) { dgpu = null; } }
  if (dgpu && dgpu.supports(st, w, h)) {
    dgpu.setSource(src, false);
    dgpu.render(st);
    dgpu.present(dgpu.colors || [st.ink, st.paper], cell);
    return dgpu.canvas;
  }
  // CPU: read the frame back, dither it, paint the cells at full size.
  if (!readback) readback = document.createElement('canvas');
  if (readback.width !== w || readback.height !== h) { readback.width = w; readback.height = h; }
  const rx = readback.getContext('2d', {willReadFrequently: true});
  rx.drawImage(src, 0, 0);
  const r = ditherRGBA(rx.getImageData(0, 0, w, h).data, w, h, st);
  const W = r.w * cell, H = r.h * cell;
  const px = r.colors ? paintIndices(r.indices, r.w, r.h, W, H, r.colors) : paintMask(r.mask, r.w, r.h, W, H, st.ink, st.paper);
  if (!painted) painted = document.createElement('canvas');
  if (painted.width !== W || painted.height !== H) { painted.width = W; painted.height = H; }
  painted.getContext('2d').putImageData(new ImageData(px, W, H), 0, 0);
  return painted;
}

/** Dither `src` and draw it onto `out` (w×h), backdrop showing in any sliver the cells don't cover. */
function composeDither(src, out, w, h, cfg) {
  const d = ditherFrame(src, w, h, cfg);
  const x = out.getContext('2d');
  x.imageSmoothingEnabled = false;
  x.fillStyle = gradientColors(cfg)[0];
  x.fillRect(0, 0, w, h);
  x.drawImage(d, 0, 0);
  return out;
}

function fit() {
  if (!canvas) return;
  const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
  const w = Math.max(1, Math.round(canvas.clientWidth * dpr)), h = Math.max(1, Math.round(canvas.clientHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; draw(); }
}

/* ---------- hover ---------- */
// The pointer, eased: position glides after it and the bend fades in and out, so
// the picture never jumps. Exports leave it out.
const hover = {x: 0.5, y: 0.5, tx: 0.5, ty: 0.5, on: 0, target: 0};

function hoverStep(dt) {
  const k = 1 - Math.exp(-dt * 12), f = 1 - Math.exp(-dt * 5);
  hover.x += (hover.tx - hover.x) * k;
  hover.y += (hover.ty - hover.y) * k;
  hover.on += (hover.target - hover.on) * f;
  return Math.abs(hover.tx - hover.x) > 1e-4 || Math.abs(hover.ty - hover.y) > 1e-4 || Math.abs(hover.target - hover.on) > 1e-3;
}
const hoverArg = () => (S.config.hover > 0 && hover.on > 0.002
  ? [hover.x, hover.y, (S.config.hoverMode === 'pull' ? 1 : -1) * S.config.hover * hover.on]
  : null);

function draw() {
  if (!renderer || renderer.lost) return;
  renderer.render(S.config, S.time, null, hoverArg());
  if (S.config.effect === 'dither' && fxCanvas) {
    const w = canvas.width, h = canvas.height;
    if (fxCanvas.width !== w || fxCanvas.height !== h) { fxCanvas.width = w; fxCanvas.height = h; }
    try { composeDither(canvas, fxCanvas, w, h, S.config); }
    catch (e) { console.error(e); }
  }
}

/** The stage's dither layer (null to let go). */
export function attachFx(c) { fxCanvas = c; draw(); }

function tick(now) {
  raf = requestAnimationFrame(tick);
  const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
  last = now;
  const easing = hoverStep(dt) && S.config.hover > 0;
  if (!S.playing) { if (easing) draw(); return; }
  S.time += dt;
  draw();
  if (now - lastEmit > 250) { lastEmit = now; emit(); }
}

/** Hand the stage canvas over (null to let go). */
let rendererCanvas = null; // the canvas `renderer` draws on

function makeRenderer(c) {
  try { renderer = createGradientRenderer(c); }
  catch (e) { console.error(e); renderer = null; }
  rendererCanvas = c;
  S.supported = !!renderer;
}

export function attachCanvas(c) {
  resize?.disconnect();
  cancelAnimationFrame(raf);
  canvas = c;
  // Letting go keeps the renderer: React's StrictMode lets go and takes the same
  // canvas back, and disposing would have lost its WebGL context for good.
  if (!c) return;
  if (rendererCanvas !== c) {
    if (renderer) renderer.dispose();
    makeRenderer(c);
    // If the GPU resets, ask for the context back and rebuild when it returns.
    c.addEventListener('webglcontextlost', e => e.preventDefault());
    c.addEventListener('webglcontextrestored', () => { makeRenderer(c); draw(); emit(); });
  }
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
  if (!S.playing) draw(); // while playing, the next frame shows it (drawing here too would double the work)
  persist(); emit();
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
  if (!canvas || !S.handles) return; // hidden handles can't be grabbed
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
  if (S.drag === -1 || !canvas?.hasPointerCapture(ev.pointerId)) {
    // Not dragging a handle: the pointer is just passing over, for hover.
    if (!canvas || ev.pointerType === 'touch' && ev.buttons === 0) return;
    const p = local(ev);
    if (hover.on < 0.01) { hover.x = clamp01(p.x); hover.y = clamp01(p.y); }
    hover.tx = clamp01(p.x); hover.ty = clamp01(p.y); hover.target = 1;
    return;
  }
  hover.target = 0;
  const p = local(ev), x = +clamp01(p.x).toFixed(4), y = +clamp01(p.y).toFixed(4);
  if (S.drag === -2) set('center', [x, y]);
  else setPoint(S.drag, {x, y});
}
export function pointerUp() { if (S.drag !== -1) { S.drag = -1; emit(); } }
export function pointerLeave() { hover.target = 0; }

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

/* ---------- export ---------- */
export const SIZES = [
  {id: 'stage', label: 'Same as the stage'},
  {id: '1080p', label: '1920 × 1080', w: 1920, h: 1080},
  {id: '4k', label: '3840 × 2160 (4K)', w: 3840, h: 2160},
  {id: 'square', label: '1080 × 1080', w: 1080, h: 1080},
  {id: 'portrait', label: '1080 × 1920 (portrait)', w: 1080, h: 1920},
  {id: LED_WALL.id, label: `${LED_WALL.w} × ${LED_WALL.h} (LED wall)`, w: LED_WALL.w, h: LED_WALL.h},
  {id: 'custom', label: 'Custom'},
];
export const MAX_SIDE = 8192;

export function setOut(patch) {
  Object.assign(S.out, patch);
  saved.set('out.v1', S.out);
  emit();
}

/** The export size in pixels. */
export function outSize() {
  const o = S.out, preset = SIZES.find(z => z.id === o.size);
  if (preset?.w) return {w: preset.w, h: preset.h};
  if (o.size === 'stage' && canvas) return {w: canvas.width, h: canvas.height};
  return {w: cleanSide(o.w, 1920), h: cleanSide(o.h, 1080)}; // whole, even, 16–8192 px
}

/** Seconds and frames a video export will have (a whole number of loops when looping). */
export function videoPlan() {
  const o = S.out, loop = S.config.motion !== 'none' && S.config.loop > 0 ? S.config.loop : 0;
  const seconds = loop ? loop * Math.max(1, o.loops) : o.seconds;
  return {seconds, frames: Math.round(seconds * o.fps), loop};
}

// A second renderer for exports, so the stage keeps its own size.
let off = null;
function offscreen(w, h) {
  if (off && off.lost) off = null; // lost (GPU reset): start a fresh one
  if (!off) off = createGradientRenderer(document.createElement('canvas'));
  if (!off) throw new Error('This browser cannot draw with WebGL2');
  off.canvas.width = w; off.canvas.height = h;
  const gl = off.gl;
  if (gl.drawingBufferWidth !== w || gl.drawingBufferHeight !== h) {
    throw new Error(`This graphics card can draw at most ${gl.drawingBufferWidth} × ${gl.drawingBufferHeight}. Try a smaller size.`);
  }
  return off;
}

const pngBlob = c => new Promise((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('PNG export failed'))), 'image/png'));

const TILE = 2048;

/** The renderer reset under us (GPU reset, too many contexts): stop rather than save blank frames. */
const checkAlive = r => { if (r.lost) throw new Error('The graphics card reset during the render. Please try again.'); };

/**
 * The gradient at w×h, for a config snapshot. Up to one tile it draws in one go;
 * bigger frames draw tile by tile into a plain 2D canvas (`into`, reused if given),
 * which keeps the GPU's buffers small (one huge WebGL buffer can stall or fail
 * without a word).
 */
function renderGradient(cfg, w, h, time, into = null) {
  if (w <= TILE && h <= TILE) { const r = offscreen(w, h); r.render(cfg, time); checkAlive(r); return r.canvas; }
  const out = into || document.createElement('canvas');
  if (out.width !== w || out.height !== h) { out.width = w; out.height = h; }
  const x2 = out.getContext('2d');
  if (!x2) throw new Error(`This browser cannot hold a ${w} × ${h} image. Try a smaller size.`);
  for (let y = 0; y < h; y += TILE) {
    for (let x = 0; x < w; x += TILE) {
      const tw = Math.min(TILE, w - x), th = Math.min(TILE, h - y), r = offscreen(tw, th);
      r.render(cfg, time, {x, y, width: w, height: h});
      checkAlive(r);
      x2.drawImage(r.canvas, x, y);
    }
  }
  return out;
}

/** The finished frame (gradient, then the dither effect if it's on). */
function renderFrame(cfg, w, h, time, bufs = {}) {
  const g = renderGradient(cfg, w, h, time, bufs.tiles);
  if (g !== offCanvas()) bufs.tiles = g;
  if (cfg.effect !== 'dither') return g;
  if (!bufs.out) bufs.out = document.createElement('canvas');
  if (bufs.out.width !== w || bufs.out.height !== h) { bufs.out.width = w; bufs.out.height = h; }
  return composeDither(g, bufs.out, w, h, cfg);
}
const offCanvas = () => off && off.canvas;

async function renderPNG() {
  const {w, h} = outSize();
  return {blob: await pngBlob(renderFrame(S.config, w, h, S.time)), name: `${fileName()}-${w}x${h}.png`};
}

/** Save the frame on screen as a PNG at the export size. */
export async function exportPNG() {
  try {
    const {blob, name} = await renderPNG();
    const res = await saveFile(name, blob, 'image/png');
    toast(res.message, res.status === 'error' ? 'error' : 'info');
  } catch (e) {
    toast(e.message, 'error');
  }
}

let cancelExport = false;
export function cancelVideo() { cancelExport = true; }

async function renderMP4() {
  const {w, h} = outSize(), {frames} = videoPlan(), fps = S.out.fps;
  const W = Math.floor(w / 2) * 2, H = Math.floor(h / 2) * 2; // video needs even sizes
  // The gradient as it is now: edits made during the render don't leak into it.
  const cfg = S.config, bufs = {}, name = `${fileName()}-${W}x${H}-${fps}fps.mp4`;
  cancelExport = false;
  S.exporting = true; S.progress = 'Starting…'; emit();
  try {
    let lastEmit = 0;
    const res = await encodeFramesToMp4({
      width: W, height: H, fps, frames,
      // Frame i shows time i / fps from the start, so a loop's last frame leads into its first.
      drawFrame: i => renderFrame(cfg, W, H, i / fps, bufs),
      onProgress: p => { S.progress = p.phase; const now = performance.now(); if (now - lastEmit > 200) { lastEmit = now; emit(); } },
      isCancelled: () => cancelExport,
    });
    return res.cancelled ? null : {blob: res.blob, name};
  } finally {
    S.exporting = false; S.progress = ''; emit();
  }
}

/** Render the animation to MP4 offline, frame by frame. */
export async function exportMP4() {
  if (!canEncodeVideo()) return toast('This browser cannot encode video. Use Chrome or Edge.', 'error');
  try {
    const out = await renderMP4();
    if (!out) return toast('Render canceled');
    const res = await saveFile(out.name, out.blob, 'video/mp4');
    toast(res.message, res.status === 'error' ? 'error' : 'info');
  } catch (e) {
    toast(e.message, 'error');
  }
}

/**
 * Open the frame (kind 'image') or the animation (kind 'video') in DURANDAL as its
 * source. Both tools share one site, so the file waits in the browser for it.
 */
/**
 * Whether DURANDAL sits next to LEELA (the built suite: /leela/ beside /durandal/,
 * one origin). Dev servers and the single-file build run alone, so the hand-off
 * has nowhere to go.
 */
export const canSendToDurandal = () => /\/leela\/?$/.test(location.pathname) && !import.meta.env?.DEV;

export async function sendToDurandal(kind) {
  // Open the tab now, while the click still counts as the person's, then point it there.
  const tab = window.open('', '_blank');
  try {
    const out = kind === 'video' ? await renderMP4() : await renderPNG();
    if (!out) { tab?.close(); return toast('Render canceled'); }
    await putHandoff(out.blob, out.name, 'leela');
    const url = new URL('../durandal/?from=leela', location.href).href;
    if (tab) tab.location.href = url; else location.href = url;
  } catch (e) {
    tab?.close();
    toast(e.message, 'error');
  }
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
