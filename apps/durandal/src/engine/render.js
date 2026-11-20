// Rendering: the GPU path for pattern styles, the worker round trip for the rest,
// painting, settings and still export.
import {makeCanvas, saveFile, slug, drawVideoFrame} from '@studio/core';
import {valuesAt, paintMask, paintIndices, paintCells, isPlainCells, extremeColor, indicesToSVG, maskToSVG, adaptivePalette, PALETTE_BY_ID, MAX_COLORS, STYLE_BY_ID, createGpuDither} from '@studio/core/dither';
import DitherWorker from './dither.worker.js?worker&inline';
import {S, emit, persist, toast, currentParams} from './state.js';

const worker = new DitherWorker();
let jobId = 0;
let shown = 0; // id of the job whose result is on screen; older results are dropped
const jobs = new Map(); // worker job id -> {resolve, reject}
let pending = false; // a settings change arrived while the worker was busy
let canvas = null; // the preview canvas on the stage (one pixel per cell)
let mirror = null; // optional scaled copy of the preview, for live recording
let mirrorBuf = null; // shaped cells drawn at the recording's scale
const idleWaiters = [];

// The last source frame: a canvas (images, samples) or a video element (files, webcam).
let src = null; // {el, mirror}
let workerHasIt = false; // the worker holds this frame's pixels
let gpuHasIt = false; // the GPU texture holds this frame
let frame = null; // the current video frame for both engines, at most 1280 on the long side

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
/** Video frames go to both engines at most 1280 on the long side, so the GPU and the worker cut the same cell grid. */
const VIDEO_MAX = 1280;
const cappedSize = (w, h) => { const k = Math.min(1, VIDEO_MAX / Math.max(w, h)); return [Math.max(2, Math.round(w * k)), Math.max(2, Math.round(h * k))]; };
/** The size the engines dither: a video's capped frame, or a still at its own size. */
const workSize = el => (isVideo(el) ? cappedSize(...sourceSize(el)) : sourceSize(el));
/** Copy the video's current frame into the shared capped canvas. */
function videoFrame() {
  const [w, h] = cappedSize(...sourceSize(src.el));
  if (!frame || frame.width !== w || frame.height !== h) frame = makeCanvas(w, h);
  drawVideoFrame(src.el, frame, src.mirror);
  return frame;
}

function onGpu(settings) {
  if (!gpu || S.look.gpu === false || !src) return false;
  const [sw, sh] = sourceSize(src.el);
  if (!sw || !sh) return false; // nothing decodable to dither (yet)
  const [w, h] = workSize(src.el);
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
  applyKeys();
  const st = {...S.settings, params: currentParams()};
  if (st.mode === 'palette') st.colors = paletteColors();
  return st;
};

/* ---------- keyframes ---------- */
let keyTime = null; // the video time keyframes were last applied at

/**
 * On a video with keyframes, set the sliders to their values at the current time.
 * Only when the time has moved: hand edits while paused stay until you scrub or
 * play, so you can tweak a frame and then set a keyframe there.
 */
function applyKeys() {
  const keys = S.media.keys;
  if (!keys || !keys.length || S.media.kind !== 'video' || !src || !isVideo(src.el)) return;
  const t = src.el.currentTime;
  if (t === keyTime) return;
  keyTime = t;
  const at = valuesAt(keys, t, {ease: S.media.ease !== false});
  if (!STYLE_BY_ID[at.style]) return;
  Object.assign(S.settings, at.values);
  S.settings.style = at.style;
  S.paramsByStyle[at.style] = {...(S.paramsByStyle[at.style] || {}), ...at.params};
}
/** Apply the keyframes again on the next render (after they change). */
export const reapplyKeys = () => { keyTime = null; };
/** The current values are what the keyframes say at `t` (a keyframe was just set there). */
export const keysApplied = t => { keyTime = t; };
/** The showing video's time (null for stills and the webcam). */
export const currentVideoTime = () => (src && isVideo(src.el) && S.media.kind === 'video' ? src.el.currentTime : null);

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
      if (!gpuHasIt) { if (isVideo(src.el)) gpu.setSource(videoFrame(), false); else gpu.setSource(src.el, src.mirror); gpuHasIt = true; }
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
        const [w, h] = sourceSize(c);
        c = w && h ? videoFrame() : (frame = frame || makeCanvas(2, 2));
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
  if (pending) {
    // The next job may go to the GPU (no worker job), so only wait if the worker took it.
    pending = false;
    schedule();
    if (jobs.size) return;
  }
  S.busy = false;
  idleWaiters.splice(0).forEach(r => r());
  emit();
};

/* ---------- painting ---------- */
let resize = null;
export function setCanvas(c) {
  resize?.disconnect();
  canvas = c;
  // Shaped cells are painted at screen resolution, so repaint when the stage resizes.
  if (c && typeof ResizeObserver !== 'undefined') { resize = new ResizeObserver(() => { if (shaped()) paint(); }); resize.observe(c); }
  paint();
}
export const getCanvas = () => canvas;

/** Keep a scaled copy of every painted frame on `c` (null to stop). Used for recording. */
export function setMirror(c) { mirror = c; if (c) paint(); }

const isLiveGpu = r => r && r.gpu && gpu && gpu.generation === r.gen;
/** Index → color for a result: its palette, or [ink, paper] for two tones. */
const colorsOf = r => r.colors || [S.look.ink, S.look.paper];

