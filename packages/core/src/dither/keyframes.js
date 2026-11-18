// Keyframes: snapshots of the numeric settings at points in a video's time, eased
// between during playback and rendering. A keyframe is
//   {t, style, values: {block, threshold, …}, params: {…the style's sliders}}
// Style switches happen at a keyframe (no blending between styles); a style's
// slider params blend only between two keyframes of the same style.
import {STYLE_BY_ID, defaultParams} from './styles.js';

/** Settings that can animate: everything that is a plain number on a slider. */
export const ANIMATABLE = ['block', 'threshold', 'strength', 'black', 'brightness', 'contrast', 'midtones', 'highlights', 'shadows', 'blur'];
// Whole-number settings (pixel size and blur radius change in whole steps).
const WHOLE = new Set(['block', 'blur']);

/** Snapshot the current settings as a keyframe at time t (seconds). */
export function makeKey(t, settings, params) {
  const values = {};
  for (const k of ANIMATABLE) if (typeof settings[k] === 'number') values[k] = settings[k];
  return {t, style: settings.style, values, params: {...params}};
}

/** Add a keyframe, replacing any within `tolerance` seconds of it. Returns a new sorted array. */
export function putKey(keys, key, tolerance = 1 / 60) {
  return [...keys.filter(k => Math.abs(k.t - key.t) > tolerance), key].sort((a, b) => a.t - b.t);
}

/** The keyframe within `tolerance` of t, if any. */
export const keyAt = (keys, t, tolerance = 1 / 60) => keys.find(k => Math.abs(k.t - t) <= tolerance) || null;

const smooth = f => f * f * (3 - 2 * f);

/** Round to a slider's step, counted from its minimum. */
const toStep = (v, spec) => {
  const step = spec.step || 1, min = spec.min ?? 0;
  return +(min + Math.round((v - min) / step) * step).toFixed(6);
};

/**
 * The settings at time t: {style, values, params}, or null with no keyframes.
 * Before the first keyframe and after the last, their values hold.
 */
export function valuesAt(keys, t, {ease = true} = {}) {
  if (!keys.length) return null;
  if (t <= keys[0].t) return snapshot(keys[0]);
  const last = keys[keys.length - 1];
  if (t >= last.t) return snapshot(last);
  let i = 0;
  while (keys[i + 1].t <= t) i++;
  const a = keys[i], b = keys[i + 1];
  let f = (t - a.t) / (b.t - a.t);
  if (ease) f = smooth(f);
  const values = {};
  for (const k of ANIMATABLE) {
    const va = a.values[k], vb = b.values[k];
    if (typeof va !== 'number') continue;
    const v = typeof vb === 'number' ? va + (vb - va) * f : va;
    values[k] = WHOLE.has(k) ? Math.round(v) : +v.toFixed(3);
  }
  const style = STYLE_BY_ID[a.style];
  const params = {...(style ? defaultParams(style) : {}), ...a.params};
  if (style && a.style === b.style) {
    // Blend slider params; switches and choices (e.g. Bayer size) step at the next key.
    for (const spec of style.params) {
      if (spec.type || typeof a.params[spec.key] !== 'number' || typeof b.params[spec.key] !== 'number') continue;
      params[spec.key] = toStep(a.params[spec.key] + (b.params[spec.key] - a.params[spec.key]) * f, spec);
    }
  }
  return {style: a.style, values, params};
}

const snapshot = k => ({style: k.style, values: {...k.values}, params: {...k.params}});
