// Rendering: the GPU path for pattern styles, the worker round trip for the rest,
// painting, settings and still export.
import {makeCanvas, saveFile, slug, frameCanvasFor, drawVideoFrame} from '@studio/core';
import {paintMask, paintIndices, indicesToSVG, maskToSVG, adaptivePalette, PALETTE_BY_ID, MAX_COLORS, STYLE_BY_ID, createGpuDither} from '@studio/core/dither';
import DitherWorker from './dither.worker.js?worker&inline';
import {S, emit, persist, toast, currentParams} from './state.js';

const worker = new DitherWorker();
let jobId = 0;
let shown = 0; // id of the job whose result is on screen; older results are dropped
const jobs = new Map(); // worker job id -> {resolve, reject}
let pending = false; // a settings change arrived while the worker was busy
let canvas = null; // the preview canvas on the stage (one pixel per cell)
let mirror = null; // optional scaled copy of the preview, for live recording
const idleWaiters = [];

// The last source frame: a canvas (images, samples) or a video element (files, webcam).
let src = null; // {el, mirror}
let workerHasIt = false; // the worker holds this frame's pixels
let gpuHasIt = false; // the GPU texture holds this frame
let frame = null; // video frames for the worker, at most 1280 on the long side

/* ---------- GPU ---------- */
let gpu = null;
let gpuFailures = 0;
try {
  gpu = createGpuDither();
  gpu?.canvas.addEventListener('webglcontextlost', () => {
    gpu = null;
    toast('The GPU dropped out. Using the CPU from here.', 'error');
    schedule();
  });
} catch (e) {
  console.warn('DURANDAL: no GPU path', e);
  gpu = null;
}
export const gpuAvailable = () => !!gpu;

const sourceSize = el => [el.videoWidth || el.width, el.videoHeight || el.height];
const isVideo = el => 'videoWidth' in el;

function onGpu(settings) {
  if (!gpu || S.look.gpu === false || !src) return false;
  const [w, h] = sourceSize(src.el);
  return gpu.supports(settings, w, h);
}

/* ---------- palettes ---------- */
let imageColorsFor = null; // the source element S.look.imageColors were picked from

/** Pick the palette from the current source (median cut on a small copy). */
export function pickImageColors() {
  if (!src) return;
  const [w, h] = sourceSize(src.el);
  if (!w || !h) return;
  const k = Math.min(1, 160 / Math.max(w, h)), c = makeCanvas(Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k)));
  const x = c.getContext('2d', {willReadFrequently: true});
  x.drawImage(src.el, 0, 0, c.width, c.height);
  S.look.imageColors = adaptivePalette(x.getImageData(0, 0, c.width, c.height).data, c.width, c.height, S.look.imageCount);
  imageColorsFor = src.el;
  persist();
}

/** The colors the current palette setting stands for. */
export function paletteColors({pick = true} = {}) {
  const id = S.settings.palette;
  if (id === 'image') {
    // Colors follow the source: pick again when it changes (pick: false just reads them).
    if (pick && (imageColorsFor !== (src && src.el) || !S.look.imageColors.length)) pickImageColors();
    return S.look.imageColors.length >= 2 ? S.look.imageColors : PALETTE_BY_ID.gray4.colors;
  }
  if (id === 'custom') return S.look.custom.slice(0, MAX_COLORS);
  return (PALETTE_BY_ID[id] || PALETTE_BY_ID.brand).colors;
}

/** Settings as the engines take them: current style params, palette colors resolved. */
const jobSettings = () => {
  const st = {...S.settings, params: currentParams()};
  if (st.mode === 'palette') st.colors = paletteColors();
  return st;
};

export const isBusy = () => jobs.size > 0;
/** Resolves once the worker has nothing in flight. */
export const idle = () => (jobs.size ? new Promise(r => idleWaiters.push(r)) : Promise.resolve());

function show(job, result) {
  if (job < shown) return false;
  shown = job;
  S.result = result;
  paint();
  return true;
}

/**
 * Dither once. Pass a source (canvas, or video element for its current frame) to
 * use new pixels; omit it to re-dither the last source with the current settings.
 * Resolves with that job's result after it has been painted.
 */
