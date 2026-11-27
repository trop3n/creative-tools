// Rendering: the GPU path for pattern styles, the worker round trip for the rest,
// painting, settings and still export.
import {makeCanvas, saveFile, slug, createLiveSender, suiteGlyphs, watchGlyphs, rasterGlyphs, byInk, tintGlyph, glyphSymbol} from '@studio/core';
import {FRAME_RATIOS, cropRect, fixedSize, frameRatio} from '@studio/core/frames';
import {valuesAt, paintMask, paintIndices, paintCells, isPlainCells, extremeColor, hexToRGB, indicesToSVG, maskToSVG, adaptivePalette, parsePalette, paletteHexFile, PALETTE_BY_ID, MAX_COLORS, STYLE_BY_ID, createGpuDither, applyEffects, hasEffects, newEffect, MAX_EFFECTS} from '@studio/core/dither';
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
// For a still cut to a frame, `el` is the framed copy and `base` the original.
let src = null; // {el, base, mirror}
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
/** The part of the source the Frame setting keeps (all of it for Source). */
const customOf = () => [S.look.customW, S.look.customH];
/** The frame's fixed export size (LED wall or Custom size), or null. */
export const fixedFrame = () => fixedSize(S.look.frame, customOf());
const cropOf = el => cropRect(...sourceSize(el), frameRatio(S.look.frame, FRAME_RATIOS, customOf()) || 0);
/**
 * The size the engines dither: a video's capped frame, or a still at its own size, after
 * the frame crop. The LED wall works at its own size (half that for video, to keep
 * playback quick), so pixel sizes that divide 128 land each cell on whole wall pixels.
 */
function workSize(el) {
  const f = fixedFrame();
  if (f) return isVideo(el) ? [f[0] / 2, f[1] / 2] : f;
  const c = cropOf(el), w = Math.max(2, Math.round(c.w)), h = Math.max(2, Math.round(c.h));
  return isVideo(el) ? cappedSize(w, h) : [w, h];
}
/** Draw the frame's part of `el` at the work size into `into` (made or resized as needed). */
function drawFramed(el, into, flip = false) {
  const [w, h] = workSize(el), c = cropOf(el);
  const out = into && into.width === w && into.height === h ? into : makeCanvas(w, h);
  const x = out.getContext('2d');
  x.setTransform(flip ? -1 : 1, 0, 0, 1, flip ? w : 0, 0); // the crop is centered, so mirroring after it is the same
  x.drawImage(el, c.x, c.y, c.w, c.h, 0, 0, w, h);
  x.setTransform(1, 0, 0, 1, 0, 0);
  return out;
}
/** A still as the engines see it: itself for Source, else a framed copy. */
const framedStill = el => (S.look.frame && S.look.frame !== 'source' ? drawFramed(el) : el);
/** Copy the video's current frame into the shared capped canvas. */
function videoFrame() {
  frame = drawFramed(src.el, frame, src.mirror);
  return frame;
}
/** The Frame setting changed: cut the source again and re-dither. */
export function reframe() {
  if (!src) return;
  if (!isVideo(src.base)) src.el = framedStill(src.base);
  workerHasIt = gpuHasIt = false;
  schedule();
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
  if (!keys || !keys.length || !src) return;
  const t = clockTime();
  if (t === null || t === keyTime) return;
  keyTime = t;
  const at = valuesAt(keys, t, {ease: S.media.ease !== false});
  if (!STYLE_BY_ID[at.style]) return;
  Object.assign(S.settings, at.values);
  S.settings.style = at.style;
  S.paramsByStyle[at.style] = {...(S.paramsByStyle[at.style] || {}), ...at.params};
  if (at.effects) S.look.effects = at.effects;
}
/** Apply the keyframes again on the next render (after they change). */
export const reapplyKeys = () => { keyTime = null; };
/** The current values are what the keyframes say at `t` (a keyframe was just set there). */
export const keysApplied = t => { keyTime = t; };
/** A sample or image with Animate on: it has a timeline of its own. */
export const isAnimating = () => !!S.media.anim && (S.media.kind === 'sample' || S.media.kind === 'image');
/** The time keyframes read: a video's position or an animated still's timeline (null for other stills and the webcam). */
export function clockTime() {
  if (S.media.kind === 'video') return src && isVideo(src.el) ? src.el.currentTime : null;
  return isAnimating() ? S.media.time : null;
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
  if (el) { src = {el: isVideo(el) ? el : framedStill(el), base: el, mirror: flip}; workerHasIt = gpuHasIt = false; }
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
  if (c && typeof ResizeObserver !== 'undefined') { resize = new ResizeObserver(() => { if (shaped() || fxOn()) paint(); }); resize.observe(c); }
  paint();
}
export const getCanvas = () => canvas;

