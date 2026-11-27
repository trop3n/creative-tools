// DURANDAL's app state: one mutable object plus a version counter. Engine code
// mutates S and calls emit(); React reads it through useStore().
import {useSyncExternalStore} from 'react';
import {toolStore} from '@studio/core';
import {DEFAULT_SETTINGS, STYLE_BY_ID, defaultParams} from '@studio/core/dither';
import {CUSTOM} from '@studio/core/frames';

export const saved = toolStore('durandal');

export const LOOK_DEFAULT = {ink: '#00304e', paper: '#dfdfdf', exportScale: 'full', frame: 'source', customW: CUSTOM.w, customH: CUSTOM.h, cellShape: 'square', gap: 0, gapTone: 'dark', sample: 'spheres', fps: '30', audio: true, mirror: true, gpu: true,
  custom: ['#242222', '#00304e', '#c99530', '#dfdfdf'], // custom palette
  imageColors: [], imageCount: 6, // palette picked from the source
  animSeconds: 4, // an animated still's length
  effects: []}; // the effect stack, top to bottom (see @studio/core/dither effects.js)
export const TONE_KEYS = ['brightness', 'contrast', 'midtones', 'highlights', 'shadows', 'blur', 'saturation', 'sharpen', 'noise'];

const storedSettings = saved.get('settings.v1', {}) || {};
const settings = {...DEFAULT_SETTINGS, palette: 'brand', ...storedSettings};
delete settings.colors; // resolved from `palette` for each job
if (!STYLE_BY_ID[settings.style]) settings.style = DEFAULT_SETTINGS.style;

export const S = {
  settings, // pipeline settings (style, block, threshold, tone …)
  paramsByStyle: saved.get('params.v1', {}) || {}, // remembered per style
  look: {...LOOK_DEFAULT, ...(saved.get('look.v1', {}) || {})},
  // What's feeding the stage. kind: 'sample' | 'image' | 'video' | 'camera'
  media: {
    kind: 'sample', label: '', w: 0, h: 0,
    playing: false, time: 0, duration: 0, sound: false, volume: 0.8, // video
    keys: [], ease: true, // keyframes over a video or an animated still (see keyframes.js)
    anim: false, // a still with a timeline of its own (time, duration and playing above)
    exporting: false, progress: '', batch: false, // MP4 render or a batch
    cams: [], camId: '', recording: false, recTime: 0, // webcam
  },
  result: null, // {mask | indices + colors, w, h, ms, gpu?}
  busy: false,
};

/** The full parameter set for the current style, defaults filled in. */
export const currentParams = () => {
  const style = STYLE_BY_ID[S.settings.style];
  return {...defaultParams(style), ...(S.paramsByStyle[style.id] || {})};
};

let version = 0;
const subs = new Set();
export function emit() { version++; subs.forEach(f => f()); }
export function useStore() {
  useSyncExternalStore(f => { subs.add(f); return () => subs.delete(f); }, () => version);
  return S;
}

let saveTimer = 0;
export function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saved.set('settings.v1', S.settings);
    saved.set('params.v1', S.paramsByStyle);
    saved.set('look.v1', S.look);
  }, 250);
}

/* ---------- toasts ---------- */
let showToast = null;
export const setToast = fn => { showToast = fn; };
export const toast = (message, type = 'info') => (showToast ? showToast({body: message, type, isAutoHide: true, autoHideDuration: 3200}) : console.log(message));
