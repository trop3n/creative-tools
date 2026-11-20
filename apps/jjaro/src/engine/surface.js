// The surface JJARO draws: a finer grid than the simulation's, passed smoothly through
// the particles with Catmull–Rom splines. Foil colour turns on small changes of the
// normal, so a coarse, flat-faceted mesh shows its triangles; this one doesn't.

const SUB = 3; // drawn points between neighbouring particles, plus one

export class Surface {
  constructor(cloth) {
    const W = cloth.W, R = (W - 1) * SUB + 1;
    Object.assign(this, {W, R, N: R * R, cloth});
    this.row = new Float32Array(W * R * 3); // pass 1: refined across, coarse down
    this.pos = new Float32Array(R * R * 3);
    this.nrm = new Float32Array(R * R * 3);
    this.tan = new Float32Array(R * R * 3);
    this.uv = new Float32Array(R * R * 2);
    for (let y = 0; y < R; y++) for (let x = 0; x < R; x++) {
      const i = y * R + x;
      this.uv[i * 2] = x / (R - 1); this.uv[i * 2 + 1] = y / (R - 1);
    }
    const idx = [];
    for (let y = 0; y + 1 < R; y++) for (let x = 0; x + 1 < R; x++) {
      const a = y * R + x, b = a + 1, c = a + R, d = c + 1;
      if ((x + y) & 1) idx.push(a, c, b, b, c, d); else idx.push(a, c, d, a, d, b);
    }
    this.index = Uint32Array.from(idx);
  }

  /** Recompute from the cloth's current particles. */
  update() {
    const {W, R, row, pos, nrm, tan} = this, src = this.cloth.pos;
    // Catmull–Rom weights for the SUB steps inside one span.
    const w = this.weights ||= Array.from({length: SUB}, (_, s) => {
      const t = s / SUB, t2 = t * t, t3 = t2 * t;
      return [-0.5 * t3 + t2 - 0.5 * t, 1.5 * t3 - 2.5 * t2 + 1, -1.5 * t3 + 2 * t2 + 0.5 * t, 0.5 * t3 - 0.5 * t2];
    });
    const clamp = (v, n) => (v < 0 ? 0 : v >= n ? n - 1 : v);
    // Across each particle row.
    for (let y = 0; y < W; y++) for (let X = 0; X < R; X++) {
      const k = Math.min(W - 2, Math.floor(X / SUB)), s = X - k * SUB, o = (y * R + X) * 3;
      if (X === (W - 1) * SUB) { for (let c = 0; c < 3; c++) row[o + c] = src[(y * W + W - 1) * 3 + c]; continue; }
      const ww = w[s];
      for (let c = 0; c < 3; c++) {
        let v = 0;
        for (let j = 0; j < 4; j++) v += ww[j] * src[(y * W + clamp(k - 1 + j, W)) * 3 + c];
        row[o + c] = v;
      }
    }
    // Then down each refined column.
    for (let Y = 0; Y < R; Y++) {
      const k = Math.min(W - 2, Math.floor(Y / SUB)), s = Y - k * SUB, last = Y === (W - 1) * SUB;
      const ww = w[s];
      for (let X = 0; X < R; X++) {
        const o = (Y * R + X) * 3;
        for (let c = 0; c < 3; c++) {
          if (last) { pos[o + c] = row[((W - 1) * R + X) * 3 + c]; continue; }
          let v = 0;
          for (let j = 0; j < 4; j++) v += ww[j] * row[(clamp(k - 1 + j, W) * R + X) * 3 + c];
          pos[o + c] = v;
        }
      }
    }
    // Normals and the across-the-sheet tangent from central differences.
    for (let Y = 0; Y < R; Y++) for (let X = 0; X < R; X++) {
      const i = (Y * R + X) * 3;
      const l = (Y * R + Math.max(0, X - 1)) * 3, r = (Y * R + Math.min(R - 1, X + 1)) * 3;
      const u = (Math.max(0, Y - 1) * R + X) * 3, d = (Math.min(R - 1, Y + 1) * R + X) * 3;
      const ax = pos[r] - pos[l], ay = pos[r + 1] - pos[l + 1], az = pos[r + 2] - pos[l + 2];
      const bx = pos[d] - pos[u], by = pos[d + 1] - pos[u + 1], bz = pos[d + 2] - pos[u + 2];
      // Same winding as the triangles (a, c, d): v-direction × u-direction.
      let nx = by * az - bz * ay, ny = bz * ax - bx * az, nz = bx * ay - by * ax;
      const n = Math.hypot(nx, ny, nz) || 1;
      nrm[i] = nx / n; nrm[i + 1] = ny / n; nrm[i + 2] = nz / n;
      tan[i] = ax; tan[i + 1] = ay; tan[i + 2] = az;
    }
  }
}
