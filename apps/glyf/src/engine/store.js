// One mutable app state plus a version counter. Engine code mutates S and calls
// emit(); React reads it through useStore().
import {useSyncExternalStore} from 'react';
import {readJSON, writeJSON, saveFile as coreSave} from '@studio/core';
import {seedLib, uid, clone, parseSVG, moveEl, xfEl, xfLocal, glyphSVG, slug} from './shapes.js';
import {CUSTOM} from '@studio/core/frames';

/** Read (one argument) or write (two arguments) a JSON value in localStorage. */
export function store(key, val) {
  if (val === undefined) return readJSON(key);
  writeJSON(key, val);
}

export const GEN_DEFAULT = {
  cols: 56, bright: 0, contrast: 1.15, gamma: 1, invert: false, mode: 'density', dither: 'fs',
  steps: 'measured', blank: true, rot: 'none', gap: 0.06, seed: 7, color: 'mono', ink: '#00304e',
  paper: '#dfdfdf', transparent: false, sample: 'sphere', fps: '30', audio: true, frame: 'source', customW: CUSTOM.w, customH: CUSTOM.h,
};

let lib = store('glyf.lib.v1');
if (!lib || !Array.isArray(lib.shapes) || !lib.shapes.length) lib = seedLib();

export const S = {
  view: location.hash === '#shapes' ? 'shapes' : 'gen',
  lib,
  ed: {id: (lib.shapes[15] || lib.shapes[0]).id, tool: 'select', cut: false, sel: -1, snap: 12.5, poly: null, hist: []},
  gen: Object.assign({}, GEN_DEFAULT, store('glyf.gen.v1') || {}),
  cov: {},          // glyph id -> ink coverage 0..1
  ramp: [],         // glyphs in the active ramp, light to dark
  stats: '',
  media: {
    kind: 'sample', label: 'Spheres (sample)', playing: false, time: 0, duration: 0,
    sound: false, volume: 0.8, exporting: false, progress: '', recording: false, recTime: 0,
    cams: [], camId: '', mirror: true,
  },
};

let version = 0;
const subs = new Set();
export function emit() { version++; subs.forEach(f => f()); }
export function useStore() {
  useSyncExternalStore(f => (subs.add(f), () => subs.delete(f)), () => version);
  return S;
}

/* ---------- toast bridge (set by a component inside the Astryx layer provider) ---------- */
let toastFn = null;
export const setToast = fn => { toastFn = fn; };
export const toast = (msg, type = 'info') => { if (toastFn) toastFn({body: msg, type, isAutoHide: true, autoHideDuration: 3200}); };

/* ---------- saving files ---------- */
export async function saveFile(filename, data, mime) {
  const r = await coreSave(filename, data, mime);
  toast(r.status === 'error' ? r.message + '. Try Copy SVG instead.' : r.message, r.status === 'error' ? 'error' : 'info');
  return r;
}

/* ---------- library ---------- */
let saveT;
export function saveLib() { clearTimeout(saveT); saveT = setTimeout(() => store('glyf.lib.v1', S.lib), 250); }
export const saveGen = () => store('glyf.gen.v1', S.gen);
export const byId = id => S.lib.shapes.find(s => s.id === id);
export const cur = () => byId(S.ed.id);
export const selEl = () => { const s = cur(); return s && s.els[S.ed.sel]; };

let onLibChange = () => {};
export const setLibListener = fn => { onLibChange = fn; };
/** Call after any change to glyph content or the set. */
export function changed() { saveLib(); onLibChange(); emit(); }

export function pushHist() {
  const s = cur(); if (!s) return;
  S.ed.hist.push({id: s.id, els: clone(s.els)});
  if (S.ed.hist.length > 150) S.ed.hist.shift();
}
export function undo() {
  const h = S.ed.hist.pop();
  if (!h) return toast('Nothing to undo');
  const s = byId(h.id); if (!s) return undo();
  s.els = h.els; S.ed.id = s.id; S.ed.sel = -1; changed();
}
export function selectGlyph(id) { S.ed.id = id; S.ed.sel = -1; S.ed.poly = null; emit(); }
export function setTool(t) { if (S.ed.poly && t !== 'poly') S.ed.poly = null; S.ed.tool = t; emit(); }

