// GLYF's sources: built-in samples plus the shared image / video / webcam sources
// and video exporters from @studio/core.
import {
  loadImageFile, isVideoFile, isMediaFile, openVideoFile, openWebcam, frameCanvasFor, drawVideoFrame,
  cameraErrorMessage, renderVideoToMp4, encodeFramesToMp4, recordCanvas, makeCanvas as mk, takeSent, TOOL_NAMES, openLiveSource,
  noteIncoming, noteStart, registerRecipeTool,
} from '@studio/core';
import {S, emit, toast, saveFile, saveGen, cleanGen, useRecipeSet, genSet} from './store.js';
import {render, schedule, getOutCanvas, fileBase, renderSettled, pngBlob, setGen} from './generator.js';
import {fixedSize, frameRatio, FRAME_RATIOS, CUSTOM, cleanSide} from '@studio/core/frames';
import {drawRibbons} from './ribbons.js';
import {drawPattern, PATTERNS} from './patterns.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
/** Internal source state; S.media mirrors what the UI shows. */
export const media = {src: null, kind: 'sample', exporting: false, vid: null, file: null, dispose: null, recorder: null};
const M = () => S.media;
const SAMPLE_NAMES = {sphere: 'Spheres', rings: 'Rings', ramp: 'Ramp', ribbons: 'Ribbons', pattern: 'Pattern'};

/* ---------- samples ---------- */
function sampleCanvas(kind) {
  const W = 960, H = 720, c = mk(W, H), x = c.getContext('2d');
  if (kind === 'sphere') {
    let g = x.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#eef2f4'); g.addColorStop(1, '#7d919c'); x.fillStyle = g; x.fillRect(0, 0, W, H);
    const shadow = (cx, cy, r) => { x.save(); x.translate(cx, cy); x.scale(1, 0.2); g = x.createRadialGradient(0, 0, 0, 0, 0, r); g.addColorStop(0, 'rgba(10,20,28,.55)'); g.addColorStop(1, 'rgba(10,20,28,0)'); x.fillStyle = g; x.fillRect(-r, -r, 2 * r, 2 * r); x.restore(); };
    shadow(500, 640, 330); shadow(780, 650, 150);
    const ball = (cx, cy, r, stops) => { g = x.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.05, cx, cy, r); stops.forEach((s, i) => g.addColorStop(i / (stops.length - 1), s)); x.fillStyle = g; x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.fill(); };
    ball(420, 360, 250, ['#fff4da', '#e3b862', '#9a5a4e', '#4c3046', '#140c14']);
    ball(790, 545, 105, ['#d9ecf5', '#3a7aa0', '#00304e', '#03111b']);
    ball(165, 600, 55, ['#eef4d4', '#90a344', '#3e4a19']);
  } else if (kind === 'rings') {
    const im = x.createImageData(W, H), d = im.data;
    for (let y = 0; y < H; y++) for (let X = 0; X < W; X++) {
      const dx = X - 470, dy = y - 340, r = Math.hypot(dx, dy), a = Math.atan2(dy, dx);
      const L = clamp(0.5 + 0.5 * Math.cos(r * 0.05 - a * 3 + Math.sin(r * 0.012) * 2) * Math.exp(-r / 700), 0, 1);
      const t = X / W, i = (y * W + X) * 4;
      d[i] = (76 + (201 - 76) * t) * L + 20 * (1 - L); d[i + 1] = (48 + (149 - 48) * t) * L + 14 * (1 - L); d[i + 2] = (70 + (48 - 70) * t) * L + 22 * (1 - L); d[i + 3] = 255;
    }
    x.putImageData(im, 0, 0);
  } else {
    let g = x.createLinearGradient(0, 0, W, 0); g.addColorStop(0, '#000'); g.addColorStop(1, '#fff'); x.fillStyle = g; x.fillRect(0, 0, W, H);
    g = x.createLinearGradient(260, 0, 700, 0); g.addColorStop(0, '#fff'); g.addColorStop(1, '#000'); x.fillStyle = g;
    x.beginPath(); x.arc(480, 360, 230, 0, Math.PI * 2); x.fill();
    for (let i = 0; i < 8; i++) { x.fillStyle = `hsl(0 0% ${i * 14}%)`; x.fillRect(i * 120, 640, 120, 80); }
  }
  return c;
}
function setSource(canvas, kind, label) {
  media.src = canvas; media.kind = kind;
  Object.assign(M(), {kind, label, playing: false, time: 0, duration: 0});
  emit(); schedule();
}
export function useSample(kind) {
  stopVideo(); S.gen.sample = kind; saveGen(); noteStart();
  if (kind === 'ribbons') return startRibbons();
  if (kind === 'pattern') return startPattern();
  setSource(sampleCanvas(kind), 'sample', SAMPLE_NAMES[kind] + ' (sample)');
}
export function initSource() {
  const k = SAMPLE_NAMES[S.gen.sample] ? S.gen.sample : 'sphere';
  S.gen.sample = k;
  // Sent from another tool (Send to → GLYF): the file waits on the shelf.
  takeSent().then(file => {
    if (!file) return;
    loadMediaFile(file);
    toast(`Opened ${file.name} from ${TOOL_NAMES[file.from] || 'another tool'}`);
  });
  registerRecipeTool(recipeHooks); // a recipe run starts after this, once it has read its step
  if (k === 'ribbons') { startRibbons(); return; }
  if (k === 'pattern') { startPattern(); return; }
  media.src = sampleCanvas(k);
  M().label = SAMPLE_NAMES[k] + ' (sample)';
}

