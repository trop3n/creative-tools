// Shape model: a glyph is a list of parts on a 100×100 board. Parts paint in
// order; a "cut" part erases everything painted before it, and a "keep" part (clip)
// keeps only what lies inside it (an intersection).

export const uid = () => Math.random().toString(36).slice(2, 10);
export const clone = o => JSON.parse(JSON.stringify(o));
export const n2 = v => Math.round(v * 100) / 100;

export const R = (x, y, w, h, rx) => Object.assign({t: 'rect', x, y, w, h}, rx ? {rx} : {});
export const E = (cx, cy, rx, ry = rx) => ({t: 'ellipse', cx, cy, rx, ry});
export const Q = (x, y, w, h, c) => ({t: 'quarter', x, y, w, h, c});
export const T = (x, y, w, h, c) => ({t: 'tri', x, y, w, h, c});
export const P = pts => ({t: 'poly', pts});
const cut = e => ((e.cut = true), e);
export const asCut = cut;
export const asKeep = e => ((e.clip = true), e);
/** A part's paint mode: 'add', 'cut' or 'keep'. */
export const modeOf = e => (e.clip ? 'keep' : e.cut ? 'cut' : 'add');
export const setMode = (e, m) => { delete e.cut; delete e.clip; if (m === 'cut') e.cut = true; if (m === 'keep') e.clip = true; return e; };
export const BOX = {rect: 1, quarter: 1, tri: 1};

const SEEDS = [
  ['Line', [R(43.75, 0, 12.5, 100)], 1],
  ['Dot', [E(50, 50, 18.75)], 1],
  ['Spandrel', [R(0, 0, 100, 100), cut(Q(0, 0, 100, 100, 2))], 1],
  ['Plus', [R(37.5, 0, 25, 100), R(0, 37.5, 100, 25)], 1],
  ['Crescent', [E(50, 50, 50), cut(E(75, 50, 50))], 1],
  ['Ring', [E(50, 50, 50), cut(E(50, 50, 31.25))], 1],
  ['Checker', [R(0, 0, 50, 50), R(50, 50, 50, 50)], 1],
  ['Quarter', [Q(0, 0, 100, 100, 0)], 1],
  ['Disc', [E(50, 50, 50)], 1],
  ['Block', [R(0, 0, 100, 100)], 1],
  ['Wedge', [T(0, 0, 100, 100, 3)], 0],
  ['Half', [E(50, 50, 50), cut(R(0, 0, 100, 50))], 0],
  ['Diamond', [P([[50, 0], [100, 50], [50, 100], [0, 50]])], 0],
  ['Frame', [R(0, 0, 100, 100), cut(R(25, 25, 50, 50))], 0],
  ['Bowtie', [P([[0, 0], [50, 50], [0, 100]]), P([[100, 0], [50, 50], [100, 100]])], 0],
  ['Arch', [R(0, 50, 100, 50), E(50, 50, 50), cut(R(25, 50, 50, 50)), cut(E(50, 50, 25))], 0],
  ['Pill', [R(0, 31.25, 100, 37.5, 18.75)], 0],
  ['Four dots', [E(25, 25, 15), E(75, 25, 15), E(25, 75, 15), E(75, 75, 15)], 0],
  ['Steps', [P([[0, 100], [0, 75], [25, 75], [25, 50], [50, 50], [50, 25], [75, 25], [75, 0], [100, 0], [100, 100]])], 0],
];
// Tiles: rounded squares with a mark cut out of them. Mixed in one set (their ink is
// nearly the same), they make a grid of little tiles. Not in the set until chosen.
const TILE = () => R(0, 0, 100, 100, 22);
const TILES = [
  ['Tile ring', [TILE(), cut(E(50, 50, 25)), E(50, 50, 15)]],
  ['Tile dot', [TILE(), cut(E(50, 50, 14))]],
  ['Tile plus', [TILE(), cut(R(43, 24, 14, 52)), cut(R(24, 43, 52, 14))]],
  ['Tile bars', [TILE(), cut(R(25, 27, 50, 10)), cut(R(25, 45, 50, 10)), cut(R(25, 63, 50, 10))]],
];
export const TILE_NAMES = TILES.map(t => t[0]);
/** The tile glyphs, not in the set. */
export const tileShapes = () => TILES.map(([name, els]) => ({id: uid(), name, els: clone(els), inSet: false}));

