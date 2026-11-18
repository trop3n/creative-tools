// Runs the dither pipeline off the main thread. A job may carry new source pixels
// (every video frame does); otherwise it re-dithers the last source it was sent,
// which is what a settings change on a still image needs.
import {luminance, ditherGray, ditherColor} from '@studio/core/dither';

let source = null; // {rgba, w, h, gray?}

self.onmessage = ({data}) => {
  if (data.rgba) source = {rgba: data.rgba, w: data.w, h: data.h, gray: null};
  if (!source) return self.postMessage({type: 'error', job: data.job, message: 'No image loaded yet'});
  const t0 = performance.now();
  try {
    const {w, h} = source;
    if (data.settings.mode === 'palette') {
      const {indices, colors, w: cw, h: ch} = ditherColor(source.rgba, w, h, data.settings);
      self.postMessage({type: 'done', job: data.job, indices, colors, w: cw, h: ch, ms: performance.now() - t0}, [indices.buffer]);
    } else {
      source.gray ||= luminance(source.rgba, w, h);
      const {mask, w: cw, h: ch} = ditherGray(source.gray, w, h, data.settings);
      self.postMessage({type: 'done', job: data.job, mask, w: cw, h: ch, ms: performance.now() - t0}, [mask.buffer]);
    }
  } catch (e) {
    self.postMessage({type: 'error', job: data.job, message: e.message});
  }
};
