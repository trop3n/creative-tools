// Video out: an offline, frame-accurate MP4 renderer (WebCodecs + mp4-muxer,
// with the source's audio passed through) and a live canvas recorder.
import {Muxer, ArrayBufferTarget} from 'mp4-muxer';
import {makeCanvas, seekVideo} from './media.js';

export const canEncodeVideo = () => 'VideoEncoder' in window;

async function prepareAudio(file) {
  const AC = window.AudioContext || window.webkitAudioContext;
  const ac = new AC({sampleRate: 48000});
  let ab;
  try {
    ab = await ac.decodeAudioData(await file.arrayBuffer());
  } finally {
    ac.close();
  }
  if (!ab || !ab.length) return null;
  const ch = Math.min(2, ab.numberOfChannels);
  for (const [m, codec] of [['aac', 'mp4a.40.2'], ['opus', 'opus']]) {
    const conf = {codec, sampleRate: ab.sampleRate, numberOfChannels: ch, bitrate: 192000};
    try {
      if ((await AudioEncoder.isConfigSupported(conf)).supported) return {ab, ch, m, conf};
    } catch (e) {}
  }
  return {ab, ch, m: null, conf: null};
}

async function encodeAudio(audio, muxer, maxSec) {
  let aerr = null;
  const enc = new AudioEncoder({output: (c, meta) => muxer.addAudioChunk(c, meta), error: e => { aerr = e; }});
  enc.configure(audio.conf);
  const {ab, ch} = audio, sr = ab.sampleRate, len = Math.min(ab.length, Math.round(maxSec * sr)), N = 4096;
  const chans = Array.from({length: ch}, (_, i) => ab.getChannelData(i));
  for (let s = 0; s < len; s += N) {
    const n = Math.min(N, len - s), data = new Float32Array(n * ch);
    for (let c = 0; c < ch; c++) data.set(chans[c].subarray(s, s + n), c * n);
    const ad = new AudioData({format: 'f32-planar', sampleRate: sr, numberOfFrames: n, numberOfChannels: ch, timestamp: Math.round((s / sr) * 1e6), data});
    enc.encode(ad);
    ad.close();
    if (aerr) throw aerr;
    if (enc.encodeQueueSize > 16) await new Promise(r => setTimeout(r, 1));
  }
  await enc.flush();
  enc.close();
  if (aerr) throw aerr;
}

/**
 * Render a video file through a tool, frame by frame, to MP4.
 *
 * @param {object} o
 * @param {HTMLVideoElement} o.video     the source, already loaded
 * @param {File} [o.file]                the source file, for audio passthrough
 * @param {number} o.fps
 * @param {() => Promise<HTMLCanvasElement>} o.renderFrame  called after each seek; returns the tool's output canvas
 * @param {string} [o.background]        fill behind the output (for transparent output)
 * @param {number} [o.maxSide]           longest side of the encoded video
 * @param {boolean} [o.audio]            pass the source's audio through
 * @param {(p: {frame, total, phase}) => void} [o.onProgress]
 * @param {() => boolean} [o.isCancelled]
 * @returns {Promise<{blob: Blob | null, cancelled: boolean, audioNote: string}>}
 */
