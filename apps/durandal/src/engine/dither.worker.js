// Runs the dither pipeline off the main thread. A job may carry new source pixels
// (every video frame does); otherwise it re-dithers the last source it was sent,
// which is what a settings change on a still image needs.
import {luminance, ditherGray, ditherColor, ditherCMYK, needsPrep, prepareRGBA} from '@studio/core/dither';

let source = null; // {rgba, w, h, gray?}

self.onmessage = ({data}) => {
  if (data.rgba) source = {rgba: data.rgba, w: data.w, h: data.h, gray: null};
  if (!source) return self.postMessage({type: 'error', job: data.job, message: 'No image loaded yet'});
  const t0 = performance.now();
  try {
    const {w, h} = source, prep = needsPrep(data.settings);
    // Saturation, sharpen and noise change the source, so the cached gray only serves without them.
    const rgba = prep ? prepareRGBA(source.rgba, w, h, data.settings) : source.rgba;
    if (data.settings.mode === 'palette' || data.settings.mode === 'cmyk') {
      const run = data.settings.mode === 'cmyk' ? ditherCMYK : ditherColor;
      const {indices, colors, w: cw, h: ch} = run(rgba, w, h, data.settings);
      self.postMessage({type: 'done', job: data.job, indices, colors, w: cw, h: ch, ms: performance.now() - t0}, [indices.buffer]);
    } else {
      const gray = prep ? luminance(rgba, w, h) : (source.gray ||= luminance(source.rgba, w, h));
      const {mask, w: cw, h: ch} = ditherGray(gray, w, h, data.settings);
      self.postMessage({type: 'done', job: data.job, mask, w: cw, h: ch, ms: performance.now() - t0}, [mask.buffer]);
    }
  } catch (e) {
    self.postMessage({type: 'error', job: data.job, message: e.message});
  }
};
