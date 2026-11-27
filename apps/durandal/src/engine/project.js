// Project files and saved looks.
//
// A project (.durandal.json) holds everything you set: pipeline settings, every
// style's sliders, colors and cell shape, and a video's keyframes (tied to the
// video by file name). Opening one restores it; keyframes wait for their video if
// a different source is showing.
//
// A saved look is a named preset kept in this browser: style, settings, the
// style's sliders and the color and cell-shape choices, without the source.
import {saveFile} from '@studio/core';
import {STYLE_BY_ID, defaultParams, cleanEffects} from '@studio/core/dither';
import {FRAME_RATIOS, cleanSide, isFrame} from '@studio/core/frames';
import {S, emit, persist, toast, saved, LOOK_DEFAULT} from './state.js';
import {schedule, reframe, reapplyKeys, keysApplied, clockTime, isAnimating, fileBase} from './render.js';

const APP = 'durandal', VERSION = 1;
// Look keys a saved look carries (the rest are about the source or export).
const LOOK_KEYS = ['ink', 'paper', 'custom', 'imageCount', 'cellShape', 'gap', 'gapTone', 'effects'];

/* ---------- checking what comes in ---------- */
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const isHex = v => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);

// The sliders' ranges: values outside them (a hand-edited file) can hang the worker's blur
// or make the GPU loop for ever, so they're clamped on the way in.
const SETTING_RANGE = {
  block: [1, 32], threshold: [0, 100], blur: [0, 20], strength: [0, 100], black: [0, 100],
  brightness: [-100, 100], contrast: [-100, 100], midtones: [-100, 100], highlights: [-100, 100], shadows: [-100, 100],
};
const clamp = (v, [lo, hi]) => Math.min(hi, Math.max(lo, v));

/** Only keys we know, with the same type as now, in range: a hand-edited file can't break the app. */
function cleanSettings(raw) {
  const out = {};
  if (!isObj(raw)) return out;
  for (const [k, v] of Object.entries(raw)) {
    if (!(k in S.settings) || k === 'colors') continue;
    if (typeof v !== typeof S.settings[k]) continue;
    if (typeof v === 'number' && !isFinite(v)) continue;
    out[k] = typeof v === 'number' && SETTING_RANGE[k] ? clamp(v, SETTING_RANGE[k]) : v;
  }
  if (out.style && !STYLE_BY_ID[out.style]) delete out.style;
  if (out.mode && !['mono', 'palette', 'cmyk'].includes(out.mode)) delete out.mode;
  return out;
}

function cleanParams(styleId, raw) {
  const style = STYLE_BY_ID[styleId];
  if (!style || !isObj(raw)) return {};
  const ok = defaultParams(style), out = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!(k in ok) || typeof v !== typeof ok[k] || (typeof v === 'number' && !isFinite(v))) continue;
    // Each slider's own range; a select only takes one of its options.
    const def = (style.params || []).find(p => p.key === k);
    if (def?.options) { if (def.options.includes(v)) out[k] = v; continue; }
    out[k] = typeof v === 'number' && def && def.min !== undefined ? clamp(v, [def.min, def.max]) : v;
  }
  return out;
}

function cleanLook(raw, keys = Object.keys(LOOK_DEFAULT)) {
  const out = {};
  if (!isObj(raw)) return out;
  for (const k of keys) {
    const v = raw[k], d = LOOK_DEFAULT[k];
    if (v === undefined) continue;
    if (k === 'effects') { out[k] = cleanEffects(v); continue; }
    if (Array.isArray(d)) { if (Array.isArray(v) && v.every(isHex)) out[k] = v.slice(0, 16); continue; }
    if (typeof v !== typeof d) continue;
    if ((k === 'ink' || k === 'paper') && !isHex(v)) continue;
    if (k === 'gap') { out[k] = clamp(v, [0, 80]); continue; }
    if (k === 'frame' && v !== 'source' && !isFrame(v, FRAME_RATIOS)) continue;
    if (k === 'customW' || k === 'customH') { out[k] = cleanSide(v, d); continue; }
    if (k === 'imageCount') { out[k] = Math.round(clamp(v, [2, 16])); continue; }
    if (k === 'animSeconds') { out[k] = isFinite(v) ? clamp(v, [1, 30]) : d; continue; }
    out[k] = v;
  }
  return out;
}

function cleanKeys(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(k => isObj(k) && typeof k.t === 'number' && isFinite(k.t) && k.t >= 0 && STYLE_BY_ID[k.style])
    .map(k => {
      const key = {t: k.t, style: k.style, values: cleanSettings(k.values), params: cleanParams(k.style, k.params)};
      if (Array.isArray(k.effects)) key.effects = cleanEffects(k.effects);
      const name = typeof k.name === 'string' ? k.name.trim().slice(0, 40) : '';
      return name ? {...key, name} : key;
    })
    .sort((a, b) => a.t - b.t);
}

/* ---------- projects ---------- */
let pendingKeys = null; // {name, keys, ease}: keyframes waiting for their video

export function projectData() {
  return {
    app: APP,
    version: VERSION,
    settings: {...S.settings},
    params: S.paramsByStyle,
    look: cleanLook(S.look),
    video: S.media.kind === 'video' ? {name: S.media.label, keys: S.media.keys, ease: S.media.ease !== false} : pendingKeys,
    anim: isAnimating() ? {keys: S.media.keys, ease: S.media.ease !== false} : null, // an animated still (its length is look.animSeconds)
  };
}