/** Cell shape settings for a result: {shape, gap (0..1), gapColor}. */
const cellsOf = r => ({
  shape: S.look.cellShape || 'square',
  gap: (S.look.gap || 0) / 100,
  gapColor: extremeColor(colorsOf(r), S.look.gapTone === 'light' ? 'light' : 'dark'),
});
const shaped = () => !isPlainCells(S.look.cellShape, (S.look.gap || 0) / 100);

/** Preview pixels per cell: 1 for plain squares (CSS scales them up); about the screen size for shapes. */
function previewScale(r) {
  if (!shaped() || !canvas) return 1;
  const dpr = globalThis.devicePixelRatio || 1;
  const fit = Math.min(canvas.clientWidth / r.w, canvas.clientHeight / r.h) * dpr;
  const k = fit > 0 ? Math.round(fit) : Math.floor(S.settings.block) || 1;
  return Math.max(1, Math.min(k, Math.floor(4096 / Math.max(r.w, r.h)) || 1));
}

/** A CPU result (or a read-back GPU one) painted as RGBA at outW×outH; null if its bits are gone. */
function pixels(r, outW, outH) {
  if (shaped()) {
    const bits = r.colors ? r.indices : r.mask;
    if (!bits) return null;
    let idx = bits;
    if (!r.colors) { idx = new Uint8Array(bits.length); for (let i = 0; i < idx.length; i++) idx[i] = bits[i] !== 0 ? 1 : 0; }
    const c = cellsOf(r);
    return paintCells(idx, r.w, r.h, Math.max(1, Math.round(outW / r.w)), colorsOf(r), c.shape, c.gap, c.gapColor);
  }
  if (r.colors) return r.indices ? paintIndices(r.indices, r.w, r.h, outW, outH, r.colors) : null;
  return r.mask ? paintMask(r.mask, r.w, r.h, outW, outH, S.look.ink, S.look.paper) : null;
}

/** Paint the last result at cell resolution; CSS scales it up with hard edges. */
export function paint() {
  const r = S.result;
  if (!canvas || !r) return emit();
  const k = previewScale(r), W = r.w * k, H = r.h * k;
  if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
  const x = canvas.getContext('2d');
  if (isLiveGpu(r)) {
    gpu.present(colorsOf(r), k, cellsOf(r));
    x.drawImage(gpu.canvas, 0, 0);
  } else {
    const px = pixels(r, W, H);
    if (!px) return emit(); // a GPU result whose engine has gone; the CPU result is on its way
    x.putImageData(new ImageData(px, W, H), 0, 0);
  }
  if (mirror) {
    const m = mirror.getContext('2d');
    m.imageSmoothingEnabled = false;
    // Shapes are drawn at the recording's own scale rather than stretched from the preview.
    const from = shaped() ? (mirrorBuf = scaledOutput(Math.max(1, Math.floor(mirror.width / r.w)), mirrorBuf, r)) : canvas;
    m.drawImage(from, 0, 0, mirror.width, mirror.height);
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
    gpu.present(colorsOf(r), k, cellsOf(r));
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
  if (key === 'ink' || key === 'paper' || key === 'cellShape' || key === 'gap' || key === 'gapTone') paint();
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
  const r = S.result;
  if (!r) return toast('Nothing to export yet');
  // A GPU result whose engine has gone can't be painted; the SVG export checks the same.
  if (!isLiveGpu(r) && !(r.colors ? r.indices : r.mask)) return toast('That frame is gone. Try again.', 'error');
  // Full size: each cell becomes a block of `block` pixels. Cells: one pixel per cell.
  const k = S.look.exportScale === 'cells' ? 1 : Math.max(1, Math.floor(S.settings.block));
  scaledOutput(k).toBlob(async b => {
    if (!b) return toast('PNG export failed', 'error');
    const res = await saveFile(fileBase() + '.png', b, 'image/png');
    toast(res.message, res.status === 'error' ? 'error' : 'info');
  }, 'image/png');
}

const SVG_SHAPED_MAX = 1_000_000;
/** Vector export: one square per cell, sized like the PNG export. */
export async function exportSVG() {
  const r = S.result;
  if (!r) return toast('Nothing to export yet');
  const k = S.look.exportScale === 'cells' ? 1 : Math.max(1, Math.floor(S.settings.block));
  const opts = {width: r.w * k, height: r.h * k, title: 'DURANDAL ' + (STYLE_BY_ID[S.settings.style]?.name || ''), ...cellsOf(r)};
  // A GPU result reads its cells back here; null means a newer frame replaced it.
  // Shaped cells are one path each; past this many the file runs to hundreds of MB.
  if (shaped() && r.w * r.h > SVG_SHAPED_MAX) {
    return toast(`That's ${(r.w * r.h / 1e6).toFixed(1)} million shaped cells, too many for an SVG. Raise Pixel size, use square cells, or save a PNG.`, 'error');
  }
  const bits = r.colors ? r.indices : r.mask;
  if (!bits) return toast('That frame is gone. Try again.', 'error');
  const svg = r.colors ? indicesToSVG(bits, r.w, r.h, r.colors, opts) : maskToSVG(bits, r.w, r.h, S.look.ink, S.look.paper, opts);
  const res = await saveFile(fileBase() + '.svg', new Blob([svg], {type: 'image/svg+xml'}), 'image/svg+xml');
  toast(res.message, res.status === 'error' ? 'error' : 'info');
}
