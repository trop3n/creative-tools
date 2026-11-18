// Rendering: the GPU path for pattern styles, the worker round trip for the rest,
// painting, settings and still export.
import {makeCanvas, saveFile, slug, frameCanvasFor, drawVideoFrame} from '@studio/core';
import {paintMask, STYLE_BY_ID, createGpuDither} from '@studio/core/dither';
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
  const settings = {...S.settings, params: currentParams()};

  if (onGpu(settings)) {
    try {
      const t0 = performance.now();
      if (!gpuHasIt) { gpu.setSource(src.el, src.mirror); gpuHasIt = true; }
      const {w, h} = gpu.render(settings);
      const gen = gpu.generation;
      let mask = null;
      const result = {
        w, h, ms: performance.now() - t0, gpu: true, gen,
        // Read back only when something needs the bits (export without the GPU, tests).
        get mask() { return mask || (gpu && gpu.generation === gen ? (mask = gpu.readMask()) : null); },
      };
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
  if (onGpu({...S.settings, params: currentParams()})) {
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
    const result = {mask: data.mask, w: data.w, h: data.h, ms: data.ms};
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

/** Paint the last result at cell resolution; CSS scales it up with hard edges. */
export function paint() {
  const r = S.result;
  if (!canvas || !r) return emit();
  if (canvas.width !== r.w || canvas.height !== r.h) { canvas.width = r.w; canvas.height = r.h; }
  const x = canvas.getContext('2d');
  if (isLiveGpu(r)) {
    gpu.present(S.look.ink, S.look.paper, 1);
    x.drawImage(gpu.canvas, 0, 0);
  } else {
    if (!r.mask) return emit(); // a GPU result whose engine has gone; the CPU result is on its way
    x.putImageData(new ImageData(paintMask(r.mask, r.w, r.h, r.w, r.h, S.look.ink, S.look.paper), r.w, r.h), 0, 0);
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
    gpu.present(S.look.ink, S.look.paper, k);
    x.drawImage(gpu.canvas, 0, 0);
  } else {
    x.putImageData(new ImageData(paintMask(r.mask, r.w, r.h, w, h, S.look.ink, S.look.paper), w, h), 0, 0);
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
  else if (key === 'gpu') { schedule(); emit(); }
  else emit();
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