export const A = {
  newG() {
    const s = {id: uid(), name: 'Glyph ' + (S.lib.shapes.length + 1), els: [], inSet: true};
    S.lib.shapes.push(s); S.ed.id = s.id; S.ed.sel = -1;
    if (S.ed.tool === 'select') S.ed.tool = 'rect';
    changed();
  },
  dupG() {
    const s = cur(); if (!s) return;
    const c = {id: uid(), name: s.name + ' copy', els: clone(s.els), inSet: s.inSet};
    S.lib.shapes.splice(S.lib.shapes.indexOf(s) + 1, 0, c); S.ed.id = c.id; S.ed.sel = -1; changed();
  },
  delG() {
    const s = cur(); if (!s) return;
    const i = S.lib.shapes.indexOf(s); S.lib.shapes.splice(i, 1);
    if (!S.lib.shapes.length) S.lib.shapes.push({id: uid(), name: 'Glyph 1', els: [], inSet: true});
    S.ed.id = S.lib.shapes[Math.max(0, i - 1)].id; S.ed.sel = -1; toast('Deleted ' + s.name); changed();
  },
  rename(name) { const s = cur(); if (s) { s.name = name || 'Untitled'; changed(); } },
  setInSet(id, v) { const s = byId(id); if (s) { s.inSet = v; changed(); } },
  allInSet(v) { S.lib.shapes.forEach(s => (s.inSet = v)); changed(); },
  clear() { const s = cur(); if (!s || !s.els.length) return; pushHist(); s.els = []; S.ed.sel = -1; changed(); toast('Cleared. Undo brings it back.'); },
  glyphXf(k) { const s = cur(); if (!s || !s.els.length) return; pushHist(); s.els.forEach(e => xfEl(e, k)); changed(); },
  elXf(k) { const s = cur(), e = selEl(); if (!e) return; pushHist(); s.els[S.ed.sel] = xfLocal(e, k); changed(); },
  toggleCut() { const e = selEl(); if (!e) return; pushHist(); e.cut = !e.cut; changed(); },
  dupEl() {
    const s = cur(), e = selEl(); if (!e) return; pushHist();
    const off = S.ed.snap || 5; s.els.push(moveEl(e, off, off)); S.ed.sel = s.els.length - 1; changed();
  },
  delEl() { const s = cur(); if (!selEl()) return; pushHist(); s.els.splice(S.ed.sel, 1); S.ed.sel = -1; changed(); },
  reorder(dir) {
    const s = cur(); if (!selEl()) return;
    const j = S.ed.sel + dir; if (j < 0 || j >= s.els.length) return;
    pushHist(); [s.els[S.ed.sel], s.els[j]] = [s.els[j], s.els[S.ed.sel]]; S.ed.sel = j; changed();
  },
  nudge(dx, dy) { const s = cur(); if (!selEl()) return; pushHist(); s.els[S.ed.sel] = moveEl(s.els[S.ed.sel], dx, dy); changed(); },
  setRx(v, first) { const e = selEl(); if (!e || e.t !== 'rect') return; if (first) pushHist(); e.rx = v; changed(); },
  exportGlyph() { const s = cur(); if (s) saveFile(slug(s.name) + '.svg', glyphSVG(s, 512, '#000'), 'image/svg+xml'); },
  exportLib() { saveFile('glyf-library.json', JSON.stringify(S.lib, null, 1), 'application/json'); },
  async importLib(file) {
    try {
      const data = JSON.parse(await file.text());
      const add = (data.shapes || []).filter(s => Array.isArray(s.els));
      if (!add.length) throw 0;
      add.forEach(s => S.lib.shapes.push({id: uid(), name: String(s.name || 'Glyph'), els: s.els, inSet: !!s.inSet}));
      changed(); toast(`Added ${add.length} glyphs from ${file.name}`);
    } catch (e) { toast('That file is not a GLYF library export', 'error'); }
  },
  importSvgText(text, name) {
    try {
      const s = {id: uid(), name: name || 'Imported', els: [parseSVG(text)], inSet: true};
      S.lib.shapes.push(s); S.ed.id = s.id; S.ed.sel = -1; return s;
    } catch (err) { toast(`${name || 'That file'} is not a readable SVG`, 'error'); return null; }
  },
  async importSvgFiles(files) {
    let n = 0;
    for (const f of files)
      if (/svg/i.test(f.type) || /\.svg$/i.test(f.name)) { if (A.importSvgText(await f.text(), f.name.replace(/\.svg$/i, ''))) n++; }
    if (n) { changed(); toast(`Imported ${n} glyph${n > 1 ? 's' : ''}`); }
  },
};