export async function saveProject() {
  const blob = new Blob([JSON.stringify(projectData(), null, 2)], {type: 'application/json'});
  const name = fileBase() + '.durandal.json', data = projectData();
  const res = await saveFile(name, new Blob([JSON.stringify(data, null, 2)], {type: 'application/json'}), 'application/json');
  if (res.status === 'saved') remember(name, data);
  toast(res.message, res.status === 'error' ? 'error' : 'info');
}

export const isProjectFile = f => !!f && (/\.json$/i.test(f.name) || f.type === 'application/json');

/** Open a .durandal.json project and apply it. */
export async function openProject(file) {
  let p;
  try { p = JSON.parse(await file.text()); }
  catch (e) { return toast('That file is not a DURANDAL project', 'error'); }
  if (!isObj(p) || p.app !== APP) return toast('That file is not a DURANDAL project', 'error');
  remember(file.name, p);
  applyProject(p, file.name);
}

function applyProject(p, label) {
  Object.assign(S.settings, cleanSettings(p.settings));
  if (isObj(p.params)) for (const [id, raw] of Object.entries(p.params)) {
    const clean = cleanParams(id, raw);
    if (Object.keys(clean).length) S.paramsByStyle[id] = clean;
  }
  Object.assign(S.look, cleanLook(p.look));

  let note = '';
  if (isObj(p.video) && Array.isArray(p.video.keys) && p.video.keys.length) {
    const keys = cleanKeys(p.video.keys), ease = p.video.ease !== false, name = String(p.video.name || 'its video');
    if (S.media.kind === 'video') {
      Object.assign(S.media, {keys, ease});
      if (name !== S.media.label) note = ` Its keyframes were made for ${name}.`;
    } else {
      pendingKeys = {name, keys, ease};
      note = ` Open ${name} to use its ${keys.length} keyframes.`;
    }
  }
  if (isObj(p.anim) && Array.isArray(p.anim.keys)) {
    if (S.media.kind === 'sample' || S.media.kind === 'image') {
      Object.assign(S.media, {anim: true, keys: cleanKeys(p.anim.keys), ease: p.anim.ease !== false, time: 0, playing: false, duration: S.look.animSeconds});
    } else note += ' Its animation is for a still: open an image or a sample, then open the project again.';
  }
  const hasKeys = isObj(p.video) && Array.isArray(p.video.keys) && p.video.keys.length;
  if (!hasKeys && S.media.kind === 'video' && S.media.keys.length) {
    // The project has no keyframes, but this video does: show the project's settings now,
    // rather than letting the video's keyframes write over them on the next frame.
    keysApplied(clockTime());
    note += ` This video's ${S.media.keys.length} keyframes take over again when it plays or you scrub.`;
  } else reapplyKeys();
  persist(); reframe(); emit(); // reframe: the project may bring a different Frame; it re-dithers either way
  toast('Opened ' + label + '.' + note);
}

/* ---------- recent projects ---------- */
// A copy of each project saved or opened, newest first, kept in this browser. Browsers
// can't reopen a file by its path, so a recent project is this copy, not the file.
const RECENT_MAX = 5;
S.recents = (saved.get('recent.v1', []) || []).filter(r => isObj(r) && typeof r.name === 'string' && isObj(r.data) && r.data.app === APP);

function remember(name, data) {
  // A copy: projectData() shares objects with the live state.
  S.recents = [{name, at: Date.now(), data: structuredClone(data)}, ...S.recents.filter(r => r.name !== name)].slice(0, RECENT_MAX);
  saved.set('recent.v1', S.recents);
  emit();
}

export function openRecent(name) {
  const r = S.recents.find(x => x.name === name);
  if (r) { remember(r.name, r.data); applyProject(r.data, r.name); }
}

export function forgetRecent(name) {
  S.recents = S.recents.filter(r => r.name !== name);
  saved.set('recent.v1', S.recents);
  emit();
}

/** When a video opens: hand over keyframes from a project that was waiting for it. */
export function takePendingKeys(name) {
  if (!pendingKeys) return null;
  const p = pendingKeys;
  if (p.name !== name) return null;
  pendingKeys = null;
  return p;
}

/* ---------- saved looks ---------- */
S.looks = (saved.get('looks.v1', []) || []).filter(l => isObj(l) && typeof l.name === 'string' && STYLE_BY_ID[l.settings?.style]);
const storeLooks = () => saved.set('looks.v1', S.looks);

/** Save the current look under a name (replacing one with the same name). */
export function saveLook(name) {
  name = String(name || '').trim().slice(0, 60);
  if (!name) return toast('Give the look a name first');
  const style = S.settings.style;
  const look = {
    name,
    settings: {...S.settings},
    params: {...defaultParams(STYLE_BY_ID[style]), ...(S.paramsByStyle[style] || {})},
    look: cleanLook(S.look, LOOK_KEYS),
  };
  delete look.settings.colors;
  const i = S.looks.findIndex(l => l.name.toLowerCase() === name.toLowerCase());
  if (i >= 0) S.looks[i] = look; else S.looks.push(look);
  storeLooks(); emit();
  toast(i >= 0 ? `Updated "${name}"` : `Saved "${name}"`);
}

export function applyLook(name) {
  const l = S.looks.find(x => x.name === name);
  if (!l) return;
  Object.assign(S.settings, cleanSettings(l.settings));
  S.paramsByStyle[S.settings.style] = cleanParams(S.settings.style, l.params);
  Object.assign(S.look, cleanLook(l.look, LOOK_KEYS));
  persist(); schedule(); emit();
}

export function deleteLook(name) {
  S.looks = S.looks.filter(l => l.name !== name);
  storeLooks(); emit();
}
