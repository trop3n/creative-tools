// Connecting the suite's tools. Every tool is served from one origin, so they share
// the browser's storage:
//
//   - the shelf: the last few images and videos any tool saved or sent (IndexedDB),
//     which transformers offer under "Recent from the suite";
//   - sendTo(): put the current picture on the shelf and open another tool with it;
//   - suite palettes: color sets any tool can save and any tool can use (localStorage).
//
// Outside the built suite (a dev server, the single-file build) there are no
// neighbors to send to: currentTool() is null and the UI hides these parts.
import {readJSON, writeJSON} from './storage.js';

export const TOOL_NAMES = {glyf: 'GLYF', durandal: 'DURANDAL', leela: 'LEELA', bloom: 'BLOOM', tycho: 'TYCHO', thoth: 'THOTH', pfhor: 'PFHOR', jjaro: 'JJARO'};
/** Tools that take a picture in, and what kinds: image, video. */
export const RECEIVERS = {
  durandal: ['image', 'video'],
  glyf: ['image', 'video'],
  thoth: ['image', 'video'],
  pfhor: ['image', 'video'],
  jjaro: ['image'],
};

/** This tool's id when it runs inside the built suite (/<id>/), else null. */
export function currentTool() {
  if (typeof location === 'undefined') return null;
  const m = /\/([a-z]+)\/(?:index\.html)?$/.exec(location.pathname);
  return m && TOOL_NAMES[m[1]] ? m[1] : null;
}

/** Where this tool can send a picture of `kind` ('image' or 'video'): [{id, name}]. */
export function sendTargets(kind = 'image') {
  const me = currentTool();
  if (!me) return [];
  return Object.entries(RECEIVERS).filter(([id, kinds]) => id !== me && kinds.includes(kind)).map(([id]) => ({id, name: TOOL_NAMES[id]}));
}

/* ---------- the shelf ---------- */
const DB = 'studio.shelf', STORE = 'items', KEEP = 12, MAX_BYTES = 300 * 1024 * 1024;
const SHELF_TYPES = /^(image\/(png|jpeg|webp|gif)|video\/(mp4|webm))$/;
/** Files the shelf keeps: pictures and videos (not SVG or project files). */
export const isShelfType = type => SHELF_TYPES.test(type || '');

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, {keyPath: 'id'});
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function tx(mode, fn) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode), req = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(req && 'result' in req ? req.result : undefined);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error('The browser would not store the file'));
    });
  } finally {
    db.close();
  }
}

const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('studio.shelf') : null;
channel?.unref?.(); // Node (tests) would otherwise stay running for it
const local = new Set();
const changed = () => { channel?.postMessage('changed'); local.forEach(f => f()); };

/** Put a file on the shelf, newest first, keeping the last 12. Returns its id. */
export async function shelfPut(blob, name, from = currentTool()) {
  if (!blob || blob.size > MAX_BYTES) throw new Error('That file is too big to pass between tools');
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  await tx('readwrite', s => s.put({id, blob, name: String(name || 'file'), type: blob.type, from: from || '', at: Date.now(), size: blob.size}));
  const all = await tx('readonly', s => s.getAll());
  const old = all.sort((a, b) => b.at - a.at).slice(KEEP);
  if (old.length) await tx('readwrite', s => { old.forEach(o => s.delete(o.id)); return null; });
  changed();
  return id;
}

/** What's on the shelf, newest first: [{id, name, type, from, at, size}]. */
export async function shelfList() {
  try {
    const all = await tx('readonly', s => s.getAll());
    return all.sort((a, b) => b.at - a.at).map(({blob, ...meta}) => meta);
  } catch (e) {
    return [];
  }
}

/** A shelf item as a File (with .from), or null if it's gone. */
export async function shelfFile(id) {
  try {
    const item = await tx('readonly', s => s.get(String(id)));
    return item ? Object.assign(new File([item.blob], item.name, {type: item.type}), {from: item.from}) : null;
  } catch (e) {
    return null;
  }
}

export async function shelfRemove(id) { await tx('readwrite', s => s.delete(String(id))); changed(); }

/** Call fn(list) now and whenever the shelf changes, in this tab or another. Returns a stop function. */
export function watchShelf(fn) {
  let live = true;
  const update = () => shelfList().then(l => { if (live) fn(l); });
  const onMsg = () => update();
  channel?.addEventListener('message', onMsg);
  local.add(update);
  update();
  return () => { live = false; channel?.removeEventListener('message', onMsg); local.delete(update); };
}

