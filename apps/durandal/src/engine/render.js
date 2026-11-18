// Source images, the worker round trip, painting and export.
import {loadImageFile, isImageFile, makeCanvas, saveFile, slug} from '@studio/core';
import {paintMask, STYLE_BY_ID} from '@studio/core/dither';
import DitherWorker from './dither.worker.js?worker&inline';
import {S, emit, persist, toast, currentParams} from './state.js';

const worker = new DitherWorker();
let sourceId = 0;
let jobId = 0;
let inFlight = false;
let pending = false;
let canvas = null; // the preview canvas on the stage

/* ---------- jobs ---------- */
function send() {
  inFlight = true;
  pending = false;
  S.busy = true;
  worker.postMessage({
    type: 'job',
    job: ++jobId,
    sourceId,
    settings: {...S.settings, params: currentParams()},
  });
}

/** Ask for a new render. Coalesces bursts (slider drags) into one job at a time. */
export function schedule() {
  if (!sourceId) return;
  if (inFlight) pending = true;
  else send();
}

worker.onmessage = ({data}) => {
  inFlight = false;
  if (data.type === 'done') {
    S.result = {mask: data.mask, w: data.w, h: data.h, ms: data.ms};
    paint();
  } else if (data.type === 'error') {
    toast(data.message, 'error');
  }
  if (pending) send();
  else { S.busy = false; emit(); }
};

/* ---------- painting ---------- */
export function setCanvas(c) { canvas = c; paint(); }

/** Paint the last result at cell resolution; CSS scales it up with hard edges. */
export function paint() {
  const r = S.result;
  if (!canvas || !r) return emit();
  if (canvas.width !== r.w || canvas.height !== r.h) { canvas.width = r.w; canvas.height = r.h; }
  const ctx = canvas.getContext('2d');
  ctx.putImageData(new ImageData(paintMask(r.mask, r.w, r.h, r.w, r.h, S.look.ink, S.look.paper), r.w, r.h), 0, 0);
  emit();
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
  if (!STYLE_BY_ID[id]) return;
  setSetting('style', id);
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

/* ---------- sources ---------- */
function setSource(c, kind, label) {
  const rgba = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  sourceId++;
  worker.postMessage({type: 'source', id: sourceId, rgba, w: c.width, h: c.height}, [rgba.buffer]);
  S.source = {kind, label, w: c.width, h: c.height};
  schedule(); emit();
}

export const SAMPLES = {spheres: 'Spheres', ramp: 'Tone ramp', type: 'Type'};

function sampleCanvas(kind) {
  const W = 1200, H = 800, c = makeCanvas(W, H), x = c.getContext('2d');
  if (kind === 'ramp') {
    // A smooth ramp on top, nine flat steps in the middle, a radial falloff below.
    let g = x.createLinearGradient(0, 0, W, 0);
    g.addColorStop(0, '#000'); g.addColorStop(1, '#fff');
    x.fillStyle = g; x.fillRect(0, 0, W, 260);
    for (let i = 0; i < 9; i++) { x.fillStyle = `hsl(0 0% ${i * 12.5}%)`; x.fillRect((i * W) / 9, 260, W / 9 + 1, 240); }
    x.fillStyle = '#fff'; x.fillRect(0, 500, W, 300);
    g = x.createRadialGradient(W / 2, 650, 10, W / 2, 650, 520);
    g.addColorStop(0, '#000'); g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g; x.fillRect(0, 500, W, 300);
  } else if (kind === 'type') {
    x.fillStyle = '#f2f2f2'; x.fillRect(0, 0, W, H);
    const g = x.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#1a1a1a'); g.addColorStop(1, '#8a8a8a');
    x.fillStyle = g;
    x.font = '700 300px system-ui, sans-serif';
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText('1-BIT', W / 2, H / 2 - 40);
    x.font = '500 64px system-ui, sans-serif';
    x.fillText('error, diffused', W / 2, H / 2 + 170);
  } else {
    let g = x.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#f3f1ec'); g.addColorStop(1, '#6f7a80');
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    const ball = (cx, cy, r, light, dark) => {
      x.save(); x.translate(cx, cy + r * 0.95); x.scale(1, 0.18);
      g = x.createRadialGradient(0, 0, 0, 0, 0, r * 1.3);
      g.addColorStop(0, 'rgba(0,0,0,.55)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = g; x.fillRect(-r * 1.4, -r * 1.4, r * 2.8, r * 2.8); x.restore();
      g = x.createRadialGradient(cx - r * 0.4, cy - r * 0.45, r * 0.05, cx, cy, r);
      g.addColorStop(0, '#ffffff'); g.addColorStop(0.25, light); g.addColorStop(0.8, dark); g.addColorStop(1, '#050505');
      x.fillStyle = g; x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.fill();
    };
    ball(470, 380, 270, '#d9c08a', '#4c3046');
    ball(910, 560, 130, '#a9c3d4', '#00304e');
    ball(170, 640, 70, '#c9d69a', '#3e4a19');
  }
  return c;
}

export function loadSample(kind) {
  if (!SAMPLES[kind]) kind = 'spheres';
  S.look.sample = kind; persist();
  setSource(sampleCanvas(kind), 'sample', SAMPLES[kind] + ' (sample)');
}

export function initSource() { loadSample(S.look.sample); }

export async function loadFile(file) {
  if (!file) return;
  if (!isImageFile(file)) return toast('Choose an image file', 'error');
  try {
    const c = await loadImageFile(file, 2400);
    setSource(c, 'image', file.name);
  } catch (e) {
    toast(e.message, 'error');
  }
}

/* ---------- export ---------- */
const fileBase = () => {
  const name = S.source.kind === 'image' ? S.source.label.replace(/\.[^.]+$/, '') : S.look.sample;
  return `${slug(name)}-${S.settings.style}`;
};

export function exportPNG() {
  const r = S.result;
  if (!r) return toast('Nothing to export yet');
  // Full size: each cell becomes a block of `block` pixels. Cells: one pixel per cell.
  const k = S.look.exportScale === 'cells' ? 1 : Math.max(1, Math.floor(S.settings.block));
  const w = r.w * k, h = r.h * k;
  const out = makeCanvas(w, h);
  out.getContext('2d').putImageData(new ImageData(paintMask(r.mask, r.w, r.h, w, h, S.look.ink, S.look.paper), w, h), 0, 0);
  out.toBlob(async b => {
    if (!b) return toast('PNG export failed', 'error');
    const res = await saveFile(fileBase() + '.png', b, 'image/png');
    toast(res.message, res.status === 'error' ? 'error' : 'info');
  }, 'image/png');
}