/** Keep a scaled copy of every painted frame on `c` (null to stop). Used for recording. */
export function setMirror(c) { mirror = c; if (c) paint(); }

const isLiveGpu = r => r && r.gpu && gpu && gpu.generation === r.gen;
/** Index → color for a result: its palette, or [ink, paper] for two tones. */
const colorsOf = r => r.colors || [S.look.ink, S.look.paper];

/** The cell shape in use: Glyphs draw as squares until GLYF has published a set. */
const cellShape = () => (S.look.cellShape === 'glyphs' && !glyphSet.length ? 'square' : S.look.cellShape || 'square');
/** Cell shape settings for a result: {shape, gap (0..1), gapColor}. */
const cellsOf = r => ({
  shape: cellShape(),
  gap: (S.look.gap || 0) / 100,
  gapColor: extremeColor(colorsOf(r), S.look.gapTone === 'light' ? 'light' : 'dark'),
});
const shaped = () => !isPlainCells(cellShape(), (S.look.gap || 0) / 100);
const glyphCells = () => cellShape() === 'glyphs';

/* ---------- glyph cells (GLYF's shared set) ---------- */
const GLYPH_SIZE = 128; // raster size: crisp up to 128 pixels per cell
let glyphSet = []; // GLYF's glyphs as masks, least ink first
let glyphLoad = 0;
function loadGlyphs() {
  const seq = ++glyphLoad;
  rasterGlyphs(suiteGlyphs(), GLYPH_SIZE).then(list => {
    if (seq !== glyphLoad) return;
    glyphSet = byInk(list);
    stamps.clear();
    if (S.look.cellShape === 'glyphs') paint(); else emit();
  });
}
/** True once GLYF's set is here to draw cells with. */
export const hasGlyphs = () => glyphSet.length > 0;

const luma = c => { const [r, g, b] = hexToRGB(c); return r * 299 + g * 587 + b * 114; };
/** A stable hash of a cell's position, so a two-tone picture doesn't repeat one stamp. */
function cellHash(x, y) {
  let h = Math.imul(x + 1, 0x27d4eb2d) ^ Math.imul(y + 1, 0x165667b1);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12;
  return h >>> 0;
}
/**
 * Which glyph each cell gets, (color index, x, y) → glyph. Darker colors get inkier glyphs.
 * With two colors, ink cells take one from the inkier half of the set and paper cells from
 * the lighter half, by cell position. `inkFirst`: index 0 is the ink (two tones).
 */
function glyphPicker(colors, inkFirst) {
  const G = glyphSet, n = G.length;
  if (colors.length === 2) {
    const dark = inkFirst || luma(colors[0]) <= luma(colors[1]) ? 0 : 1, half = Math.ceil(n / 2);
    const light = G.slice(0, half), inky = G.slice(n - half);
    return (i, x, y) => { const set = i === dark ? inky : light; return set[cellHash(x, y) % set.length]; };
  }
  const byColor = [];
  colors.map((c, i) => i).sort((a, b) => luma(colors[b]) - luma(colors[a])) // lightest first
    .forEach((ci, rank) => { byColor[ci] = G[Math.round((rank * (n - 1)) / Math.max(1, colors.length - 1))]; });
  return i => byColor[i] || G[0];
}
/** A result's cells as color indices (two tones: 0 ink, 1 paper); null if its bits are gone. */
function cellIndices(r) {
  const bits = r.colors ? r.indices : r.mask;
  if (!bits || r.colors) return bits;
  const idx = new Uint8Array(bits.length);
  for (let i = 0; i < idx.length; i++) idx[i] = bits[i] !== 0 ? 1 : 0;
  return idx;
}

