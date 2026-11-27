// Live link: one tool's picture streams into another tool's Source, like a webcam,
// between windows of the built suite (same origin, so a BroadcastChannel reaches them).
//
//   sender:   const live = createLiveSender({label, onWatch}); …after each draw: live.frame(canvas)
//   receiver: watchLiveSources(list => …); const cam = await openLiveSource(id) — the same
//             shape as openWebcam(): {video, dispose, label, deviceId, cameras}
//
// Frames go out only while someone watches, at most 20 a second, as WebP at up to 960 px.
// Browsers stop drawing in hidden tabs, so the sending tool has to stay visible: put the
// two windows side by side.
import {TOOL_NAMES, currentTool} from './suite.js';

const CHANNEL = 'studio.live', MAX_SIDE = 960, FPS = 20, STALE = 3000;
const tabId = Math.random().toString(36).slice(2, 10);
let chan = null;
function channel() {
  if (!chan && typeof BroadcastChannel !== 'undefined') { chan = new BroadcastChannel(CHANNEL); chan.unref?.(); }
  return chan;
}
const makeCanvas = (w, h) => (typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), {width: w, height: h}));
const toBlob = c => (c.convertToBlob ? c.convertToBlob({type: 'image/webp', quality: 0.9}) : new Promise(r => c.toBlob(r, 'image/webp', 0.9)));

/**
 * Offer this tool's picture to other windows. Call frame(canvas) right after each draw
 * (it copies at once, so a WebGL canvas is read before it clears). onWatch() is called
 * when a new window starts watching, so a still can draw once more for it.
 */
export function createLiveSender({label = '', onWatch} = {}) {
  const ch = channel(), tool = currentTool();
  if (!ch || !tool) return {frame() {}, stop() {}, watched: () => false};
  const watchers = new Map(); // receiver id -> last "want"
  let lastSent = 0, busy = false, last = null, small = null, stopped = false;
  const here = () => ch.postMessage({type: 'here', id: tabId, tool, label: typeof label === 'function' ? label() : label});
  const send = f => ch.postMessage({type: 'frame', id: tabId, ...f});
  const watched = () => {
    const now = Date.now();
    for (const [rx, t] of watchers) if (now - t > STALE) watchers.delete(rx);
    return watchers.size > 0;
  };
  const onMsg = ({data: m}) => {
    if (!m || stopped) return;
    if (m.type === 'hello') here();
    else if (m.type === 'want' && m.id === tabId) {
      const fresh = !watchers.has(m.rx);
      watchers.set(m.rx, Date.now());
      if (fresh) { if (last) send(last); onWatch?.(); }
    }
  };
  ch.addEventListener('message', onMsg);
  here();
  const beat = setInterval(here, 1000);
  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearInterval(beat);
    ch.removeEventListener('message', onMsg);
    ch.postMessage({type: 'bye', id: tabId});
  };
  if (typeof window !== 'undefined') window.addEventListener('pagehide', stop);
  return {
    watched,
    stop,
    frame(src) {
      if (stopped || busy || !src || !watched()) return;
      const now = performance.now();
      if (now - lastSent < 1000 / FPS) return;
      const sw = src.videoWidth || src.width, sh = src.videoHeight || src.height;
      if (!sw || !sh) return;
      const k = Math.min(1, MAX_SIDE / Math.max(sw, sh)), w = Math.max(2, Math.round(sw * k)), h = Math.max(2, Math.round(sh * k));
      if (!small || small.width !== w || small.height !== h) small = makeCanvas(w, h);
      small.getContext('2d').drawImage(src, 0, 0, w, h);
      lastSent = now;
      busy = true;
      toBlob(small)
        .then(blob => { if (blob) { last = {blob, w, h}; send(last); } })
        .catch(() => {})
        .finally(() => { busy = false; });
    },
  };
}

/** Live sources open in other windows: fn([{id, tool, name, label}]) now and as they come and go. */
export function watchLiveSources(fn) {
  const ch = channel();
  if (!ch || !currentTool()) { fn([]); return () => {}; }
  const seen = new Map();
  const list = () => fn([...seen.entries()].map(([id, s]) => ({id, tool: s.tool, name: TOOL_NAMES[s.tool] || s.tool, label: s.label || ''})));
  const onMsg = ({data: m}) => {
    if (!m || m.id === tabId) return;
    if (m.type === 'here') { const known = seen.has(m.id); seen.set(m.id, {tool: m.tool, label: m.label, at: Date.now()}); if (!known) list(); }
    else if (m.type === 'bye' && seen.delete(m.id)) list();
  };
  ch.addEventListener('message', onMsg);
  ch.postMessage({type: 'hello'});
  const sweep = setInterval(() => {
    let gone = false;
    for (const [id, s] of seen) if (Date.now() - s.at > STALE) { seen.delete(id); gone = true; }
    if (gone) list();
  }, 1000);
  list();
  return () => { clearInterval(sweep); ch.removeEventListener('message', onMsg); };
}

/**
 * Watch a live source: resolves to a playing <video> of it, shaped like openWebcam()'s
 * result, once the first frame arrives (or rejects after 6 s).
 */
export async function openLiveSource(id, label = '') {
  const ch = channel();
  if (!ch) throw new Error('The live link needs the built suite');
  const rx = Math.random().toString(36).slice(2, 10);
  const canvas = document.createElement('canvas');
  canvas.width = 640; canvas.height = 360;
  const ctx = canvas.getContext('2d');
  let decoding = false, frames = 0;
  const onMsg = async ({data: m}) => {
    if (!m || m.type !== 'frame' || m.id !== id || decoding) return; // drop frames while one decodes
    decoding = true;
    try {
      const bmp = await createImageBitmap(m.blob);
      if (canvas.width !== bmp.width || canvas.height !== bmp.height) { canvas.width = bmp.width; canvas.height = bmp.height; }
      ctx.drawImage(bmp, 0, 0);
      bmp.close();
      frames++;
    } catch (e) { /* a frame that won't decode is skipped */ }
    decoding = false;
  };
  ch.addEventListener('message', onMsg);
  const want = () => ch.postMessage({type: 'want', id, rx});
  want();
  const beat = setInterval(want, 1000);
  const stream = canvas.captureStream(30);
  const video = document.createElement('video');
  video.muted = true; video.playsInline = true; video.srcObject = stream;
  const dispose = () => {
    clearInterval(beat);
    ch.removeEventListener('message', onMsg);
    stream.getTracks().forEach(t => t.stop());
    video.srcObject = null;
  };
  const until = (ok, ms, message) => new Promise((resolve, reject) => {
    const t0 = Date.now();
    const check = () => (ok() ? resolve() : Date.now() - t0 > ms ? reject(Object.assign(new Error(message), {name: 'TimeoutError'})) : setTimeout(check, 50));
    check();
  });
  try {
    await until(() => frames > 0, 6000, 'That window sent no picture. Keep it open and visible, side by side with this one.');
    await video.play().catch(() => {});
    await until(() => video.readyState >= 2 && video.videoWidth > 0, 4000, 'The live picture did not start');
  } catch (e) {
    dispose();
    throw e;
  }
  return {video, dispose, label: label || 'Live', deviceId: '', cameras: []};
}