export function renderNow(el, {mirror: flip = false} = {}) {
  if (el) { src = {el, mirror: flip}; workerHasIt = gpuHasIt = false; }
  if (!src) return Promise.reject(new Error('No image loaded yet'));
  const job = ++jobId;
  const settings = jobSettings();

  if (onGpu(settings)) {
    try {
      const t0 = performance.now();
      if (!gpuHasIt) { gpu.setSource(src.el, src.mirror); gpuHasIt = true; }
      const {w, h} = gpu.render(settings);
      const gen = gpu.generation, colors = gpu.colors;
      let bits = null;
      // Read back only when something needs the bits (export without the GPU, tests).
      const read = f => bits || (gpu && gpu.generation === gen ? (bits = f()) : null);
      const result = colors
        ? {w, h, ms: performance.now() - t0, gpu: true, gen, colors, get indices() { return read(() => gpu.readIndices()); }}
        : {w, h, ms: performance.now() - t0, gpu: true, gen, get mask() { return read(() => gpu.readMask()); }};
      gpuFailures = 0;
      show(job, result);
      return Promise.resolve(result);
    } catch (e) {
      // Fall back to the CPU for this frame; give up on the GPU if it keeps failing.
      console.warn('DURANDAL: GPU render failed, using the CPU', e);
      if (++gpuFailures >= 3) gpu = null;
    }
  }

  return new Promise((resolve, reject) => {
    const msg = {job, settings};
    const transfer = [];
    if (!workerHasIt) {
      let c = src.el;
      if (isVideo(c)) {
        const [w, h] = sourceSize(c), want = frameCanvasFor(c, 1280);
        if (!frame || frame.width !== want.width || frame.height !== want.height) frame = want;
        if (w && h) drawVideoFrame(c, frame, src.mirror);
        c = frame;
      }
      const rgba = c.getContext('2d', {willReadFrequently: true}).getImageData(0, 0, c.width, c.height).data;
      Object.assign(msg, {rgba, w: c.width, h: c.height});
      transfer.push(rgba.buffer);
      workerHasIt = true;
    }
    jobs.set(job, {resolve, reject});
    pending = false;
    if (!S.busy) { S.busy = true; emit(); }
    worker.postMessage(msg, transfer);
  });
}

/** Re-dither after a settings change. Bursts (slider drags) collapse into one job at a time. */
let gpuQueued = false;
export function schedule() {
  if (!src) return;
  if (onGpu(jobSettings())) {
    // Cheap, but a drag can fire faster than frames: once per animation frame is plenty.
    if (gpuQueued) return;
    gpuQueued = true;
    requestAnimationFrame(() => { gpuQueued = false; renderNow().catch(() => {}); });
    return;
  }
  if (jobs.size) { pending = true; return; }
  renderNow().catch(() => {});
}

worker.onmessage = ({data}) => {
  const job = jobs.get(data.job);
  jobs.delete(data.job);
  if (data.type === 'done') {
    const result = data.indices
      ? {indices: data.indices, colors: data.colors, w: data.w, h: data.h, ms: data.ms}
      : {mask: data.mask, w: data.w, h: data.h, ms: data.ms};
    show(data.job, result);
    job?.resolve(result);
  } else {
    toast(data.message, 'error');
    job?.reject(new Error(data.message));
  }
  if (jobs.size) return;
  if (pending) return schedule();
  S.busy = false;
  idleWaiters.splice(0).forEach(r => r());
  emit();
};

/* ---------- painting ---------- */
export function setCanvas(c) { canvas = c; paint(); }
export const getCanvas = () => canvas;

/** Keep a scaled copy of every painted frame on `c` (null to stop). Used for recording. */
export function setMirror(c) { mirror = c; if (c) paint(); }

const isLiveGpu = r => r && r.gpu && gpu && gpu.generation === r.gen;
/** Index → color for a result: its palette, or [ink, paper] for two tones. */
const colorsOf = r => r.colors || [S.look.ink, S.look.paper];

/** A CPU result (or a read-back GPU one) painted as RGBA at outW×outH; null if its bits are gone. */
function pixels(r, outW, outH) {
  if (r.colors) return r.indices ? paintIndices(r.indices, r.w, r.h, outW, outH, r.colors) : null;
  return r.mask ? paintMask(r.mask, r.w, r.h, outW, outH, S.look.ink, S.look.paper) : null;
}

/** Paint the last result at cell resolution; CSS scales it up with hard edges. */
export function paint() {
  const r = S.result;
  if (!canvas || !r) return emit();
  if (canvas.width !== r.w || canvas.height !== r.h) { canvas.width = r.w; canvas.height = r.h; }
  const x = canvas.getContext('2d');
  if (isLiveGpu(r)) {
    gpu.present(colorsOf(r), 1);
    x.drawImage(gpu.canvas, 0, 0);
  } else {
    const px = pixels(r, r.w, r.h);
    if (!px) return emit(); // a GPU result whose engine has gone; the CPU result is on its way
    x.putImageData(new ImageData(px, r.w, r.h), 0, 0);
  }
  if (mirror) {
    const m = mirror.getContext('2d');
    m.imageSmoothingEnabled = false;
    m.drawImage(canvas, 0, 0, mirror.width, mirror.height);
  }
  emit();
}