export const seedLib = () => ({
  v: 1,
  shapes: [...SEEDS.map(([name, els, s]) => ({id: uid(), name, els: clone(els), inSet: !!s})), ...tileShapes()],
  tiles: true,
});

export const corners = e => [[e.x, e.y], [e.x + e.w, e.y], [e.x + e.w, e.y + e.h], [e.x, e.y + e.h]];
export const pt = p => n2(p[0]) + ' ' + n2(p[1]);

export function elMarkup(e) {
  switch (e.t) {
    case 'rect':
      return `<rect x="${n2(e.x)}" y="${n2(e.y)}" width="${n2(e.w)}" height="${n2(e.h)}"${e.rx ? ` rx="${n2(Math.min(e.rx, e.w / 2, e.h / 2))}"` : ''}/>`;
    case 'ellipse':
      return `<ellipse cx="${n2(e.cx)}" cy="${n2(e.cy)}" rx="${n2(e.rx)}" ry="${n2(e.ry)}"/>`;
    case 'quarter': {
      const C = corners(e), Pc = C[e.c], A = C[e.c ^ 1], B = C[3 - e.c], sw = e.c === 0 || e.c === 2 ? 1 : 0;
      return `<path d="M${pt(Pc)} L${pt(A)} A${n2(e.w)} ${n2(e.h)} 0 0 ${sw} ${pt(B)}Z"/>`;
    }
    case 'tri': {
      const C = corners(e);
      return `<polygon points="${pt(C[e.c])} ${pt(C[e.c ^ 1])} ${pt(C[3 - e.c])}"/>`;
    }
    case 'poly':
      return `<polygon points="${e.pts.map(pt).join(' ')}"/>`;
    case 'raw':
      return `<g transform="${e.tf || ''}">${e.m}</g>`;
  }
  return '';
}

let anon = 0;
/** SVG markup for a glyph. `prefix` keeps mask ids unique (and stable) per place it is drawn. */
export function shapeInner(shape, prefix) {
  const pre = prefix || 'a' + ++anon;
  let acc = '', k = 0;
  for (const e of shape.els) {
    if (e.cut || e.clip) {
      // Cut: a white mask with the part in black. Keep: a black mask with the part in white.
      const id = `${pre}-m${k++}`, bg = e.clip ? '#000' : '#fff', fg = e.clip ? '#fff' : '#000';
      acc = `<mask id="${id}" maskUnits="userSpaceOnUse" x="-60" y="-60" width="220" height="220"><rect x="-60" y="-60" width="220" height="220" fill="${bg}"/><g fill="${fg}" color="${fg}">${elMarkup(e)}</g></mask><g mask="url(#${id})">${acc}</g>`;
    } else acc += elMarkup(e);
  }
  return `<g fill="currentColor">${acc}</g>`;
}
export const glyphSVG = (shape, size, color = '#000') =>
  `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 100 100" width="${size}" height="${size}" color="${color}">${shapeInner(shape)}</svg>`;

