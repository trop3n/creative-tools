// Counts where the cloth passes through itself: sheet edges that cross a triangle they
// aren't part of. Used by sanity.mjs; run alone for a table across seeds:
// node scripts/pierce.mjs [seeds]
import {Cloth, QUALITY} from '../src/engine/cloth.js';

/** Edges of the sheet (structural and shear) that cross a triangle not sharing a corner. */
export function piercings(c) {
  const {pos, index, cab, ckind} = c;
  const T = index.length / 3;
  // Hash triangles by the grid cells their bounding boxes touch.
  const cell = c.h * 2, map = new Map();
  const key = (x, y, z) => x + ',' + y + ',' + z;
  for (let t = 0; t < T; t++) {
    let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let k = 0; k < 3; k++) {
      const p = index[t * 3 + k] * 3;
      for (let d = 0; d < 3; d++) { lo[d] = Math.min(lo[d], pos[p + d]); hi[d] = Math.max(hi[d], pos[p + d]); }
    }
    for (let x = Math.floor(lo[0] / cell); x <= Math.floor(hi[0] / cell); x++)
      for (let y = Math.floor(lo[1] / cell); y <= Math.floor(hi[1] / cell); y++)
        for (let z = Math.floor(lo[2] / cell); z <= Math.floor(hi[2] / cell); z++) {
          const k = key(x, y, z);
          if (!map.has(k)) map.set(k, []);
          map.get(k).push(t);
        }
  }
  let n = 0;
  for (let e = 0; e < ckind.length; e++) {
    if (ckind[e] === 2) continue; // bend links aren't drawn
    const a = cab[e * 2], b = cab[e * 2 + 1], A = a * 3, B = b * 3;
    const seen = new Set();
    const mid = [(pos[A] + pos[B]) / 2, (pos[A + 1] + pos[B + 1]) / 2, (pos[A + 2] + pos[B + 2]) / 2];
    const cx = Math.floor(mid[0] / cell), cy = Math.floor(mid[1] / cell), cz = Math.floor(mid[2] / cell);
    for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) for (let oz = -1; oz <= 1; oz++) {
      for (const t of map.get(key(cx + ox, cy + oy, cz + oz)) || []) {
        if (seen.has(t)) continue;
        seen.add(t);
        const i0 = index[t * 3], i1 = index[t * 3 + 1], i2 = index[t * 3 + 2];
        if (i0 === a || i1 === a || i2 === a || i0 === b || i1 === b || i2 === b) continue;
        if (segTri(pos, A, B, i0 * 3, i1 * 3, i2 * 3)) { n++; break; }
      }
    }
  }
  return n;
}

// Möller–Trumbore, limited to the segment.
function segTri(p, A, B, P0, P1, P2) {
  const dx = p[B] - p[A], dy = p[B + 1] - p[A + 1], dz = p[B + 2] - p[A + 2];
  const e1x = p[P1] - p[P0], e1y = p[P1 + 1] - p[P0 + 1], e1z = p[P1 + 2] - p[P0 + 2];
  const e2x = p[P2] - p[P0], e2y = p[P2 + 1] - p[P0 + 1], e2z = p[P2 + 2] - p[P0 + 2];
  const hx = dy * e2z - dz * e2y, hy = dz * e2x - dx * e2z, hz = dx * e2y - dy * e2x;
  const det = e1x * hx + e1y * hy + e1z * hz;
  if (Math.abs(det) < 1e-12) return false;
  const f = 1 / det, sx = p[A] - p[P0], sy = p[A + 1] - p[P0 + 1], sz = p[A + 2] - p[P0 + 2];
  const u = f * (sx * hx + sy * hy + sz * hz);
  if (u < 0 || u > 1) return false;
  const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
  const v = f * (dx * qx + dy * qy + dz * qz);
  if (v < 0 || u + v > 1) return false;
  const t = f * (e2x * qx + e2y * qy + e2z * qz);
  return t >= 0 && t <= 1;
}

if (process.argv[1]?.endsWith('pierce.mjs')) {
  const seeds = Number(process.argv[2]) || 6;
  for (const setup of ['heap', 'drape']) for (const [q, res] of Object.entries(QUALITY)) {
    const counts = [];
    for (let seed = 1; seed <= seeds; seed++) {
      const c = new Cloth({setup, res, seed});
      for (let t = 0; t < 8; t += 1 / 60) c.advance(1 / 60);
      counts.push(piercings(c));
    }
    console.log(`${setup.padEnd(6)} ${q.padEnd(6)} piercing edges per seed: ${counts.join(' ')}  (total ${counts.reduce((a, b) => a + b, 0)})`);
  }
}
