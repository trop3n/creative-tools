// Runs the dither pipeline off the main thread. The source image is sent once
// (as luminance) and kept here; after that each job only carries settings.
import {luminance, ditherGray} from '@studio/core/dither';

let source = null; // {gray, w, h, id}

self.onmessage = ({data}) => {
  if (data.type === 'source') {
    source = {gray: luminance(data.rgba, data.w, data.h), w: data.w, h: data.h, id: data.id};
    return;
  }
  if (data.type === 'job') {
    if (!source || source.id !== data.sourceId) return self.postMessage({type: 'skip', job: data.job});
    const t0 = performance.now();
    try {
      const {mask, w, h} = ditherGray(source.gray, source.w, source.h, data.settings);
      self.postMessage({type: 'done', job: data.job, mask, w, h, ms: performance.now() - t0}, [mask.buffer]);
    } catch (e) {
      self.postMessage({type: 'error', job: data.job, message: e.message});
    }
  }
};