export function getBox(e) {
  if (BOX[e.t]) return {x: e.x, y: e.y, w: e.w, h: e.h};
  if (e.t === 'ellipse') return {x: e.cx - e.rx, y: e.cy - e.ry, w: e.rx * 2, h: e.ry * 2};
  if (e.t === 'poly') {
    const xs = e.pts.map(p => p[0]), ys = e.pts.map(p => p[1]);
    const x = Math.min(...xs), y = Math.min(...ys);
    return {x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y};
  }
  return {x: 0, y: 0, w: 100, h: 100};
}
export function setBox(e, b) {
  if (BOX[e.t]) Object.assign(e, {x: b.x, y: b.y, w: b.w, h: b.h});
  else if (e.t === 'ellipse') Object.assign(e, {cx: b.x + b.w / 2, cy: b.y + b.h / 2, rx: b.w / 2, ry: b.h / 2});
}
export function moveEl(o, dx, dy) {
  const e = clone(o);
  if (BOX[e.t]) { e.x += dx; e.y += dy; }
  else if (e.t === 'ellipse') { e.cx += dx; e.cy += dy; }
  else if (e.t === 'poly') e.pts = e.pts.map(p => [p[0] + dx, p[1] + dy]);
  else if (e.t === 'raw') e.tf = `translate(${n2(dx)} ${n2(dy)}) ` + (e.tf || '');
  return e;
}
/** Rotate 90° clockwise ('rot') or flip ('fh' / 'fv') about the board centre. */
export function xfEl(e, k) {
  if (BOX[e.t]) {
    const {x, y, w, h} = e;
    if (k === 'rot') { e.x = 100 - (y + h); e.y = x; e.w = h; e.h = w; if (e.c != null) e.c = (e.c + 1) % 4; }
    if (k === 'fh') { e.x = 100 - x - w; if (e.c != null) e.c ^= 1; }
    if (k === 'fv') { e.y = 100 - y - h; if (e.c != null) e.c = 3 - e.c; }
  } else if (e.t === 'ellipse') {
    if (k === 'rot') { const cx = e.cx; e.cx = 100 - e.cy; e.cy = cx; [e.rx, e.ry] = [e.ry, e.rx]; }
    if (k === 'fh') e.cx = 100 - e.cx;
    if (k === 'fv') e.cy = 100 - e.cy;
  } else if (e.t === 'poly') {
    e.pts = e.pts.map(([x, y]) => (k === 'rot' ? [100 - y, x] : k === 'fh' ? [100 - x, y] : [x, 100 - y]));
  } else if (e.t === 'raw') {
    e.tf = {rot: 'rotate(90 50 50)', fh: 'matrix(-1 0 0 1 100 0)', fv: 'matrix(1 0 0 -1 0 100)'}[k] + ' ' + (e.tf || '');
  }
  return e;
}
/** Same, about the part's own centre. */
export function xfLocal(o, k) {
  const b = getBox(o), cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  return moveEl(xfEl(moveEl(o, 50 - cx, 50 - cy), k), cx - 50, cy - 50);
}
export function boxFrom(a, b, square) {
  let dx = b.x - a.x, dy = b.y - a.y;
  if (square) { const m = Math.max(Math.abs(dx), Math.abs(dy)); dx = Math.sign(dx || 1) * m; dy = Math.sign(dy || 1) * m; }
  const c = dx >= 0 ? (dy >= 0 ? 0 : 3) : dy >= 0 ? 1 : 2;
  return {x: Math.min(a.x, a.x + dx), y: Math.min(a.y, a.y + dy), w: Math.abs(dx), h: Math.abs(dy), c};
}
/* ---------- geometry: polygons for any angle ---------- */
const DEG = Math.PI / 180;
/** Points along an arc (degrees, 0 = right, clockwise on screen). */
export function arcPts(cx, cy, rx, ry, a0, a1, n = 32) {
  const out = [];
  for (let i = 0; i <= n; i++) { const a = (a0 + ((a1 - a0) * i) / n) * DEG; out.push([n2(cx + Math.cos(a) * rx), n2(cy + Math.sin(a) * ry)]); }
  return out;
}
/** A band between two radii over an arc; inner radius 0 makes a pie slice. */
export function arcBand(cx, cy, r0, r1, a0, a1, n = 40) {
  const outer = arcPts(cx, cy, r1, r1, a0, a1, n);
  return P(r0 > 0.01 ? outer.concat(arcPts(cx, cy, r0, r0, a1, a0, n)) : outer.concat([[cx, cy]]));
}
/** A regular polygon or star (inner 0..1 of the radius; 1 or more = plain polygon). */
export function starPts(cx, cy, r, n, rotDeg = -90, inner = 1) {
  const pts = [], k = inner < 1 ? 2 : 1;
  for (let i = 0; i < n * k; i++) {
    const a = (rotDeg + (360 * i) / (n * k)) * DEG, rr = k === 2 && i % 2 ? r * inner : r;
    pts.push([n2(cx + Math.cos(a) * rr), n2(cy + Math.sin(a) * rr)]);
  }
  return pts;
}
/** A thick straight stroke from (x1, y1) to (x2, y2), square-ended. */
export function strokePts(x1, y1, x2, y2, w) {
  const dx = x2 - x1, dy = y2 - y1, l = Math.hypot(dx, dy) || 1, nx = (-dy / l) * (w / 2), ny = (dx / l) * (w / 2);
  return [[x1 + nx, y1 + ny], [x2 + nx, y2 + ny], [x2 - nx, y2 - ny], [x1 - nx, y1 - ny]].map(q => [n2(q[0]), n2(q[1])]);
}
/** Any part as a polygon (raw SVG can't be), keeping its paint mode; rounded corners too. */
export function toPoly(e) {
  let pts = null;
  if (e.t === 'poly') pts = e.pts.map(q => q.slice());
  else if (e.t === 'rect') {
    const r = Math.min(e.rx || 0, e.w / 2, e.h / 2);
    pts = r < 0.01 ? corners(e) : [
      ...arcPts(e.x + e.w - r, e.y + r, r, r, -90, 0, 8), ...arcPts(e.x + e.w - r, e.y + e.h - r, r, r, 0, 90, 8),
      ...arcPts(e.x + r, e.y + e.h - r, r, r, 90, 180, 8), ...arcPts(e.x + r, e.y + r, r, r, 180, 270, 8),
    ];
  } else if (e.t === 'ellipse') pts = arcPts(e.cx, e.cy, e.rx, e.ry, 0, 360, 64).slice(0, -1);
  else if (e.t === 'tri') { const C = corners(e); pts = [C[e.c], C[e.c ^ 1], C[3 - e.c]]; }
  else if (e.t === 'quarter') {
    const C = corners(e), pc = C[e.c], start = Math.atan2(C[e.c ^ 1][1] - pc[1], C[e.c ^ 1][0] - pc[0]) / DEG;
    const end = Math.atan2(C[3 - e.c][1] - pc[1], C[3 - e.c][0] - pc[0]) / DEG;
    let sweep = end - start; if (sweep > 180) sweep -= 360; if (sweep < -180) sweep += 360;
    // An elliptical quarter: scale a unit arc to the box.
    pts = [pc, ...Array.from({length: 25}, (_, i) => {
      const a = (start + (sweep * i) / 24) * DEG;
      return [n2(pc[0] + Math.cos(a) * e.w), n2(pc[1] + Math.sin(a) * e.h)];
    })];
  }
  if (!pts) return null;
  const out = P(pts);
  if (e.cut) out.cut = true;
  if (e.clip) out.clip = true;
  return out;
}
/** Rotate a part by any angle about (cx, cy) (default: its own centre). Returns a polygon. */
export function rotateEl(e, deg, cx, cy) {
  const q = toPoly(e); if (!q) return null;
  if (cx == null) { const b = getBox(q); cx = b.x + b.w / 2; cy = b.y + b.h / 2; }
  const c = Math.cos(deg * DEG), s = Math.sin(deg * DEG);
  q.pts = q.pts.map(([x, y]) => [n2(cx + (x - cx) * c - (y - cy) * s), n2(cy + (x - cx) * s + (y - cy) * c)]);
  return q;
}
/** Scale a part about its own centre. Box parts keep their kind; others become polygons. */
export function scaleEl(e, k) {
  const b = getBox(e), cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  if (BOX[e.t] || e.t === 'ellipse') {
    const o = clone(e); setBox(o, {x: cx - (b.w * k) / 2, y: cy - (b.h * k) / 2, w: b.w * k, h: b.h * k});
    if (o.rx) o.rx = n2(o.rx * k);
    return o;
  }
  const q = toPoly(e); if (!q) return null;
  q.pts = q.pts.map(([x, y]) => [n2(cx + (x - cx) * k), n2(cy + (y - cy) * k)]);
  return q;
}
/** Move and resize any part to the box b; polygons stretch their points. */
export function fitBox(e, b) {
  const o = clone(e);
  if (BOX[e.t] || e.t === 'ellipse') { setBox(o, b); return o; }
  if (e.t !== 'poly') return null;
  const a = getBox(e), sx = a.w ? b.w / a.w : 1, sy = a.h ? b.h / a.h : 1;
  o.pts = e.pts.map(([x, y]) => [n2(b.x + (x - a.x) * sx), n2(b.y + (y - a.y) * sy)]);
  return o;
}

