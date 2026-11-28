// One mutable app state plus a version counter. Engine code mutates S and calls
// emit(); React reads it through useStore().
import {useSyncExternalStore} from 'react';
import {readJSON, writeJSON, saveFile as coreSave, publishGlyphs} from '@studio/core';
import {seedLib, tileShapes, TILE_NAMES, uid, clone, parseSVG, moveEl, xfEl, xfLocal, glyphSVG, shapeInner, slug, setMode, modeOf, rotateEl, scaleEl, fitBox} from './shapes.js';
import {CUSTOM, cleanSide} from '@studio/core/frames';
import {FAMILY, FAMILIES, buildFamily, defaults} from './families.js';

/** Read (one argument) or write (two arguments) a JSON value in localStorage. */
export function store(key, val) {
  if (val === undefined) return readJSON(key);
  writeJSON(key, val);
}

/** Flat palettes for the Palette color mode and the Ribbons source. */
export const PALETTES = [
  {id: 'signal', name: 'Signal', colors: ['#4a86e8', '#4fc98a', '#f0b83c', '#ec5b4f']},
  {id: 'standrew', name: 'St. Andrew', colors: ['#00304e', '#4c3046', '#c99530', '#90a344']},
  {id: 'spectrum', name: 'Spectrum', colors: ['#3b5fe0', '#2fb5d0', '#58c95a', '#f2cc3a', '#f08a2c', '#e5453a']},
  {id: 'mono', name: 'Grays', colors: ['#dfdfdf', '#a3a3a3', '#505050']},
];
export const MAX_PALETTE = 8;

export const GEN_DEFAULT = {
  cols: 56, bright: 0, contrast: 1.15, gamma: 1, invert: false, mode: 'density', dither: 'fs',
  steps: 'measured', blank: true, rot: 'none', gap: 0.06, seed: 7, color: 'mono', ink: '#00304e',
  paper: '#dfdfdf', transparent: false, sample: 'sphere', fps: '30', audio: true, frame: 'source', customW: CUSTOM.w, customH: CUSTOM.h,
  pick: 'tone', // tone: each cell's glyph by its tone; mixed: any glyph in the set, fixed per cell
  tone: 'classic', detail: 0.5, // classic: ink matched to the screen value; linear: to light (for fine grids seen from afar); detail 0..1: match glyph shapes at edges
  palette: PALETTES[0].colors.slice(), match: 'nearest', // Palette color mode: nearest color, or by tone
  patKind: 'noise', patScale: 4, patDetail: 0.5, patAngle: 0, patSeed: 1, // Pattern source
  ribCount: 5, ribWidth: 0.09, ribWander: 0.6, ribPatches: 3, ribLoop: 10, ribSeed: 1, ribLoops: 1, // Ribbons source
};

let lib = store('glyf.lib.v1');
if (!lib || !Array.isArray(lib.shapes) || !lib.shapes.length) lib = seedLib();
// Libraries from before the tiles get them once, at the end and out of the set.
else if (!lib.tiles) { lib.shapes.push(...tileShapes()); lib.tiles = true; store('glyf.lib.v1', lib); }