const stamps = new Map(); // "size|glyph|color" -> the glyph tinted and scaled to size
function stamp(g, color, s) {
  const key = s + '|' + g.id + '|' + color;
  let c = stamps.get(key);
  if (!c) {
    if (stamps.size > 2048) stamps.clear();
    c = makeCanvas(s, s);
    const x = c.getContext('2d');
    x.imageSmoothingQuality = 'high';
    x.drawImage(tintGlyph(g.mask, color), 0, 0, s, s);
    stamps.set(key, c);
  }
  return c;
}
/** Draw a result as glyph cells, k pixels per cell, over the gap color. False if its bits are gone. */
function drawGlyphs(x, r, k) {
  const idx = cellIndices(r);
  if (!idx) return false;
  const colors = colorsOf(r), {gap, gapColor} = cellsOf(r), pick = glyphPicker(colors, !r.colors);
  const s = Math.round(k * (1 - gap)), o = Math.floor((k - s) / 2);
  x.fillStyle = gapColor;
  x.fillRect(0, 0, r.w * k, r.h * k);
  if (s < 1) return true;
  // A cell in the gap color is invisible, so it is left out.
  const skip = colors.map(c => c.toLowerCase() === gapColor.toLowerCase());
  for (let y = 0, i = 0; y < r.h; y++) {
    for (let cx = 0; cx < r.w; cx++, i++) {
      const ci = idx[i];
      if (skip[ci] || !colors[ci]) continue;
      x.drawImage(stamp(pick(ci, cx, y), colors[ci], s), cx * k + o, y * k + o);
    }
  }
  return true;
}
/** Glyph cells as SVG: a <symbol> per glyph, a <use> per cell. */
function glyphSVG(idx, r, {width, height, title, gap, gapColor}) {
  const colors = colorsOf(r), pick = glyphPicker(colors, !r.colors), used = new Map();
  const s = Math.max(0, 1 - gap), o = +((1 - s) / 2).toFixed(4);
  const skip = colors.map(c => c.toLowerCase() === gapColor.toLowerCase()), uses = [];
  if (s > 0) for (let y = 0, i = 0; y < r.h; y++) {
    for (let x = 0; x < r.w; x++, i++) {
      const ci = idx[i];
      if (skip[ci] || !colors[ci]) continue;
      const g = pick(ci, x, y);
      if (!used.has(g)) used.set(g, 'g' + used.size);
      uses.push(`<use href="#${used.get(g)}" x="${+(x + o).toFixed(4)}" y="${+(y + o).toFixed(4)}" width="${+s.toFixed(4)}" height="${+s.toFixed(4)}" color="${colors[ci]}"/>`);
    }
  }
  const esc = t => String(t).replace(/[<>&"]/g, c => ({'<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;'})[c]);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${r.w} ${r.h}">`,
    title ? `<title>${esc(title)}</title>` : '',
    `<defs>${[...used].map(([g, id]) => glyphSymbol(g, id)).join('')}</defs>`,
    `<rect width="${r.w}" height="${r.h}" fill="${gapColor}"/>`,
    ...uses,
    '</svg>\n',
  ].filter(Boolean).join('\n');
}

/* ---------- effects ---------- */
const fxOn = () => hasEffects(S.look.effects);
/** Moving effects change about 12 times a second of video (or of webcam time); stills keep frame 0. */
function effectFrame() {
  const t = clockTime();
  if (t !== null) return Math.floor(t * 12);
  return S.media.kind === 'camera' ? Math.floor(performance.now() / 83.3) : 0;
}
/** Run the effect stack over canvas c, painted at k pixels per cell. */
function runEffects(c, k) {
  if (!fxOn()) return;
  const x = c.getContext('2d'), im = x.getImageData(0, 0, c.width, c.height);
  applyEffects(im.data, c.width, c.height, S.look.effects, {k, frame: effectFrame()});
  x.putImageData(im, 0, 0);
}
const setEffects = list => { S.look.effects = list; persist(); paint(); };
export function addEffect(id) {
  const fx = newEffect(id), list = S.look.effects || [];
  if (!fx) return;
  if (list.length >= MAX_EFFECTS) return toast(`That's ${MAX_EFFECTS} effects, the most a stack takes. Remove one first.`);
  setEffects([...list, fx]);
}
export function setEffect(i, key, value) { setEffects(S.look.effects.map((e, j) => (j === i ? {...e, [key]: value} : e))); }
export function removeEffect(i) { setEffects(S.look.effects.filter((_, j) => j !== i)); }
export function moveEffect(i, d) {
  const list = [...S.look.effects], j = i + d;
  if (j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  setEffects(list);
}

/** Preview pixels per cell: 1 for plain squares (CSS scales them up); about the screen size for shapes and effects. */
function previewScale(r) {
  if ((!shaped() && !fxOn()) || !canvas) return 1;
  const dpr = globalThis.devicePixelRatio || 1;
  const fit = Math.min(canvas.clientWidth / r.w, canvas.clientHeight / r.h) * dpr;
  const k = fit > 0 ? Math.round(fit) : Math.floor(S.settings.block) || 1;
  // Effects run on the CPU every frame, so their preview stays smaller.
  return Math.max(1, Math.min(k, Math.floor((fxOn() ? 2048 : 4096) / Math.max(r.w, r.h)) || 1));
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

// Glyph cells follow GLYF's set as it changes.
loadGlyphs();
watchGlyphs(loadGlyphs);

// Live link: other windows of the suite can watch the stage as a source. A new watcher
// gets a fresh paint, so a still is sent too.
const sender = createLiveSender({label: () => STYLE_BY_ID[S.settings.style]?.name || '', onWatch: () => paint()});

/** Paint the last result at cell resolution; CSS scales it up with hard edges. */
export function paint() {
  const r = S.result;
  if (!canvas || !r) return emit();
  const k = previewScale(r), W = r.w * k, H = r.h * k;
  if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
  const x = canvas.getContext('2d');
  if (glyphCells()) {
    if (!drawGlyphs(x, r, k)) return emit(); // a GPU result whose engine has gone
  } else if (isLiveGpu(r)) {
    gpu.present(colorsOf(r), k, cellsOf(r));
    x.drawImage(gpu.canvas, 0, 0);
  } else {
    const px = pixels(r, W, H);
    if (!px) return emit(); // a GPU result whose engine has gone; the CPU result is on its way
    x.putImageData(new ImageData(px, W, H), 0, 0);
  }
  runEffects(canvas, k);
  sender.frame(canvas);
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
  if (glyphCells()) drawGlyphs(x, r, k);
  else if (isLiveGpu(r)) {
    // Scale on the GPU and copy across: no read-back of the mask.
    gpu.present(colorsOf(r), k, cellsOf(r));
    x.drawImage(gpu.canvas, 0, 0);
  } else {
    const px = pixels(r, w, h);
    if (px) x.putImageData(new ImageData(px, w, h), 0, 0);
  }
  runEffects(out, k);
  return out;
}

/** Whole-number scale that brings the long side as close to `maxSide` as it can without passing it. */
export const fitScale = (r, maxSide) => Math.max(1, Math.floor(maxSide / Math.max(r.w, r.h)));

/** The last result at exactly W × H: whole pixels per cell as near as they go, then stretched with hard edges to fit. */
export function fixedOutput(r, [W, H], into) {
  const k = Math.max(1, Math.round(Math.min(W / r.w, H / r.h)));
  const cells = scaledOutput(k, null, r);
  if (cells.width === W && cells.height === H) return cells;
  const out = into && into.width === W && into.height === H ? into : makeCanvas(W, H);
  const x = out.getContext('2d');
  x.imageSmoothingEnabled = false;
  x.drawImage(cells, 0, 0, W, H);
  return out;
}

/** Pixels per cell in a still export: Pixel size (Full size) or 1 (One pixel per cell). */
const exportScale = () => (S.look.exportScale === 'cells' ? 1 : Math.max(1, Math.floor(S.settings.block)));
/** A still export's width and height: the frame's fixed size (LED wall), else cells × scale. */
export function exportDims(r = S.result) {
  return fixedFrame() || [r.w * exportScale(), r.h * exportScale()];
}

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
  // Glyph cells read as ink on paper, so they start on the lightest color (switch Gap color back if you like).
  if (key === 'cellShape' && value === 'glyphs') S.look.gapTone = 'light';
  persist();
  if (key === 'ink' || key === 'paper' || key === 'cellShape' || key === 'gap' || key === 'gapTone') paint();
  else if (key === 'frame' || key === 'customW' || key === 'customH') { reframe(); emit(); }
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

/** Load a palette file (.hex, .gpl or any text with color codes) as the custom palette. */
export async function importPalette(file) {
  if (!file) return;
  let colors = [];
  try { colors = parsePalette(await file.text()); } catch (e) { /* unreadable: handled below */ }
  if (colors.length < 2) return toast(`No palette found in ${file.name}. Use a .hex or .gpl file, or text with color codes like #00304e.`, 'error');
  S.settings.mode = 'palette';
  editCustom(colors);
  toast(`Loaded ${colors.length} colors from ${file.name} as your custom palette`);
}
/** Save the palette on show as a .hex file (one rrggbb per line; Lospec and most tools read it). */
export async function exportPalette() {
  const res = await saveFile(`durandal-${slug(S.settings.palette || 'palette')}.hex`, new Blob([paletteHexFile(paletteColors({pick: false}))], {type: 'text/plain'}), 'text/plain');
  toast(res.message, res.status === 'error' ? 'error' : 'info');
}

export function resetTone() {
  Object.assign(S.settings, {brightness: 0, contrast: 0, midtones: 0, highlights: 0, shadows: 0, blur: 0, saturation: 0, sharpen: 0, noise: 0});
  persist(); schedule(); emit();
}

/* ---------- still export ---------- */
export const fileBase = () => {
  const m = S.media;
  const name = m.kind === 'image' || m.kind === 'video' ? m.label.replace(/\.[^.]+$/, '') : m.kind === 'camera' ? (m.live ? 'live' : 'webcam') : S.look.sample;
  return `durandal-${slug(name)}-${S.settings.style}`;
};

export const exportPNG = () => exportStill('png');
/** JPG for places that want one; dithered edges come out a little soft. */
export const exportJPG = () => exportStill('jpg');

/** A result as a still export paints it: the fixed frame's size, else Pixel size (or one pixel) per cell. */
export function stillOutput(r) {
  const f = fixedFrame();
  return f ? fixedOutput(r, f) : scaledOutput(exportScale(), null, r);
}
/** The picture as a still export makes it, as a PNG to send to another tool. */
export async function stillBlob() {
  const r = S.result;
  if (!r || (!isLiveGpu(r) && !(r.colors ? r.indices : r.mask))) throw new Error('Nothing to send yet');
  const blob = await new Promise(res => stillOutput(r).toBlob(res, 'image/png'));
  if (!blob) throw new Error('Could not make the picture');
  return {blob, name: fileBase() + '.png'};
}
/** The still on the stage as loaded (before the Frame crop), to put back after a batch. */
export const currentStill = () => (src && !isVideo(src.base) ? src.base : null);

function exportStill(kind) {
  const type = kind === 'jpg' ? 'image/jpeg' : 'image/png';
  const r = S.result;
  if (!r) return toast('Nothing to export yet');
  // A GPU result whose engine has gone can't be painted; the SVG export checks the same.
  if (!isLiveGpu(r) && !(r.colors ? r.indices : r.mask)) return toast('That frame is gone. Try again.', 'error');
  // Full size: each cell becomes a block of `block` pixels. Cells: one pixel per cell.
  // A fixed frame (the LED wall) comes out at exactly its size.
  stillOutput(r).toBlob(async b => {
    if (!b) return toast(kind.toUpperCase() + ' export failed', 'error');
    const res = await saveFile(fileBase() + '.' + kind, b, type);
    toast(res.message, res.status === 'error' ? 'error' : 'info');
  }, type, 0.92);
}

const SVG_SHAPED_MAX = 1_000_000;
/** Vector export: one square per cell, sized like the PNG export. */
export async function exportSVG() {
  const r = S.result;
  if (!r) return toast('Nothing to export yet');
  const [width, height] = exportDims(r);
  const opts = {width, height, title: 'DURANDAL ' + (STYLE_BY_ID[S.settings.style]?.name || ''), ...cellsOf(r)};
  // A GPU result reads its cells back here; null means a newer frame replaced it.
  // Shaped cells are one path each; past this many the file runs to hundreds of MB.
  if (shaped() && r.w * r.h > SVG_SHAPED_MAX) {
    return toast(`That's ${(r.w * r.h / 1e6).toFixed(1)} million shaped cells, too many for an SVG. Raise Pixel size, use square cells, or save a PNG.`, 'error');
  }
  const bits = r.colors ? r.indices : r.mask;
  if (!bits) return toast('That frame is gone. Try again.', 'error');
  const svg = glyphCells() ? glyphSVG(cellIndices(r), r, opts) : r.colors ? indicesToSVG(bits, r.w, r.h, r.colors, opts) : maskToSVG(bits, r.w, r.h, S.look.ink, S.look.paper, opts);
  const res = await saveFile(fileBase() + '.svg', new Blob([svg], {type: 'image/svg+xml'}), 'image/svg+xml');
  const note = res.status !== 'error' && fxOn() ? ' The SVG has the dither only; effects are in PNG and MP4.' : '';
  toast(res.message + note, res.status === 'error' ? 'error' : 'info');
}
