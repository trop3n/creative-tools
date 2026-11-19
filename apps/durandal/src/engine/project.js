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
import {STYLE_BY_ID, defaultParams} from '@studio/core/dither';
import {S, emit, persist, toast, saved, LOOK_DEFAULT} from './state.js';
import {schedule, reapplyKeys, fileBase} from './render.js';

const APP = 'durandal', VERSION = 1;
// Look keys a saved look carries (the rest are about the source or export).
const LOOK_KEYS = ['ink', 'paper', 'custom', 'imageCount', 'cellShape', 'gap', 'gapTone'];

/* ---------- checking what comes in ---------- */
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const isHex = v => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);

/** Only keys we know, with the same type as now: a hand-edited file can't break the app. */
function cleanSettings(raw) {
  const out = {};
  if (!isObj(raw)) return out;
  for (const [k, v] of Object.entries(raw)) {
    if (!(k in S.settings) || k === 'colors') continue;
    if (typeof v !== typeof S.settings[k]) continue;
    if (typeof v === 'number' && !isFinite(v)) continue;
    out[k] = v;
  }
  if (out.style && !STYLE_BY_ID[out.style]) delete out.style;
  if (out.mode && !['mono', 'palette', 'cmyk'].includes(out.mode)) delete out.mode;
  return out;
}

function cleanParams(styleId, raw) {
  const style = STYLE_BY_ID[styleId];
  if (!style || !isObj(raw)) return {};
  const ok = defaultParams(style), out = {};
  for (const [k, v] of Object.entries(raw)) if (k in ok && typeof v === typeof ok[k] && (typeof v !== 'number' || isFinite(v))) out[k] = v;
  return out;
}

function cleanLook(raw, keys = Object.keys(LOOK_DEFAULT)) {
  const out = {};
  if (!isObj(raw)) return out;
  for (const k of keys) {
    const v = raw[k], d = LOOK_DEFAULT[k];
    if (v === undefined) continue;
    if (Array.isArray(d)) { if (Array.isArray(v) && v.every(isHex)) out[k] = v.slice(0, 16); continue; }
    if (typeof v !== typeof d) continue;
    if ((k === 'ink' || k === 'paper') && !isHex(v)) continue;
    out[k] = v;
  }
  return out;
}

function cleanKeys(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(k => isObj(k) && typeof k.t === 'number' && isFinite(k.t) && k.t >= 0 && STYLE_BY_ID[k.style])
    .map(k => ({t: k.t, style: k.style, values: cleanSettings(k.values), params: cleanParams(k.style, k.params)}))
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
  };
}

export async function saveProject() {
  const blob = new Blob([JSON.stringify(projectData(), null, 2)], {type: 'application/json'});
  const res = await saveFile(fileBase() + '.durandal.json', blob, 'application/json');
  toast(res.message, res.status === 'error' ? 'error' : 'info');
}

export const isProjectFile = f => !!f && (/\.json$/i.test(f.name) || f.type === 'application/json');

/** Open a .durandal.json project and apply it. */
export async function openProject(file) {
  let p;
  try { p = JSON.parse(await file.text()); }
  catch (e) { return toast('That file is not a DURANDAL project', 'error'); }
  if (!isObj(p) || p.app !== APP) return toast('That file is not a DURANDAL project', 'error');

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
  persist(); reapplyKeys(); schedule(); emit();
  toast('Opened ' + file.name + '.' + note);
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
