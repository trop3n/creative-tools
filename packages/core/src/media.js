// Image, video and webcam sources, each delivered as frames drawn onto a canvas
// that a tool reads from.

export const makeCanvas = (w, h) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
};

export const isVideoFile = f => !!f && (/^video\//.test(f.type) || /\.(mp4|m4v|mov|webm|mkv|ogv)$/i.test(f.name));
export const isImageFile = f => !!f && /^image\//.test(f.type);
export const isMediaFile = f => isImageFile(f) || isVideoFile(f);

/** Decode an image file onto a canvas (white behind transparency), capped at maxSide. */
export function loadImageFile(file, maxSide = 2000) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      let w = img.naturalWidth || 800, h = img.naturalHeight || 800;
      const k = Math.min(1, maxSide / Math.max(w, h));
      w = Math.round(w * k);
      h = Math.round(h * k);
      const c = makeCanvas(w, h), x = c.getContext('2d');
      x.fillStyle = '#fff';
      x.fillRect(0, 0, w, h);
      x.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      resolve(c);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('That image could not be read'));
    };
    img.src = url;
  });
}

/** A canvas sized to the video's aspect, capped at maxSide, for frames to be drawn into. */
export function frameCanvasFor(video, maxSide = 960) {
  const k = Math.min(1, maxSide / Math.max(video.videoWidth, video.videoHeight));
  return makeCanvas(Math.max(2, Math.round(video.videoWidth * k)), Math.max(2, Math.round(video.videoHeight * k)));
}

/** Draw the current video frame into canvas, optionally mirrored. */
export function drawVideoFrame(video, canvas, mirror = false) {
  const x = canvas.getContext('2d'), w = canvas.width, h = canvas.height;
  if (mirror) {
    x.setTransform(-1, 0, 0, 1, w, 0);
    x.drawImage(video, 0, 0, w, h);
    x.setTransform(1, 0, 0, 1, 0, 0);
  } else x.drawImage(video, 0, 0, w, h);
}

/**
 * Open a video file. Resolves once the first frame is decodable.
 * @returns {Promise<{video: HTMLVideoElement, file: File, dispose: () => void}>}
 */
export function openVideoFile(file, {muted = true, volume = 0.8, loop = true} = {}) {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.muted = muted;
    video.volume = volume;
    video.loop = loop;
    video.playsInline = true;
    video.preload = 'auto';
    const url = URL.createObjectURL(file);
    const dispose = () => {
      video.pause();
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(url);
    };
    video.onloadeddata = () => {
      video.onloadeddata = null;
      resolve({video, file, dispose});
    };
    video.onerror = () => {
      dispose();
      reject(new Error('That video could not be read. Try MP4 (H.264) or WebM.'));
    };
    video.src = url;
  });
}

/** Seek and wait for the frame (with a timeout so a stuck seek cannot hang a render). */
export function seekVideo(video, t) {
  return new Promise(resolve => {
    if (Math.abs(video.currentTime - t) < 1e-4) return resolve();
    let done = false;
    const fin = () => {
      if (done) return;
      done = true;
      video.removeEventListener('seeked', fin);
      resolve();
    };
    video.addEventListener('seeked', fin);
    setTimeout(fin, 4000);
    video.currentTime = t;
  });
}

/** Human-readable reason a webcam could not start. */
export function cameraErrorMessage(e) {
  const n = e && e.name;
  if (n === 'NotFoundError' || n === 'OverconstrainedError') return 'No camera found';
  if (n === 'NotAllowedError' || n === 'SecurityError')
    return 'Camera blocked. The claude.ai viewer does not allow cameras; open the tool from its own address in Chrome or Edge.';
  return 'Camera failed to start' + (e && e.message ? ': ' + e.message : '');
}

/**
 * Open a webcam (no audio).
 * @returns {Promise<{video, stream, label, deviceId, cameras: Array<{value, label}>, dispose}>}
 */
export async function openWebcam(deviceId) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia)
    throw Object.assign(new Error('Camera access is not available on this page'), {name: 'SecurityError'});
  const constraints = {width: {ideal: 1280}, height: {ideal: 720}};
  if (deviceId) constraints.deviceId = {exact: deviceId};
  const stream = await navigator.mediaDevices.getUserMedia({video: constraints, audio: false});
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  await new Promise(r => { video.onloadeddata = r; video.play().catch(() => {}); });
  const track = stream.getVideoTracks()[0];
  let cameras = [];
  try {
    cameras = (await navigator.mediaDevices.enumerateDevices())
      .filter(d => d.kind === 'videoinput')
      .map((d, i) => ({value: d.deviceId, label: d.label || 'Camera ' + (i + 1)}));
  } catch (e) {}
  const dispose = () => {
    stream.getTracks().forEach(t => t.stop());
    video.pause();
    video.srcObject = null;
  };
  return {
    video,
    stream,
    label: (track && track.label) || 'Webcam',
    deviceId: (track && track.getSettings && track.getSettings().deviceId) || '',
    cameras,
    dispose,
  };
}