/** The last result painted at `k` device pixels per cell. */
export function scaledOutput(k, into, r = S.result) {
  const w = r.w * k, h = r.h * k;
  const out = into && into.width === w && into.height === h ? into : makeCanvas(w, h);
  const x = out.getContext('2d');
  if (isLiveGpu(r)) {
    // Scale on the GPU and copy across: no read-back of the mask.
    gpu.present(colorsOf(r), k);
    x.drawImage(gpu.canvas, 0, 0);
  } else {
    const px = pixels(r, w, h);
    if (px) x.putImageData(new ImageData(px, w, h), 0, 0);
  }
  return out;
}

/** Whole-number scale that brings the long side as close to `maxSide` as it can without passing it. */
export const fitScale = (r, maxSide) => Math.max(1, Math.floor(maxSide / Math.max(r.w, r.h)));

/* ---------- settings ---------- */
export function setSetting(key, value) {
  S.settings[key] = value;
  persist(); schedule(); emit();
}
export function setParam(key, value) {
  const id = S.settings.style;
  S.paramsByStyle[id] = {...(S.paramsByStyle[id] || {}), [key]: value};
  persist(); schedule(); emit();
}
export function setStyle(id) {
  if (STYLE_BY_ID[id]) setSetting('style', id);
}
export function setLook(key, value) {
  S.look[key] = value;
  persist();
  if (key === 'ink' || key === 'paper') paint();
  else if (key === 'gpu' || key === 'custom') { schedule(); emit(); }
  else emit();
}
/** Colors-from-image: how many, or pick them again from the current frame. */
export function setImageCount(n) {
  S.look.imageCount = n;
  pickImageColors(); schedule(); emit();
}
export function repickImageColors() { pickImageColors(); schedule(); emit(); }

/** Edit the custom palette (starts as a copy of whatever palette is showing). */
export function editCustom(colors) {
  S.look.custom = colors.slice(0, MAX_COLORS);
  S.settings.palette = 'custom';
  persist(); schedule(); emit();
}

export function resetTone() {
  Object.assign(S.settings, {brightness: 0, contrast: 0, midtones: 0, highlights: 0, shadows: 0, blur: 0});
  persist(); schedule(); emit();
}

/* ---------- still export ---------- */
export const fileBase = () => {
  const m = S.media;
  const name = m.kind === 'image' || m.kind === 'video' ? m.label.replace(/\.[^.]+$/, '') : m.kind === 'camera' ? 'webcam' : S.look.sample;
  return `durandal-${slug(name)}-${S.settings.style}`;
};

export function exportPNG() {
  if (!S.result) return toast('Nothing to export yet');
  // Full size: each cell becomes a block of `block` pixels. Cells: one pixel per cell.
  const k = S.look.exportScale === 'cells' ? 1 : Math.max(1, Math.floor(S.settings.block));
  scaledOutput(k).toBlob(async b => {
    if (!b) return toast('PNG export failed', 'error');
    const res = await saveFile(fileBase() + '.png', b, 'image/png');
    toast(res.message, res.status === 'error' ? 'error' : 'info');
  }, 'image/png');
}

/** Vector export: one square per cell, sized like the PNG export. */
export async function exportSVG() {
  const r = S.result;
  if (!r) return toast('Nothing to export yet');
  const k = S.look.exportScale === 'cells' ? 1 : Math.max(1, Math.floor(S.settings.block));
  const opts = {width: r.w * k, height: r.h * k, title: 'DURANDAL ' + (STYLE_BY_ID[S.settings.style]?.name || '')};
  // A GPU result reads its cells back here; null means a newer frame replaced it.
  const bits = r.colors ? r.indices : r.mask;
  if (!bits) return toast('That frame is gone. Try again.', 'error');
  const svg = r.colors ? indicesToSVG(bits, r.w, r.h, r.colors, opts) : maskToSVG(bits, r.w, r.h, S.look.ink, S.look.paper, opts);
  const res = await saveFile(fileBase() + '.svg', new Blob([svg], {type: 'image/svg+xml'}), 'image/svg+xml');
  toast(res.message, res.status === 'error' ? 'error' : 'info');
}