/** "LEELA · 2 min ago" for a shelf item. */
export function shelfLabel(item, now = Date.now()) {
  const s = Math.max(0, Math.round((now - item.at) / 1000));
  const ago = s < 60 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`;
  return `${item.name} · ${TOOL_NAMES[item.from] || 'another tool'} · ${ago}`;
}

/* ---------- sending ---------- */
/**
 * Send a picture to another tool: make() resolves to {blob, name} (or null to cancel);
 * it goes on the shelf and the other tool opens in a new tab with it loaded. Call it
 * straight from a click, so the browser lets the new tab open.
 */
export async function sendTo(tool, make) {
  const tab = window.open('', '_blank');
  try {
    const out = await make();
    if (!out) { tab?.close(); return false; }
    const id = await shelfPut(out.blob, out.name);
    const url = new URL(`../${tool}/?shelf=${encodeURIComponent(id)}`, location.href).href;
    if (tab) tab.location.href = url; else location.href = url;
    return true;
  } catch (e) {
    tab?.close();
    throw e;
  }
}

/**
 * The file another tool sent this one (?shelf=id in the address), or null. The address
 * is cleaned so a reload doesn't load it again.
 */
export async function takeSent() {
  if (typeof location === 'undefined') return null;
  const params = new URLSearchParams(location.search);
  if (!params.has('shelf')) return null;
  history.replaceState(null, '', location.pathname + location.hash);
  return shelfFile(params.get('shelf'));
}

/* ---------- suite palettes ---------- */
const PAL_KEY = 'studio.shared.palettes.v1', MAX_PALETTES = 40, MAX_PAL_COLORS = 16;
/** Always there: the brand colors. */
export const BRAND_PALETTE = {id: 'brand', name: 'Brand', colors: ['#242222', '#00304e', '#4c3046', '#505050', '#90a344', '#c99530', '#dfdfdf', '#ffffff'], builtIn: true};

/** 2..16 colors as lowercase #rrggbb, repeats dropped; null if fewer than 2. */
export function cleanColors(colors) {
  const out = [];
  for (const c of Array.isArray(colors) ? colors : []) {
    const m = typeof c === 'string' && /^#?([0-9a-f]{6})$/i.exec(c.trim());
    if (m && !out.includes('#' + m[1].toLowerCase())) out.push('#' + m[1].toLowerCase());
  }
  return out.length >= 2 ? out.slice(0, MAX_PAL_COLORS) : null;
}

const stored = () => (readJSON(PAL_KEY, []) || []).filter(p => p && typeof p.name === 'string' && cleanColors(p.colors));

/** Every suite palette: Brand first, then saved ones, newest first. [{id, name, colors, from, at}] */
export function suitePalettes() {
  return [BRAND_PALETTE, ...stored().sort((a, b) => (b.at || 0) - (a.at || 0)).map(p => ({...p, colors: cleanColors(p.colors)}))];
}

const palListeners = new Set();
const palChanged = () => palListeners.forEach(f => f());

/** Save colors under a name (replacing a saved palette with the same name). Returns the palette, or null. */
export function savePalette(name, colors, from = currentTool()) {
  name = String(name || '').trim().slice(0, 40);
  const clean = cleanColors(colors);
  if (!name || !clean || name.toLowerCase() === BRAND_PALETTE.name.toLowerCase()) return null;
  const list = stored().filter(p => p.name.toLowerCase() !== name.toLowerCase());
  const pal = {id: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name, colors: clean, from: from || '', at: Date.now()};
  writeJSON(PAL_KEY, [pal, ...list].slice(0, MAX_PALETTES));
  palChanged();
  return pal;
}

export function deletePalette(id) {
  writeJSON(PAL_KEY, stored().filter(p => p.id !== id));
  palChanged();
}

/** Call fn() when suite palettes change, here or in another tab. Returns a stop function. */
export function watchPalettes(fn) {
  const onStorage = e => { if (e.key === PAL_KEY || e.key === null) fn(); };
  if (typeof window !== 'undefined') window.addEventListener('storage', onStorage);
  palListeners.add(fn);
  return () => { if (typeof window !== 'undefined') window.removeEventListener('storage', onStorage); palListeners.delete(fn); };
}
