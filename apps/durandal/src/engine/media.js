// Sources for the stage: sample images, image files, video files and the webcam,
// plus MP4 render (video) and live recording (webcam). Video plumbing comes from
// @studio/core, shared with GLYF.
import {
  loadImageFile, isImageFile, isVideoFile, openVideoFile, openWebcam,
  cameraErrorMessage, renderVideoToMp4, recordCanvas, makeCanvas, saveFile,
} from '@studio/core';
import {S, emit, persist, toast} from './state.js';
import {renderNow, idle, isBusy, scaledOutput, fitScale, setMirror, fileBase, paletteColors, reapplyKeys, keysApplied, schedule} from './render.js';
import {makeKey, putKey, STYLE_BY_ID, defaultParams} from '@studio/core/dither';
import {isProjectFile, openProject, takePendingKeys} from './project.js';

const M = () => S.media;
/** Internal handles; S.media mirrors what the UI shows. */
const live = {vid: null, file: null, dispose: null, recorder: null, recCanvas: null};
let lastVT = -1, lastEmit = 0, cancelExport = false, recTimer = 0;

/* ---------- samples ---------- */
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

/* ---------- switching sources ---------- */
function stopLive() {
  if (M().exporting) cancelExport = true;
  if (live.recorder) { live.recorder.discard(); live.recorder = null; endRecordingUI(); }
  if (live.dispose) live.dispose();
  Object.assign(live, {vid: null, file: null, dispose: null});
  Object.assign(M(), {playing: false, time: 0, duration: 0});
}

function setStill(c, kind, label) {
  stopLive();
  Object.assign(M(), {kind, label, w: c.width, h: c.height});
  renderNow(c).catch(() => {});
  emit();
}

export function loadSample(kind) {
  if (!SAMPLES[kind]) kind = 'spheres';
  S.look.sample = kind; persist();
  setStill(sampleCanvas(kind), 'sample', SAMPLES[kind] + ' (sample)');
}

export function initSource() { loadSample(S.look.sample); }

/** Open an image or a video file. */
export async function loadFile(file) {
  if (!file) return;
  if (isProjectFile(file)) return openProject(file);
  if (isVideoFile(file)) return loadVideo(file);
  if (!isImageFile(file)) return toast('Choose an image or video file', 'error');
  try {
    setStill(await loadImageFile(file, 2400), 'image', file.name);
  } catch (e) {
    toast(e.message, 'error');
  }
}

/* ---------- video and webcam ---------- */
/** Dither the video's current frame. The GPU takes it at native size; the worker gets a copy at most 1280 wide. */
const renderFrame = () => renderNow(live.vid, {mirror: M().kind === 'camera' && S.look.mirror});

function syncVideoUI(force = false) {
  const v = live.vid;
  if (!v || M().kind !== 'video') return;
  Object.assign(M(), {playing: !v.paused, time: v.currentTime, duration: isFinite(v.duration) ? v.duration : 0});
  const now = performance.now();
  if (force || now - lastEmit > 250) { lastEmit = now; emit(); }
}