export const S = {
  view: location.hash === '#shapes' ? 'shapes' : 'gen',
  lib,
  ed: {id: (lib.shapes[15] || lib.shapes[0]).id, mode: 'draw', tool: 'select', cut: false, clip: false, lineW: 10, sel: -1, snap: 12.5, poly: null, hist: []},
  // The shape catalog: the chosen family, a tag filter, and each family's last settings.
  cat: Object.assign({family: FAMILIES[0].id, tag: '', params: {}}, store('glyf.cat.v1') || {}),
  gen: Object.assign({}, GEN_DEFAULT, store('glyf.gen.v1') || {}),
  recipeSet: null,  // a recipe's own glyphs, used instead of the library's set until the library changes
  cov: {},          // glyph id -> ink coverage 0..1
  ramp: [],         // glyphs in the active ramp, light to dark
  stats: '',
  media: {
    kind: 'sample', label: 'Spheres (sample)', playing: false, time: 0, duration: 0,
    sound: false, volume: 0.8, exporting: false, progress: '', recording: false, recTime: 0,
    cams: [], camId: '', mirror: true, live: false,
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
export function saveLib() { clearTimeout(saveT); saveT = setTimeout(() => { store('glyf.lib.v1', S.lib); publishSet(); }, 250); }
/** Share the glyphs in the set with the suite (PFHOR, DURANDAL and TYCHO can draw them). */
export function publishSet() {
  publishGlyphs(S.lib.shapes.filter(s => s.inSet && s.els.length).map(s => ({id: s.id, name: s.name, svg: shapeInner(s, 'sg-' + s.id)})));
}
publishSet();
export const saveGen = () => store('glyf.gen.v1', S.gen);
const saveCat = () => store('glyf.cat.v1', S.cat);
/** The catalog's current family and its settings (defaults filled in). */
export const catFamily = () => FAMILY[S.cat.family] || FAMILIES[0];
export const catParams = () => { const f = catFamily(); return {...defaults(f), ...(S.cat.params[f.id] || {})}; };
export const byId = id => S.lib.shapes.find(s => s.id === id) || (S.recipeSet && S.recipeSet.find(s => s.id === id));
/** The glyphs the generator uses: a recipe's own set while one is applied, else the library's set. */
export const genSet = () => S.recipeSet || S.lib.shapes.filter(s => s.inSet);

/* ---------- recipes ---------- */
const isHex = v => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
/** Generator settings from a recipe: only known keys, each of its default's type (the sample may be null: a file was the source). */
export function cleanGen(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, d] of Object.entries(GEN_DEFAULT)) {
    const v = raw[k];
    if (v === undefined) continue;
    if (k === 'sample') { if (v === null || typeof v === 'string') out[k] = v; }
    else if (Array.isArray(d)) { if (Array.isArray(v) && v.length && v.every(isHex)) out[k] = v.slice(0, MAX_PALETTE); }
    else if (k === 'customW' || k === 'customH') out[k] = cleanSide(v, d);
    else if (typeof v === typeof d && (typeof v !== 'number' || isFinite(v))) out[k] = v;
  }
  return out;
}
/**
 * Use a recipe's glyphs ([{name, els}]) as the generator's set for now, without touching
 * the library: the next change to the library brings its own set back. Glyphs the same
 * as the library's set (same order) leave the library in charge.
 */
export function useRecipeSet(glyphs) {
  const list = (Array.isArray(glyphs) ? glyphs : []).filter(g => g && Array.isArray(g.els));
  const mine = S.lib.shapes.filter(s => s.inSet).map(s => ({name: s.name, els: s.els}));
  const theirs = list.map(g => ({name: String(g.name || 'Glyph'), els: g.els}));
  S.recipeSet = JSON.stringify(theirs) === JSON.stringify(mine) ? null : theirs.map((g, i) => ({id: 'recipe-' + i, ...g, inSet: true}));
}
export const cur = () => byId(S.ed.id);
export const selEl = () => { const s = cur(); return s && s.els[S.ed.sel]; };

