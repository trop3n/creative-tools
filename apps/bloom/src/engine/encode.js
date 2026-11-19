// Frame-accurate MP4 from generated frames (WebCodecs + mp4-muxer, no audio).
// TODO: a matching encodeFramesToMp4 is landing in @studio/core with LEELA's export
// work; switch to it once that is merged, and delete this file.
import {Muxer, ArrayBufferTarget} from 'mp4-muxer';

export const canEncodeVideo = () => typeof window !== 'undefined' && 'VideoEncoder' in window;

async function pickConfig(w, h, fps) {
  const bitrate = Math.min(40e6, Math.round(w * h * fps * 0.3));
  for (const [m, codec] of [['avc', 'avc1.640033'], ['avc', 'avc1.4d0033'], ['vp9', 'vp09.00.41.08']]) {
    const conf = {codec, width: w, height: h, bitrate, framerate: fps};
    try { if ((await VideoEncoder.isConfigSupported(conf)).supported) return {conf, m}; } catch (e) {}
  }
  return null;
}

/**
 * @param {{width: number, height: number, fps: number, frames: number,
 *   drawFrame: (i: number) => CanvasImageSource, onProgress?: (done: number, total: number) => void,
 *   isCancelled?: () => boolean}} o
 * @returns {Promise<Blob | null>} null when cancelled
 */
export async function encodeFrames(o) {
  const {fps, frames, drawFrame, onProgress = () => {}, isCancelled = () => false} = o;
  if (!canEncodeVideo()) throw new Error('This browser cannot encode video. Use Chrome or Edge.');
  const W = Math.max(2, Math.floor(o.width / 2) * 2), H = Math.max(2, Math.floor(o.height / 2) * 2);
  const picked = await pickConfig(W, H, fps);
  if (!picked) throw new Error(`This browser cannot encode ${W}×${H} video. Try a smaller size.`);
  const target = new ArrayBufferTarget();
  const muxer = new Muxer({target, video: {codec: picked.m, width: W, height: H, frameRate: fps}, fastStart: 'in-memory'});
  let err = null;
  const enc = new VideoEncoder({output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: e => { err = e; }});
  enc.configure(picked.conf);
  try {
    for (let i = 0; i < frames; i++) {
      if (isCancelled()) return null;
      if (err) throw err;
      const frame = new VideoFrame(drawFrame(i), {timestamp: Math.round((i * 1e6) / fps), duration: Math.round(1e6 / fps)});
      enc.encode(frame, {keyFrame: i % (fps * 2) === 0});
      frame.close();
      while (enc.encodeQueueSize > 4) await new Promise(r => setTimeout(r, 4));
      if (i % 4 === 0) { onProgress(i + 1, frames); await new Promise(r => setTimeout(r, 0)); }
    }
    await enc.flush();
    if (err) throw err;
    muxer.finalize();
    return new Blob([target.buffer], {type: 'video/mp4'});
  } finally {
    try { if (enc.state !== 'closed') enc.close(); } catch (e) {}
  }
}