/** Each animation frame: if the picture moved and the worker is free, dither the new frame. */
function startLoop(v) {
  lastVT = -1;
  const tick = () => {
    if (live.vid !== v) return;
    if (!M().exporting && !isBusy() && v.readyState >= 2 && v.currentTime !== lastVT) {
      lastVT = v.currentTime;
      renderFrame().catch(() => {});
    }
    syncVideoUI();
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

async function loadVideo(file) {
  let src;
  try { src = await openVideoFile(file, {muted: !M().sound, volume: M().volume}); }
  catch (e) { return toast(e.message, 'error'); }
  stopLive();
  const v = src.video;
  Object.assign(live, {vid: v, file, dispose: src.dispose});
  // Keyframes from an opened project that named this video come along.
  const waiting = takePendingKeys(file.name);
  Object.assign(M(), {kind: 'video', label: file.name, w: v.videoWidth, h: v.videoHeight, keys: waiting ? waiting.keys : [], ease: waiting ? waiting.ease : M().ease});
  reapplyKeys();
  if (waiting) toast(`Using ${waiting.keys.length} keyframes from the project`);
  startLoop(v);
  v.play().then(() => syncVideoUI(true)).catch(() => {
    // Autoplay with sound can be refused; fall back to muted.
    if (!v.muted) {
      v.muted = true; M().sound = false;
      toast('Playing muted. Turn sound on to hear it.');
      v.play().then(() => syncVideoUI(true)).catch(() => {});
    }
  });
  emit();
}

export function playPause() {
  const v = live.vid;
  if (!v || M().exporting) return;
  if (v.paused) v.play().then(() => syncVideoUI(true)).catch(() => {});
  else { v.pause(); syncVideoUI(true); }
}
export function seekFraction(f) {
  const v = live.vid;
  if (!v || M().exporting || !isFinite(v.duration)) return;
  v.pause();
  v.currentTime = f * v.duration;
  syncVideoUI(true);
}
/** Pause and jump to a time in seconds. */
export function seekTo(t) {
  const v = live.vid;
  if (!v || M().exporting) return;
  v.pause();
  v.currentTime = Math.max(0, Math.min(t, v.duration || t));
  syncVideoUI(true);
}

/* ---------- keyframes ---------- */
/** Keyframe the current settings at the current time (replacing one already there). */
export function setKeyframe() {
  const v = live.vid;
  if (!v || M().exporting) return;
  const t = v.currentTime, style = STYLE_BY_ID[S.settings.style];
  const params = {...defaultParams(style), ...(S.paramsByStyle[style.id] || {})};
  M().keys = putKey(M().keys, makeKey(t, S.settings, params));
  keysApplied(t);
  emit();
}
export function removeKeyframe(t) {
  M().keys = M().keys.filter(k => k.t !== t);
  reapplyKeys(); schedule(); emit();
}
export function clearKeyframes() {
  M().keys = [];
  emit();
}
export function setEase(on) {
  M().ease = on;
  reapplyKeys(); schedule(); emit();
}

export function setSound(on) {
  M().sound = on;
  if (live.vid && M().kind === 'video') { live.vid.muted = !on; live.vid.volume = M().volume; }
  emit();
}
export function setVolume(v) {
  M().volume = v;
  if (live.vid) live.vid.volume = v;
  if (!M().sound && v > 0) setSound(true); else emit();
}

export async function startWebcam(deviceId) {
  let cam;
  try { cam = await openWebcam(deviceId); }
  catch (e) { return toast(cameraErrorMessage(e), 'error'); }
  stopLive();
  Object.assign(live, {vid: cam.video, dispose: cam.dispose});
  Object.assign(M(), {kind: 'camera', label: cam.label || 'Webcam', w: cam.video.videoWidth, h: cam.video.videoHeight, cams: cam.cameras, camId: cam.deviceId});
  startLoop(cam.video);
  emit();
}
export function stopCamera() { loadSample(S.look.sample); }
export function setMirrorImage(on) { S.look.mirror = on; persist(); lastVT = -1; emit(); }

/* ---------- MP4 render (video files) ---------- */
export async function renderVideo() {
  const v = live.vid;
  if (!v || M().kind !== 'video') return;
  if (M().exporting) { cancelExport = true; return; }
  cancelExport = false;
  v.pause();
  Object.assign(M(), {exporting: true, progress: 'Starting…'});
  emit();
  const out = {canvas: null};
  let n = 0;
  try {
    await idle();
    const res = await renderVideoToMp4({
      video: v,
      file: live.file,
      fps: +S.look.fps || 30,
      audio: !!S.look.audio,
      background: S.settings.mode === 'palette' ? paletteColors()[0] : S.settings.mode === 'cmyk' ? '#ffffff' : S.look.paper,
      pixelated: true,
      renderFrame: async () => {
        const r = await renderFrame();
        // Blow each cell up by a whole number so blocks stay square and sharp.
        out.canvas = scaledOutput(fitScale(r, 1920), out.canvas, r);
        return out.canvas;
      },
      onProgress: p => {
        M().progress = p.phase;
        if (p.total) M().time = (p.frame / p.total) * v.duration;
        if (n++ % 3 === 0) emit();
      },
      isCancelled: () => cancelExport,
    });
    if (res.cancelled) toast('Render canceled');
    else {
      const saved = await saveFile(fileBase() + '.mp4', res.blob, 'video/mp4');
      toast(saved.message + (res.audioNote || ''), saved.status === 'error' ? 'error' : 'info');
    }
  } catch (e) {
    toast('Video render failed: ' + (e.message || e), 'error');
  }
  Object.assign(M(), {exporting: false, progress: ''});
  lastVT = -1;
  syncVideoUI(true);
  emit();
}

/* ---------- live recording (webcam) ---------- */
function endRecordingUI() {
  clearInterval(recTimer);
  setMirror(null);
  live.recCanvas = null;
  M().recording = false;
  emit();
}

export async function toggleRecord() {
  if (live.recorder) {
    const rec = live.recorder;
    live.recorder = null;
    endRecordingUI();
    const {blob, ext} = await rec.stop();
    if (blob.size) {
      const saved = await saveFile(fileBase() + '.' + ext, blob, blob.type);
      toast(saved.message, saved.status === 'error' ? 'error' : 'info');
    }
    return;
  }
  const r = S.result;
  if (!r) return toast('Nothing to record yet');
  // Record a scaled-up copy of the preview: the preview itself is only one pixel per cell.
  const k = fitScale(r, 1280);
  live.recCanvas = makeCanvas(Math.floor((r.w * k) / 2) * 2, Math.floor((r.h * k) / 2) * 2);
  setMirror(live.recCanvas);
  try { live.recorder = recordCanvas(live.recCanvas, 30); }
  catch (e) { setMirror(null); live.recCanvas = null; return toast(e.message, 'error'); }
  Object.assign(M(), {recording: true, recTime: 0});
  const t0 = performance.now();
  recTimer = setInterval(() => { M().recTime = (performance.now() - t0) / 1000; emit(); }, 250);
  emit();
}