/* ---------- recipes ---------- */
// A recipe step here: the generator settings (the built-in source among them) and the
// glyphs of the set, so a later library edit or another browser makes the same picture.
// The glyphs are used for this run only (S.recipeSet); the library isn't touched.
const nextFrame = () => new Promise(r => requestAnimationFrame(r));
const recipeHooks = {
  toast,
  getSettings: () => ({gen: S.gen, glyphs: genSet().map(s => ({name: s.name, els: s.els}))}),
  applySettings(s) {
    if (!s || typeof s !== 'object') return;
    Object.assign(S.gen, cleanGen(s.gen)); saveGen();
    if (Array.isArray(s.glyphs)) useRecipeSet(s.glyphs);
    if (S.view !== 'gen') { S.view = 'gen'; history.replaceState(null, '', '#generate'); }
    if (SAMPLE_NAMES[S.gen.sample]) useSample(S.gen.sample); else { emit(); schedule(); }
  },
  setSize(w, h) {
    setGen('customW', cleanSide(w, S.gen.customW));
    setGen('customH', cleanSide(h, S.gen.customH));
    setGen('frame', CUSTOM.id);
  },
  async load(f) {
    if (!isMediaFile(f)) throw new Error(`${f.name} is not an image or a video`);
    await loadMediaFile(f);
    if (M().label !== f.name) throw new Error(`could not open ${f.name}`);
  },
  async ready() {
    for (let n = 0; !getOutCanvas() && n < 600; n++) await nextFrame(); // the stage's canvas mounts with the page
    if (!(await renderSettled())) throw new Error(S.ramp.length ? 'there is nothing to show' : 'the glyph set has no glyphs with ink');
  },
  renderStill: pngBlob,
  async renderVideo() {
    let out = null;
    const take = res => { if (!res.cancelled) out = {blob: res.blob, name: fileBase() + '.mp4'}; };
    if (media.kind === 'video' && media.vid) await videoMp4(take);
    else if (media.kind === 'ribbons') await ribbonsMp4(take);
    else throw new Error('GLYF makes video from a video, or from Ribbons');
    return out;
  },
};

