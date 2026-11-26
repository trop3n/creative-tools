// Node checks of the shape catalog (engine/families.js): every family builds at its
// defaults and at each setting's ends, with valid parts that stay near the board; and
// every pattern (engine/patterns.js) spans dark to light.
import {FAMILIES, buildFamily, defaults} from '../src/engine/families.js';
import {PATTERNS, drawPattern} from '../src/engine/patterns.js';

let fails = 0;
const fail = (...m) => { fails++; console.log('FAIL', ...m); };
const nums = e => {
  if (e.t === 'rect') return [e.x, e.y, e.w, e.h, e.rx || 0];
  if (e.t === 'ellipse') return [e.cx, e.cy, e.rx, e.ry];
  if (e.t === 'quarter' || e.t === 'tri') return [e.x, e.y, e.w, e.h];
  if (e.t === 'poly') return e.pts.flat();
  return [NaN];
};
for (const f of FAMILIES) {
  const variants = [defaults(f)];
  for (const q of f.params) {
    if (q.options) q.options.forEach(o => variants.push({...defaults(f), [q.key]: o.v}));
    else variants.push({...defaults(f), [q.key]: q.min}, {...defaults(f), [q.key]: q.max});
  }
  let parts = 0;
  for (const v of variants) {
    let els;
    try { els = buildFamily(f.id, v); } catch (e) { fail(f.id, JSON.stringify(v), e.message); continue; }
    if (!Array.isArray(els) || !els.length) { fail(f.id, JSON.stringify(v), 'no parts'); continue; }
    if (!els.some(e => !e.cut && !e.clip)) fail(f.id, JSON.stringify(v), 'nothing painted');
    for (const e of els) {
      const n = nums(e);
      if (!n.every(Number.isFinite)) fail(f.id, JSON.stringify(v), 'non-finite part', e.t);
      if (n.some(x => x < -60 || x > 160)) fail(f.id, JSON.stringify(v), 'part far off the board', e.t);
      if (e.t === 'poly' && e.pts.length < 3) fail(f.id, JSON.stringify(v), 'polygon with fewer than 3 points');
    }
    parts += els.length;
  }
  console.log(`${f.id.padEnd(9)} ${variants.length} variants, ${parts} parts`);
}
// Every pattern kind fills the frame with a full range from dark to light.
for (const pk of PATTERNS) for (const detail of [0, 1]) {
  const W = 64, H = 40, d = new Uint8ClampedArray(W * H * 4);
  drawPattern(d, W, H, {kind: pk.id, scale: 5, detail, angle: 30, seed: 3});
  let lo = 255, hi = 0; for (let i = 0; i < W * H; i++) { lo = Math.min(lo, d[i * 4]); hi = Math.max(hi, d[i * 4]); }
  if (hi - lo < 200) fail('pattern', pk.id, 'detail', detail, 'range only', lo, hi);
}
console.log('patterns', PATTERNS.map(p => p.id).join(' '));
const ids = FAMILIES.map(f => f.id);
if (new Set(ids).size !== ids.length) fail('duplicate family ids');
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