export function makeEl(tool, b, isCut) {
  let e;
  if (tool === 'rect') e = R(b.x, b.y, b.w, b.h);
  else if (tool === 'ellipse') e = E(b.x + b.w / 2, b.y + b.h / 2, b.w / 2, b.h / 2);
  else if (tool === 'quarter') e = Q(b.x, b.y, b.w, b.h, b.c);
  else e = T(b.x, b.y, b.w, b.h, b.c);
  // isCut: true (cut) or a paint mode ('add' | 'cut' | 'keep').
  return setMode(e, isCut === true ? 'cut' : isCut || 'add');
}

/* ---------- SVG import ---------- */
const recolor = str => str.replace(/(fill|stroke)\s*:\s*(?!none|url)[^;}"]+/gi, '$1:currentColor');
export function parseSVG(text) {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const svg = doc.documentElement;
  if (!svg || svg.nodeName.toLowerCase() !== 'svg' || doc.getElementsByTagName('parsererror').length) throw new Error('not an SVG');
  [...svg.querySelectorAll('script,foreignObject,title,desc,metadata')].forEach(n => n.remove());
  const pre = 'i' + uid() + '-';
  for (const el of [svg, ...svg.querySelectorAll('*')]) {
    for (const a of [...el.attributes]) {
      const n = a.name.toLowerCase();
      if (n.startsWith('on')) { el.removeAttribute(a.name); continue; }
      if ((n === 'href' || n === 'xlink:href') && !a.value.startsWith('#')) { el.removeAttribute(a.name); continue; }
      if ((n === 'fill' || n === 'stroke') && !/^(none|url\()/i.test(a.value.trim())) el.setAttribute(a.name, 'currentColor');
      if (n === 'style') el.setAttribute('style', recolor(a.value));
    }
    if (el.id) el.id = pre + el.id;
    if (el.nodeName.toLowerCase() === 'style') el.textContent = recolor(el.textContent);
  }
  let vb = (svg.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
  if (vb.length !== 4 || vb.some(isNaN) || !vb[2] || !vb[3])
    vb = [0, 0, parseFloat(svg.getAttribute('width')) || 100, parseFloat(svg.getAttribute('height')) || 100];
  const [vx, vy, vw, vh] = vb, sc = Math.min(100 / vw, 100 / vh);
  const tx = (100 - vw * sc) / 2 - vx * sc, ty = (100 - vh * sc) / 2 - vy * sc;
  const ser = new XMLSerializer();
  let m = [...svg.childNodes].map(n => (n.nodeType === 1 ? ser.serializeToString(n) : '')).join('');
  m = m
    .replace(/url\(\s*['"]?#([^'")\s]+)['"]?\s*\)/g, (_, id) => `url(#${pre}${id})`)
    .replace(/(xlink:href|href)="#([^"]+)"/g, (_, a, id) => `${a}="#${pre}${id}"`);
  return {t: 'raw', m, tf: `translate(${n2(tx)} ${n2(ty)}) scale(${+sc.toPrecision(5)})`};
}
export const slug = s => (s || 'glyph').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'glyph';