/* ---------- patterns: procedural still sources ---------- */
let patKey = '';
const patLabel = () => 'Pattern: ' + (PATTERNS.find(p => p.id === S.gen.patKind) || PATTERNS[0]).name;
/** Redraw the pattern if its settings or the frame changed (the generator calls this before each render). */
export function refreshPattern() {
  if (media.kind !== 'pattern') return;
  const g = S.gen, r = frameRatio(g.frame, FRAME_RATIOS, [g.customW, g.customH]) || 4 / 3, L = 640;
  const [W, H] = r >= 1 ? [L, Math.round(L / r)] : [Math.round(L * r), L];
  const p = {kind: g.patKind, scale: g.patScale, detail: g.patDetail, angle: g.patAngle, seed: g.patSeed}, key = JSON.stringify([W, H, p]);
  if (key === patKey && media.src) return;
  patKey = key;
  const c = media.src && media.src.width === W && media.src.height === H ? media.src : mk(W, H), x = c.getContext('2d');
  const im = x.createImageData(W, H);
  drawPattern(im.data, W, H, p);
  x.putImageData(im, 0, 0);
  media.src = c;
  M().label = patLabel();
}
function startPattern() {
  media.src = null; media.kind = 'pattern'; patKey = '';
  Object.assign(M(), {kind: 'pattern', label: patLabel(), playing: false, time: 0, duration: 0});
  refreshPattern(); emit(); schedule();
}

/* ---------- ribbons: a moving built-in source ---------- */
let ribT = 0, ribLast = 0, ribKey = '', ribTok = 0;
const ribParams = () => {
  const g = S.gen;
  return {count: g.ribCount, width: g.ribWidth, wander: g.ribWander, patches: g.ribPatches, loop: g.ribLoop, seed: g.ribSeed, palette: g.palette, background: '#000'};
};
/** The ribbons' canvas: the frame's shape (16:9 for Same as the source), 1280 on the long side. */
function ribSize() {
  const g = S.gen, r = frameRatio(g.frame, FRAME_RATIOS, [g.customW, g.customH]) || 16 / 9;
  return r >= 1 ? [1280, Math.round(1280 / r)] : [Math.round(1280 * r), 1280];
}
/** Draw the ribbons at time t into the source canvas; true if anything changed. */
function paintRibbons(t) {
  const [W, H] = ribSize(), p = ribParams(), key = JSON.stringify([W, H, t, p]);
  if (key === ribKey && media.src && media.src.width === W && media.src.height === H) return false;
  ribKey = key;
  if (!media.src || media.src.width !== W || media.src.height !== H) media.src = mk(W, H);
  drawRibbons(media.src.getContext('2d'), W, H, t, p);
  return true;
}
function startRibbons() {
  ribT = 0; ribKey = ''; media.src = null; media.kind = 'ribbons';
  Object.assign(M(), {kind: 'ribbons', label: 'Ribbons', playing: true, time: 0, duration: S.gen.ribLoop});
  paintRibbons(0); emit(); schedule();
  const tok = ++ribTok; // choosing Ribbons again starts a fresh loop and ends this one
  const tick = now => {
    if (media.kind !== 'ribbons' || tok !== ribTok) return;
    const dt = ribLast ? Math.min(0.1, (now - ribLast) / 1000) : 0;
    ribLast = now;
    if (!media.exporting) {
      const loop = S.gen.ribLoop;
      if (M().playing) ribT = (ribT + dt) % loop;
      if (S.view === 'gen' && !busy && paintRibbons(ribT)) { busy = true; render(true).finally(() => { busy = false; }); }
      M().time = ribT; M().duration = loop;
      if (now - lastEmit > 250) { lastEmit = now; emit(); }
    }
    requestAnimationFrame(tick);
  };
  ribLast = 0;
  requestAnimationFrame(tick);
}
export function seekRibbons(f) { if (media.kind === 'ribbons' && !media.exporting) { ribT = f * S.gen.ribLoop; M().time = ribT; emit(); } }

