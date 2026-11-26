// GLYF's shape catalog: families of glyphs made from a few settings and a seed. Each
// family builds ordinary parts (rectangles, ellipses, polygons, cuts, keeps) on the
// 100 × 100 board, so whatever it makes can be opened in the editor and changed.
// Framework-free; scripts/families-check.mjs runs every family.
import {R, E, Q, P, asCut, asKeep, arcBand, arcPts, starPts, strokePts, n2} from './shapes.js';

/** Seeded random numbers in 0..1 (mulberry32). */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const TAGS = ['Geometric', 'Radial', 'Grid', 'Line', 'Arcs', 'Organic', 'Tiles', 'Random'];
const CORNERS = [{v: 0, l: 'Top left'}, {v: 1, l: 'Top right'}, {v: 2, l: 'Bottom right'}, {v: 3, l: 'Bottom left'}];
const CORNER_XY = [[0, 0], [100, 0], [100, 100], [0, 100]];
const CORNER_A = [0, 90, 180, 270]; // where each corner's quarter arc starts
const BOARD = () => asKeep(R(0, 0, 100, 100)); // keeps only what's on the board
const num = (key, label, min, max, step, def) => ({key, label, min, max, step, def});
const pick = (key, label, options, def) => ({key, label, options, def});

const MARKS = [{v: 'ring', l: 'Ring'}, {v: 'dot', l: 'Dot'}, {v: 'plus', l: 'Plus'}, {v: 'cross', l: 'Cross'}, {v: 'bars', l: 'Bars'}, {v: 'slash', l: 'Slash'}, {v: 'square', l: 'Square'}];
function mark(kind, s) {
  // A mark of size s (0..50) at the board centre, as parts to cut.
  const c = 50, w = Math.max(4, s * 0.45);
  switch (kind) {
    case 'ring': return [E(c, c, s)]; // the tile paints the ring's inside back (see Cut tile)
    case 'dot': return [E(c, c, s * 0.6)];
    case 'plus': return [R(c - w / 2, c - s, w, s * 2), R(c - s, c - w / 2, s * 2, w)];
    case 'cross': return [P(strokePts(c - s * 0.75, c - s * 0.75, c + s * 0.75, c + s * 0.75, w)), P(strokePts(c + s * 0.75, c - s * 0.75, c - s * 0.75, c + s * 0.75, w))];
    case 'bars': return [0, 1, 2].map(i => R(c - s, c - s * 0.8 + i * s * 0.6 - w * 0.25, s * 2, w * 0.5));
    case 'slash': return [P(strokePts(c - s * 0.8, c + s * 0.8, c + s * 0.8, c - s * 0.8, w))];
    default: return [R(c - s * 0.6, c - s * 0.6, s * 1.2, s * 1.2)];
  }
}

