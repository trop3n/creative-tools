// Runs the dither pipeline off the main thread. A job may carry new source pixels
// (every video frame does); otherwise it re-dithers the last source it was sent,
// which is what a settings change on a still image needs.
import {luminance, ditherGray} from '@studio/core/dither';

let source = null; // {gray, w, h}

self.onmessage = ({data}) => {
  if (data.rgba) source = {gray: luminance(data.rgba, data.w, data.h), w: data.w, h: data.h};
  if (!source) return self.postMessage({type: 'error', job: data.job, message: 'No image loaded yet'});
  const t0 = performance.now();
  try {
    const {mask, w, h} = ditherGray(source.gray, source.w, source.h, data.settings);
    self.postMessage({type: 'done', job: data.job, mask, w, h, ms: performance.now() - t0}, [mask.buffer]);
  } catch (e) {
    self.postMessage({type: 'error', job: data.job, message: e.message});
  }
};