/** Render whole loops of the ribbons to MP4, frame by frame; a loop's last frame leads into its first. */
export async function renderRibbons() {
  if (media.kind !== 'ribbons') return;
  if (media.exporting) { exportCancel = true; return; }
  try {
    await ribbonsMp4(async res => {
      if (res.cancelled) toast('Render canceled');
      else {
        await saveFile(fileBase() + '.mp4', res.blob, 'video/mp4');
        if (res.codecNote) setTimeout(() => toast('Video saved' + res.codecNote), 2300);
      }
    });
  } catch (e) { toast('Video render failed: ' + (e.message || e), 'error'); }
}
/** Render the ribbons' loops to MP4 and hand the result ({blob} or {cancelled}) to `take` while the render state still holds; throws if it fails. */
async function ribbonsMp4(take) {
  const g = S.gen, fps = +g.fps || 30, perLoop = Math.round(g.ribLoop * fps), frames = perLoop * Math.max(1, g.ribLoops);
  media.exporting = true; exportCancel = false; M().exporting = true; M().progress = 'Starting…'; emit();
  let n = 0, even = null, failed = null;
  try {
    paintRibbons(0); await render(true);
    const out = getOutCanvas(), W = out.width & ~1, H = out.height & ~1;
    even = mk(W, H);
    const res = await encodeFramesToMp4({
      width: W, height: H, fps, frames,
      drawFrame: async i => {
        paintRibbons(((i % perLoop) / perLoop) * g.ribLoop);
        await render(true);
        const x = even.getContext('2d'); x.drawImage(getOutCanvas(), 0, 0);
        return even;
      },
      onProgress: p => { M().progress = p.phase; if (n++ % 3 === 0) emit(); },
      isCancelled: () => exportCancel,
    });
    await take(res);
  } catch (e) { failed = e; }
  media.exporting = false; M().exporting = false; M().progress = ''; ribKey = ''; emit(); schedule();
  if (failed) throw failed;
}

/* ---------- files ---------- */
export const acceptsMedia = isMediaFile;
export async function loadMediaFile(f) {
  if (!f) return;
  if (isVideoFile(f)) return loadVideoFile(f);
  if (!isMediaFile(f)) return toast('Choose an image or video file', 'error');
  try {
    const c = await loadImageFile(f);
    stopVideo(); S.gen.sample = null; setSource(c, 'image', f.name); noteIncoming(f);
  } catch (e) { toast(e.message, 'error'); }
}