export const FAMILIES = [
  {
    id: 'tile', name: 'Cut tile', tags: ['Tiles', 'Geometric'],
    about: 'A square with a mark cut out of it, like a key on a keypad.',
    params: [pick('mark', 'Mark', MARKS, 'ring'), num('corner', 'Corner', 0, 50, 1, 22), num('size', 'Mark size', 8, 40, 1, 24)],
    build: p => {
      const parts = mark(p.mark, p.size);
      // A ring cut out is a ring of paper: cut its outer circle, then paint its inside back.
      if (p.mark === 'ring') return [R(0, 0, 100, 100, p.corner), asCut(E(50, 50, p.size)), E(50, 50, Math.max(1, p.size - Math.max(4, p.size * 0.45)))];
      return [R(0, 0, 100, 100, p.corner), ...parts.map(asCut)];
    },
  },
  {
    id: 'qrings', name: 'Quarter rings', tags: ['Arcs', 'Radial'],
    about: 'Concentric quarter-circle bands spreading from one corner.',
    params: [num('rings', 'Rings', 1, 6, 1, 3), num('weight', 'Weight', 0.15, 1, 0.05, 0.5), pick('corner', 'Corner', CORNERS, 0)],
    build: p => {
      const [cx, cy] = CORNER_XY[p.corner], a0 = CORNER_A[p.corner], step = 100 / p.rings, out = [];
      for (let i = 0; i < p.rings; i++) {
        const r1 = 100 - i * step, r0 = Math.max(0, r1 - step * p.weight);
        out.push(arcBand(cx, cy, r0, r1, a0, a0 + 90));
      }
      return out;
    },
  },
  {
    id: 'truchet', name: 'Truchet arcs', tags: ['Arcs', 'Tiles'],
    about: 'Two quarter-circle bands on opposite corners. Turned at random across a grid, they join into endless paths.',
    params: [num('weight', 'Weight', 4, 40, 1, 16), num('bands', 'Bands', 1, 3, 1, 1)],
    build: p => {
      const out = [], gap = 50 / (p.bands * 2);
      for (let b = 0; b < p.bands; b++) {
        const r = gap * (2 * b + 1);
        out.push(arcBand(0, 0, Math.max(0, r - p.weight / 2), r + p.weight / 2, 0, 90));
        out.push(arcBand(100, 100, Math.max(0, r - p.weight / 2), r + p.weight / 2, 180, 270));
      }
      return [...out, BOARD()];
    },
  },
  {
    id: 'stripes', name: 'Stripes', tags: ['Line'],
    about: 'Parallel bars at one of four angles.',
    params: [num('count', 'Stripes', 1, 10, 1, 4), num('weight', 'Weight', 0.1, 0.9, 0.05, 0.5), pick('angle', 'Angle', [{v: 0, l: 'Across'}, {v: 90, l: 'Down'}, {v: 45, l: 'Rising'}, {v: 135, l: 'Falling'}], 0)],
    build: p => {
      const out = [], diag = p.angle % 90 !== 0, span = diag ? 142 : 100, step = span / p.count, w = step * p.weight;
      for (let i = 0; i < p.count; i++) {
        const t = -span / 2 + step * (i + 0.5);
        const a = (p.angle * Math.PI) / 180, nx = -Math.sin(a), ny = Math.cos(a), dx = Math.cos(a) * 80, dy = Math.sin(a) * 80;
        const cx = 50 + nx * t, cy = 50 + ny * t;
        out.push(P(strokePts(cx - dx, cy - dy, cx + dx, cy + dy, w)));
      }
      return [...out, BOARD()];
    },
  },
  {
    id: 'poly', name: 'Polygon', tags: ['Geometric'],
    about: 'A regular polygon, solid or as an outline.',
    params: [num('sides', 'Sides', 3, 12, 1, 6), num('turn', 'Turn', 0, 60, 1, 0), num('hollow', 'Hollow', 0, 0.9, 0.05, 0)],
    build: p => {
      const outer = P(starPts(50, 50, 50, p.sides, -90 + p.turn));
      return p.hollow > 0 ? [outer, asCut(P(starPts(50, 50, 50 * p.hollow, p.sides, -90 + p.turn)))] : [outer];
    },
  },
  {
    id: 'star', name: 'Star', tags: ['Geometric', 'Radial'],
    about: 'A star with any number of points, from spiky to almost round.',
    params: [num('points', 'Points', 3, 16, 1, 5), num('inner', 'Inner', 0.1, 0.9, 0.05, 0.45), num('turn', 'Turn', 0, 45, 1, 0)],
    build: p => [P(starPts(50, 50, 50, p.points, -90 + p.turn, p.inner))],
  },
  {
    id: 'dots', name: 'Dot grid', tags: ['Grid'],
    about: 'A small grid of dots in a pattern.',
    params: [num('n', 'Grid', 2, 6, 1, 3), num('size', 'Dot size', 0.2, 1, 0.05, 0.7), pick('fill', 'Pattern', [{v: 'all', l: 'All'}, {v: 'checker', l: 'Checker'}, {v: 'diag', l: 'Diagonal'}, {v: 'frame', l: 'Frame'}, {v: 'random', l: 'Random'}], 'all'), num('seed', 'Seed', 1, 99, 1, 1)],
    build: p => {
      const R0 = rng(p.seed), c = 100 / p.n, out = [];
      for (let y = 0; y < p.n; y++) for (let x = 0; x < p.n; x++) {
        const on = p.fill === 'checker' ? (x + y) % 2 === 0 : p.fill === 'diag' ? x === y || x + y === p.n - 1 : p.fill === 'frame' ? x === 0 || y === 0 || x === p.n - 1 || y === p.n - 1 : p.fill === 'random' ? R0() < 0.55 : true;
        if (on) out.push(E(c * (x + 0.5), c * (y + 0.5), (c / 2) * p.size));
      }
      return out.length ? out : [E(50, 50, (c / 2) * p.size)];
    },
  },
  {
    id: 'rings', name: 'Rings', tags: ['Radial'],
    about: 'Concentric rings, whole or cut to a half or a quarter.',
    params: [num('count', 'Rings', 1, 6, 1, 3), num('weight', 'Weight', 0.15, 0.9, 0.05, 0.5), pick('part', 'Part', [{v: 360, l: 'Whole'}, {v: 180, l: 'Half'}, {v: 90, l: 'Quarter'}], 360)],
    build: p => {
      const step = 50 / p.count, out = [];
      for (let i = 0; i < p.count; i++) {
        const r1 = 50 - i * step, r0 = Math.max(0, r1 - step * p.weight);
        out.push(p.part === 360 ? arcBand(50, 50, r0, r1, 0, 359.99, 64) : arcBand(50, 50, r0, r1, 180, 180 + p.part, 48));
      }
      return out;
    },
  },
  {
    id: 'petals', name: 'Petals', tags: ['Organic', 'Radial'],
    about: 'Pointed petals around a centre, with or without a hole.',
    params: [num('count', 'Petals', 2, 12, 1, 6), num('length', 'Length', 0.3, 1, 0.05, 0.9), num('width', 'Width', 0.1, 0.7, 0.05, 0.35), pick('hole', 'Centre', [{v: 0, l: 'Solid'}, {v: 1, l: 'Hole'}], 0)],
    build: p => {
      const out = [], L = 50 * p.length;
      for (let i = 0; i < p.count; i++) {
        const a = (i / p.count) * 360 - 90, half = (p.width * 180) / p.count;
        // A petal: two arcs meeting at the tip (a lens from the centre outward).
        const tip = [50 + Math.cos((a * Math.PI) / 180) * L, 50 + Math.sin((a * Math.PI) / 180) * L];
        const side = s => { const b = ((a + s * half) * Math.PI) / 180; return [50 + Math.cos(b) * L * 0.55, 50 + Math.sin(b) * L * 0.55]; };
        const l = side(-1), r = side(1), pts = [[50, 50]];
        for (let k = 1; k <= 8; k++) { const t = k / 8; pts.push([(1 - t) * (1 - t) * 50 + 2 * (1 - t) * t * l[0] + t * t * tip[0], (1 - t) * (1 - t) * 50 + 2 * (1 - t) * t * l[1] + t * t * tip[1]]); }
        for (let k = 7; k >= 1; k--) { const t = k / 8; pts.push([(1 - t) * (1 - t) * 50 + 2 * (1 - t) * t * r[0] + t * t * tip[0], (1 - t) * (1 - t) * 50 + 2 * (1 - t) * t * r[1] + t * t * tip[1]]); }
        out.push(P(pts.map(([x, y]) => [n2(x), n2(y)])));
      }
      return p.hole ? [...out, asCut(E(50, 50, L * 0.18))] : out;
    },
  },
  {
    id: 'steps', name: 'Steps', tags: ['Grid'],
    about: 'A staircase climbing to one corner.',
    params: [num('steps', 'Steps', 2, 8, 1, 4), pick('corner', 'Toward', CORNERS, 1)],
    build: p => {
      const s = 100 / p.steps, out = [];
      for (let i = 0; i < p.steps; i++) {
        const h = s * (i + 1), x = i * s;
        // Built toward the top right, then turned to the chosen corner by mirroring.
        let r = [x, 100 - h, s, h];
        if (p.corner === 0 || p.corner === 3) r = [100 - x - s, r[1], s, h];
        if (p.corner === 2 || p.corner === 3) r = [r[0], 0, s, h];
        out.push(R(n2(r[0]), n2(r[1]), n2(r[2]), n2(r[3])));
      }
      return out;
    },
  },
  {
    id: 'chevrons', name: 'Chevrons', tags: ['Line'],
    about: 'Stacked V shapes pointing one way.',
    params: [num('count', 'Chevrons', 1, 5, 1, 2), num('weight', 'Weight', 4, 30, 1, 14), pick('dir', 'Point', [{v: 0, l: 'Up'}, {v: 90, l: 'Right'}, {v: 180, l: 'Down'}, {v: 270, l: 'Left'}], 0)],
    build: p => {
      const out = [], gap = 100 / (p.count + 1);
      for (let i = 0; i < p.count; i++) {
        const y = gap * (i + 1) + 15;
        const pts = [[0, y + 25], [50, y - 25], [100, y + 25], [100, y + 25 + p.weight], [50, y - 25 + p.weight], [0, y + 25 + p.weight]];
        out.push(P(turnPts(pts, p.dir)));
      }
      return [...out, BOARD()];
    },
  },
  {
    id: 'wave', name: 'Wave', tags: ['Organic', 'Line'],
    about: 'Bands that rise and fall like waves.',
    params: [num('periods', 'Waves', 0.5, 4, 0.5, 1), num('amp', 'Height', 0, 40, 1, 18), num('weight', 'Weight', 4, 40, 1, 16), num('bands', 'Bands', 1, 4, 1, 1)],
    build: p => {
      const out = [], gap = 100 / p.bands;
      for (let b = 0; b < p.bands; b++) {
        const y0 = gap * (b + 0.5), top = [], bot = [];
        for (let i = 0; i <= 40; i++) {
          const x = -2 + i * 2.6, y = y0 + p.amp * Math.sin((x / 100) * p.periods * Math.PI * 2) * (p.bands > 1 ? 1 / p.bands : 1);
          top.push([n2(x), n2(y - p.weight / 2)]); bot.unshift([n2(x), n2(y + p.weight / 2)]);
        }
        out.push(P(top.concat(bot)));
      }
      return [...out, BOARD()];
    },
  },
  {
    id: 'sector', name: 'Sector', tags: ['Radial', 'Geometric'],
    about: 'A slice of a circle, solid or as a curved band.',
    params: [num('sweep', 'Sweep', 30, 360, 5, 270), num('start', 'Start', 0, 355, 5, 0), num('hollow', 'Hollow', 0, 0.9, 0.05, 0)],
    build: p => [arcBand(50, 50, 50 * p.hollow, 50, p.start - 90, p.start - 90 + Math.min(359.99, p.sweep), 64)],
  },
  {
    id: 'blocks', name: 'Blocks', tags: ['Grid', 'Random'],
    about: 'Squares filled at random on a small grid, optionally mirrored like an emblem.',
    params: [num('n', 'Grid', 2, 8, 1, 4), num('fill', 'Fill', 0.1, 0.9, 0.05, 0.5), pick('mirror', 'Mirror', [{v: 0, l: 'None'}, {v: 1, l: 'Left–right'}, {v: 2, l: 'Four ways'}], 1), num('seed', 'Seed', 1, 999, 1, 7)],
    build: p => {
      const R0 = rng(p.seed), c = 100 / p.n, on = [];
      for (let y = 0; y < p.n; y++) for (let x = 0; x < p.n; x++) {
        const sx = p.mirror >= 1 ? Math.min(x, p.n - 1 - x) : x, sy = p.mirror === 2 ? Math.min(y, p.n - 1 - y) : y;
        on.push([x, y, sx, sy]);
      }
      const roll = new Map();
      const out = on.filter(([, , sx, sy]) => { const k = sx + ',' + sy; if (!roll.has(k)) roll.set(k, R0() < p.fill); return roll.get(k); })
        .map(([x, y]) => R(n2(x * c), n2(y * c), n2(c), n2(c)));
      return out.length ? out : [R(0, 0, c, c)];
    },
  },
  {
    id: 'lens', name: 'Lens', tags: ['Organic', 'Geometric'],
    about: 'Where two circles overlap: a pointed oval, alone or crossed.',
    params: [num('width', 'Width', 0.15, 1, 0.05, 0.5), pick('angle', 'Angle', [{v: 0, l: 'Upright'}, {v: 45, l: 'Leaning'}, {v: 90, l: 'Lying'}], 0), pick('cross', 'Cross', [{v: 0, l: 'Single'}, {v: 1, l: 'Crossed'}], 0)],
    build: p => {
      const lens = a => {
        // Two arcs meeting at the ends of a 100-long axis; width sets how full they are.
        const h = 50 * p.width, R2 = (50 * 50 + h * h) / (2 * h), off = R2 - h, span = (Math.asin(50 / R2) * 180) / Math.PI;
        const left = arcPts(50 - off, 50, R2, R2, -span, span, 24), right = arcPts(50 + off, 50, R2, R2, 180 - span, 180 + span, 24);
        return P(turnPts([...left, ...right], 90 + a));
      };
      return p.cross ? [lens(p.angle), lens(p.angle + 90)] : [lens(p.angle)];
    },
  },
  {
    id: 'cross', name: 'Cross', tags: ['Geometric'],
    about: 'A plus or an X, thin to heavy.',
    params: [num('weight', 'Weight', 0.08, 0.6, 0.02, 0.25), pick('turn', 'Turn', [{v: 0, l: 'Plus'}, {v: 45, l: 'X'}], 0), num('reach', 'Reach', 0.4, 1, 0.05, 1)],
    build: p => {
      const w = 100 * p.weight, L = 50 * p.reach;
      if (p.turn === 0) return [R(50 - w / 2, 50 - L, w, L * 2), R(50 - L, 50 - w / 2, L * 2, w)];
      const d = L * 1.2;
      return [P(strokePts(50 - d, 50 - d, 50 + d, 50 + d, w)), P(strokePts(50 + d, 50 - d, 50 - d, 50 + d, w)), BOARD()];
    },
  },
  {
    id: 'spiral', name: 'Spiral', tags: ['Organic', 'Radial'],
    about: 'A band winding out from the centre.',
    params: [num('turns', 'Turns', 1, 5, 0.25, 2.5), num('weight', 'Weight', 2, 16, 0.5, 7)],
    build: p => {
      const n = Math.round(p.turns * 48), maxR = 48 - p.weight / 2, outer = [], inner = [];
      for (let i = 0; i <= n; i++) {
        const t = i / n, a = t * p.turns * Math.PI * 2 - Math.PI / 2, r = 2 + t * (maxR - 2);
        outer.push([n2(50 + Math.cos(a) * (r + p.weight / 2)), n2(50 + Math.sin(a) * (r + p.weight / 2))]);
        inner.unshift([n2(50 + Math.cos(a) * Math.max(0, r - p.weight / 2)), n2(50 + Math.sin(a) * Math.max(0, r - p.weight / 2))]);
      }
      return [P(outer.concat(inner))];
    },
  },
  {
    id: 'corners', name: 'Corner marks', tags: ['Line', 'Tiles'],
    about: 'L-shaped marks in the corners, like crop marks or a frame.',
    params: [num('length', 'Length', 10, 50, 1, 30), num('weight', 'Weight', 2, 20, 1, 8), pick('which', 'Corners', [{v: 4, l: 'All four'}, {v: 2, l: 'Two'}, {v: 1, l: 'One'}], 4)],
    build: p => {
      const L = p.length, w = p.weight, all = [
        [R(0, 0, L, w), R(0, 0, w, L)], [R(100 - L, 100 - w, L, w), R(100 - w, 100 - L, w, L)],
        [R(100 - L, 0, L, w), R(100 - w, 0, w, L)], [R(0, 100 - w, L, w), R(0, 100 - L, w, L)],
      ];
      return all.slice(0, p.which).flat();
    },
  },
  {
    id: 'quarter', name: 'Quarter circle', tags: ['Arcs', 'Tiles'],
    about: 'A quarter circle from one corner, with an optional bite out of it.',
    params: [pick('corner', 'Corner', CORNERS, 0), num('bite', 'Bite', 0, 0.9, 0.05, 0)],
    build: p => {
      const q = Q(0, 0, 100, 100, p.corner); // pivots on the chosen corner
      const [cx, cy] = CORNER_XY[p.corner];
      return p.bite > 0 ? [arcBand(cx, cy, 100 * p.bite, 100, CORNER_A[p.corner], CORNER_A[p.corner] + 90)] : [q];
    },
  },
];
export const FAMILY = Object.fromEntries(FAMILIES.map(f => [f.id, f]));

/** Points turned by deg about the board centre. */
function turnPts(pts, deg) {
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  return pts.map(([x, y]) => [n2(50 + (x - 50) * c - (y - 50) * s), n2(50 + (x - 50) * s + (y - 50) * c)]);
}

/** A family's default settings. */
export const defaults = f => Object.fromEntries(f.params.map(q => [q.key, q.def]));

/** The parts a family makes with settings p (missing settings take their defaults). */
export function buildFamily(id, p = {}) {
  const f = FAMILY[id];
  return f.build({...defaults(f), ...p});
}