export async function renderVideoToMp4(o) {
  const {video, file, fps, renderFrame, background = '#000', maxSide = 1920, audio: wantAudio = true, onProgress = () => {}, isCancelled = () => false} = o;
  if (!canEncodeVideo()) throw new Error('This browser cannot encode video. Use Chrome or Edge.');
  const dur = video.duration;
  if (!isFinite(dur) || dur <= 0) throw new Error('This video does not report its length');

  await seekVideo(video, 0);
  const first = await renderFrame();
  const k = Math.min(1, maxSide / Math.max(first.width, first.height));
  const EW = Math.max(2, Math.floor((first.width * k) / 2) * 2), EH = Math.max(2, Math.floor((first.height * k) / 2) * 2);
  const bitrate = Math.min(40e6, Math.round(EW * EH * fps * 0.3));
  let cfg = null, mcodec = null;
  for (const [m, c] of [['avc', 'avc1.640033'], ['avc', 'avc1.4d0033'], ['vp9', 'vp09.00.41.08']]) {
    const conf = {codec: c, width: EW, height: EH, bitrate, framerate: fps};
    try {
      if ((await VideoEncoder.isConfigSupported(conf)).supported) { cfg = conf; mcodec = m; break; }
    } catch (e) {}
  }
  if (!cfg) throw new Error('No supported video codec for ' + EW + '×' + EH);

  let audio = null, audioNote = wantAudio ? '' : ' (audio off)';
  if (wantAudio && file) {
    if (!('AudioEncoder' in window)) audioNote = ' (no audio: this browser cannot encode it)';
    else {
      onProgress({frame: 0, total: 0, phase: 'Decoding audio…'});
      audio = await prepareAudio(file).catch(() => null);
      if (!audio) audioNote = ' (no audio track found)';
      else if (!audio.conf) { audioNote = ' (no audio: no supported audio encoder)'; audio = null; }
    }
  }

  const target = new ArrayBufferTarget();
  const muxer = new Muxer(Object.assign(
    {target, video: {codec: mcodec, width: EW, height: EH, frameRate: fps}, fastStart: 'in-memory'},
    audio ? {audio: {codec: audio.m, numberOfChannels: audio.ch, sampleRate: audio.ab.sampleRate}} : {},
  ));
  let err = null;
  const encoder = new VideoEncoder({output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: e => { err = e; }});
  encoder.configure(cfg);
  const ec = makeCanvas(EW, EH), ecx = ec.getContext('2d');
  const total = Math.max(1, Math.floor(dur * fps));
  try {
    for (let i = 0; i < total; i++) {
      if (isCancelled() || err) break;
      await seekVideo(video, Math.min(dur - 0.001, i / fps + 0.0005));
      const out = await renderFrame();
      ecx.fillStyle = background;
      ecx.fillRect(0, 0, EW, EH);
      ecx.drawImage(out, 0, 0, EW, EH);
      const fr = new VideoFrame(ec, {timestamp: Math.round((i * 1e6) / fps), duration: Math.round(1e6 / fps)});
      encoder.encode(fr, {keyFrame: i % (fps * 2) === 0});
      fr.close();
      while (encoder.encodeQueueSize > 4) await new Promise(r => setTimeout(r, 4));
      onProgress({frame: i + 1, total, phase: `Rendering frame ${i + 1} of ${total}`});
    }
    if (err) throw err;
    if (isCancelled()) return {blob: null, cancelled: true, audioNote};
    await encoder.flush();
    if (audio) {
      onProgress({frame: total, total, phase: 'Encoding audio…'});
      await encodeAudio(audio, muxer, total / fps);
    }
    muxer.finalize();
    return {blob: new Blob([target.buffer], {type: 'video/mp4'}), cancelled: false, audioNote};
  } finally {
    try { if (encoder.state !== 'closed') encoder.close(); } catch (e) {}
  }
}

/**
 * Record a canvas live (realtime, no audio). MP4 where the browser supports it, else WebM.
 * @returns {{stop: () => Promise<{blob: Blob, ext: string}>, discard: () => void}}
 */
export function recordCanvas(canvas, fps = 30, bitrate = 16e6) {
  if (!window.MediaRecorder || !canvas.captureStream) throw new Error('This browser cannot record the canvas');
  const type = ['video/mp4;codecs=avc1', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find(t => MediaRecorder.isTypeSupported(t));
  if (!type) throw new Error('No supported recording format');
  const stream = canvas.captureStream(fps), rec = new MediaRecorder(stream, {mimeType: type, videoBitsPerSecond: bitrate});
  const chunks = [];
  rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
  rec.start(1000);
  const finish = () => new Promise(resolve => {
    rec.onstop = () => {
      stream.getTracks().forEach(t => t.stop());
      resolve({blob: new Blob(chunks, {type: type.split(';')[0]}), ext: type.startsWith('video/mp4') ? 'mp4' : 'webm'});
    };
    rec.stop();
  });
  return {stop: finish, discard: () => { finish(); }};
}
