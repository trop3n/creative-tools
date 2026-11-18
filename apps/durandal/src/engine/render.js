// The worker round trip, painting, settings and still export.
import {makeCanvas, saveFile, slug} from '@studio/core';
import {paintMask, STYLE_BY_ID} from '@studio/core/dither';
import DitherWorker from './dither.worker.js?worker&inline';
import {S, emit, persist, toast, currentParams} from './state.js';

const worker = new DitherWorker();
let jobId = 0;
const jobs = new Map(); // job id -> {resolve, reject}; the worker answers in order
let pending = false; // a settings change arrived while busy
let hasSource = false;
let canvas = null; // the preview canvas on the stage (one pixel per cell)
let mirror = null; // optional scaled copy of the preview, for live recording
const idleWaiters = [];

export const isBusy = () => jobs.size > 0;
/** Resolves once the worker has nothing in flight. */
export const idle = () => (jobs.size ? new Promise(r => idleWaiters.push(r)) : Promise.resolve());

/**
 * Dither once. Pass a source canvas to send new pixels (a new image or video frame);
 * omit it to re-dither the last source with the current settings.
 * Resolves with that job's result after it has been painted.
 */
export function renderNow(source) {
  return new Promise((resolve, reject) => {
    const msg = {job: ++jobId, settings: {...S.settings, params: currentParams()}};
    const transfer = [];
    if (source) {
      const rgba = source.getContext('2d', {willReadFrequently: true}).getImageData(0, 0, source.width, source.height).data;
      Object.assign(msg, {rgba, w: source.width, h: source.height});
      transfer.push(rgba.buffer);
      hasSource = true;
    }
    jobs.set(msg.job, {resolve, reject});
    pending = false;
    if (!S.busy) { S.busy = true; emit(); }
    worker.postMessage(msg, transfer);
  });
}

/** Re-dither after a settings change. Bursts (slider drags) collapse into one job at a time. */
export function schedule() {
  if (!hasSource) return;
  if (jobs.size) { pending = true; return; }
  renderNow().catch(() => {});
}

worker.onmessage = ({data}) => {
  const job = jobs.get(data.job);
  jobs.delete(data.job);
  if (data.type === 'done') {
    const result = {mask: data.mask, w: data.w, h: data.h, ms: data.ms};
    S.result = result;
    paint();
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

/** Paint the last result at cell resolution; CSS scales it up with hard edges. */
export function paint() {
  const r = S.result;
  if (!canvas || !r) return emit();
  if (canvas.width !== r.w || canvas.height !== r.h) { canvas.width = r.w; canvas.height = r.h; }
  canvas.getContext('2d').putImageData(new ImageData(paintMask(r.mask, r.w, r.h, r.w, r.h, S.look.ink, S.look.paper), r.w, r.h), 0, 0);
  if (mirror) {
    const x = mirror.getContext('2d');
    x.imageSmoothingEnabled = false;
    x.drawImage(canvas, 0, 0, mirror.width, mirror.height);
  }
  emit();
}

/** The last result painted at `k` device pixels per cell. */
export function scaledOutput(k, into, r = S.result) {
  const w = r.w * k, h = r.h * k;
  const out = into && into.width === w && into.height === h ? into : makeCanvas(w, h);
  out.getContext('2d').putImageData(new ImageData(paintMask(r.mask, r.w, r.h, w, h, S.look.ink, S.look.paper), w, h), 0, 0);
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
  if (key === 'ink' || key === 'paper') paint(); else emit();
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