/* ---------- video and webcam playback ---------- */
let lastVT = -1, busy = false, lastEmit = 0, exportCancel = false;
export function stopVideo() {
  if (media.exporting) exportCancel = true;
  if (media.recorder) { media.recorder.discard(); media.recorder = null; M().recording = false; clearInterval(recTimer); }
  if (media.dispose) { media.dispose(); media.dispose = null; }
  media.vid = null; media.file = null;
}
const grabFrame = () => { if (media.vid && media.src) drawVideoFrame(media.vid, media.src, media.kind === 'camera' && !M().live && M().mirror); };
function syncVidUI(force) {
  const v = media.vid; if (!v) return;
  const now = performance.now();
  M().playing = !v.paused; M().time = v.currentTime; M().duration = isFinite(v.duration) ? v.duration : 0;
  if (force || now - lastEmit > 250) { lastEmit = now; emit(); }
}
function vidLoop(v) {
  const tick = () => {
    if (media.vid !== v) return;
    if (!media.exporting && !v.paused && S.view === 'gen' && !busy && v.currentTime !== lastVT) {
      lastVT = v.currentTime; busy = true; grabFrame();
      render(true).finally(() => { busy = false; });
    }
    if (!media.exporting && media.kind === 'video') syncVidUI();
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
export async function loadVideoFile(f) {
  let src;
  try { src = await openVideoFile(f, {muted: !M().sound, volume: M().volume}); }
  catch (e) { return toast(e.message, 'error'); }
  stopVideo(); noteIncoming(f);
  const v = src.video;
  media.vid = v; media.file = f; media.dispose = src.dispose; lastVT = -1; S.gen.sample = null;
  setSource(frameCanvasFor(v), 'video', f.name);
  grabFrame(); schedule(); vidLoop(v);
  v.addEventListener('seeked', () => { if (!media.exporting && media.vid === v) { grabFrame(); schedule(); syncVidUI(true); } });
  v.play().then(() => syncVidUI(true)).catch(() => {
    if (!v.muted) { v.muted = true; M().sound = false; toast('Playing muted. Turn sound on to hear it.'); v.play().then(() => syncVidUI(true)).catch(() => {}); }
  });
}
export function playPause() {
  if (media.kind === 'ribbons') { if (!media.exporting) { M().playing = !M().playing; emit(); } return; }
  const v = media.vid; if (!v || media.exporting) return;
  if (v.paused) v.play().then(() => syncVidUI(true)).catch(() => {}); else { v.pause(); syncVidUI(true); }
}
export function seekFraction(f) {
  const v = media.vid; if (!v || media.exporting || !isFinite(v.duration)) return;
  v.pause(); v.currentTime = f * v.duration;
}
export function setSound(on) { M().sound = on; if (media.vid && media.kind === 'video') { media.vid.muted = !on; media.vid.volume = M().volume; } emit(); }
export function setVolume(v) { M().volume = v; if (media.vid) media.vid.volume = v; if (!M().sound && v > 0) setSound(true); else emit(); }
export function pauseForHidden() { if (media.vid && media.kind === 'video' && !media.vid.paused) { media.vid.pause(); syncVidUI(true); } }
export function resumeForShown() { if (media.kind === 'camera' && media.vid && media.vid.paused) media.vid.play().catch(() => {}); schedule(); }

/* ---------- MP4 render ---------- */
export async function renderVideo() {
  const v = media.vid; if (!v || media.kind !== 'video') return;
  if (media.exporting) { exportCancel = true; return; }
  try {
    await videoMp4(async res => {
      if (res.cancelled) toast('Render canceled');
      else {
        await saveFile(fileBase() + '.mp4', res.blob, 'video/mp4');
        if (res.audioNote || res.codecNote) setTimeout(() => toast('Video saved' + res.audioNote + res.codecNote), 2300);
      }
    });
  } catch (e) { toast('Video render failed: ' + (e.message || e), 'error'); }
}
/** Render the video to MP4 and hand the result to `take`, as ribbonsMp4 does. */
async function videoMp4(take) {
  const v = media.vid;
  media.exporting = true; exportCancel = false; v.pause();
  M().exporting = true; M().progress = 'Starting…'; emit();
  let n = 0, failed = null;
  try {
    const res = await renderVideoToMp4({
      video: v, file: media.file, fps: +S.gen.fps || 30, audio: !!S.gen.audio, background: S.gen.paper,
      maxSide: Math.max(...(fixedSize(S.gen.frame, [S.gen.customW, S.gen.customH]) || [1920])), // a fixed frame keeps its exact size
      renderFrame: async () => { grabFrame(); await render(true); return getOutCanvas(); },
      onProgress: p => { M().progress = p.phase; if (p.total) M().time = (p.frame / p.total) * v.duration; if (n++ % 3 === 0) emit(); },
      isCancelled: () => exportCancel,
    });
    await take(res);
  } catch (e) { failed = e; }
  media.exporting = false; M().exporting = false; M().progress = ''; syncVidUI(true); emit();
  if (failed) throw failed;
}

/* ---------- webcam (and a live picture from another window, which plays the same way, unmirrored) ---------- */
export async function startWebcam(deviceId, live) {
  let cam;
  try { cam = await (live ? openLiveSource(live.id, 'Live: ' + live.name) : openWebcam(deviceId)); }
  catch (e) { return toast(live ? e.message : cameraErrorMessage(e), 'error'); }
  stopVideo(); noteIncoming({name: 'camera'});
  media.vid = cam.video; media.dispose = cam.dispose; lastVT = -1; S.gen.sample = null;
  M().cams = cam.cameras; M().camId = cam.deviceId; M().live = !!live;
  setSource(frameCanvasFor(cam.video), 'camera', cam.label);
  grabFrame(); vidLoop(cam.video);
}
export const startLive = (id, name) => startWebcam('', {id, name});
export function setMirror(on) { M().mirror = on; grabFrame(); emit(); schedule(); }
export function stopCamera() { useSample('sphere'); }

let recTimer = null;
export async function toggleRecord() {
  if (media.recorder) {
    const rec = media.recorder; media.recorder = null; clearInterval(recTimer);
    M().recording = false; emit();
    const {blob, ext} = await rec.stop();
    if (blob.size) saveFile('glyf-webcam-' + S.gen.cols + '.' + ext, blob, blob.type);
    return;
  }
  try { media.recorder = recordCanvas(getOutCanvas(), 30); }
  catch (e) { return toast(e.message, 'error'); }
  M().recording = true; M().recTime = 0; emit();
  const t0 = performance.now();
  recTimer = setInterval(() => { M().recTime = (performance.now() - t0) / 1000; emit(); }, 250);
}