let onLibChange = () => {};
export const setLibListener = fn => { onLibChange = fn; };
/** Call after any change to glyph content or the set. */
export function changed() { S.recipeSet = null; saveLib(); onLibChange(); emit(); }

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
  /* ---------- catalog ---------- */
  catMode(m) { S.ed.mode = m === 'catalog' ? 'catalog' : 'draw'; if (S.ed.poly) S.ed.poly = null; emit(); },
  catPick(id) { if (FAMILY[id]) { S.cat.family = id; saveCat(); emit(); } },
  catTag(t) { S.cat.tag = t; saveCat(); emit(); },
  catSet(key, v) { const f = catFamily(); S.cat.params[f.id] = {...catParams(), [key]: v}; saveCat(); emit(); },
  catReset() { delete S.cat.params[catFamily().id]; saveCat(); emit(); },
  /** New settings at random within each slider's range (and any option). */
  catShuffle() {
    const f = catFamily(), q = {};
    for (const p of f.params) {
      if (p.options) q[p.key] = p.options[Math.floor(Math.random() * p.options.length)].v;
      else { const n = Math.round((p.max - p.min) / p.step); q[p.key] = +(p.min + Math.floor(Math.random() * (n + 1)) * p.step).toFixed(4); }
    }
    S.cat.params[f.id] = q; saveCat(); emit();
  },
  /** Add the catalog's shape to the library; inSet puts it in the generator set, edit opens it. */
  catAdd({inSet = false, edit = false} = {}) {
    const f = catFamily(), n = S.lib.shapes.filter(x => x.name.startsWith(f.name)).length + 1;
    const g = {id: uid(), name: n > 1 ? `${f.name} ${n}` : f.name, els: buildFamily(f.id, catParams()), inSet};
    S.lib.shapes.push(g);
    if (edit) { S.ed.id = g.id; S.ed.sel = -1; S.ed.mode = 'draw'; S.ed.tool = 'select'; }
    changed();
    toast(edit ? `Added ${g.name}. Editing it now.` : inSet ? `Added ${g.name} to the library and the set` : `Added ${g.name} to the library`);
  },
  /** The tile look: only the tiles in the set, mixed per cell, in flat palette colors on near-black. */
  tileLook() {
    if (!S.lib.shapes.some(s => TILE_NAMES.includes(s.name))) S.lib.shapes.push(...tileShapes());
    S.lib.shapes.forEach(s => (s.inSet = TILE_NAMES.includes(s.name)));
    Object.assign(S.gen, {mode: 'density', pick: 'mixed', dither: 'none', steps: 'measured', blank: true, invert: true, gamma: 3, contrast: 1, bright: 0, rot: 'none', gap: 0.14, cols: Math.min(S.gen.cols, 48), color: 'palette', match: 'nearest', paper: '#242222', tone: 'classic'});
    saveGen(); changed();
  },
  allInSet(v) { S.lib.shapes.forEach(s => (s.inSet = v)); changed(); },
  clear() { const s = cur(); if (!s || !s.els.length) return; pushHist(); s.els = []; S.ed.sel = -1; changed(); toast('Cleared. Undo brings it back.'); },
  glyphXf(k) { const s = cur(); if (!s || !s.els.length) return; pushHist(); s.els.forEach(e => xfEl(e, k)); changed(); },
  elXf(k) { const s = cur(), e = selEl(); if (!e) return; pushHist(); s.els[S.ed.sel] = xfLocal(e, k); changed(); },
  toggleCut() { const e = selEl(); if (!e) return; pushHist(); setMode(e, e.cut ? 'add' : 'cut'); changed(); },
  /** The selected part's paint mode: 'add', 'cut' or 'keep' (only what's inside it stays). */
  setPaint(m) { const e = selEl(); if (!e || modeOf(e) === m) return; pushHist(); setMode(e, m); changed(); },
  /** Replace the selected part with f(part), if f can (raw SVG can't turn or scale freely). */
  partOp(f, what) {
    const s = cur(), e = selEl(); if (!e) return;
    const ne = f(e);
    if (!ne) return toast(`An imported SVG part can't be ${what}`, 'error');
    pushHist(); s.els[S.ed.sel] = ne; changed();
  },
  rotPart(deg) { A.partOp(e => rotateEl(e, deg), 'turned by that angle'); },
  scalePart(k) { A.partOp(e => scaleEl(e, k), 'scaled'); },
  fitPart(b) { if (b.w > 0.1 && b.h > 0.1) A.partOp(e => fitBox(e, b), 'resized'); },
  /** n copies of the selected part around the board's centre (the original is the first). */
  repeatPart(n) {
    const s = cur(), e = selEl(); if (!e || n < 2) return;
    const copies = []; for (let i = 1; i < n; i++) { const c = rotateEl(e, (360 * i) / n, 50, 50); if (!c) return toast("An imported SVG part can't be repeated around the centre", 'error'); copies.push(c); }
    pushHist(); s.els.splice(S.ed.sel + 1, 0, ...copies); changed();
  },
  /** A mirrored copy of the selected part across the board's middle ('fh' left–right, 'fv' top–bottom). */
  mirrorPart(k) { const s = cur(), e = selEl(); if (!e) return; pushHist(); s.els.splice(S.ed.sel + 1, 0, xfEl(clone(e), k)); S.ed.sel++; changed(); },
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
