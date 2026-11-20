// JJARO's cloth: a square sheet of particles moved by Verlet integration and held
// together by distance constraints (structural, shear and bend), after Jakobsen,
// "Advanced Character Physics" (2001). Framework-free, so the Node checks can run it.

export const STEP = 1 / 120; // fixed simulation step, seconds
const SIZE = 2; // the sheet's width and height, in scene units
const ITERATIONS = 10;
const MAX_STEPS = 4; // per frame, so one slow frame can't snowball
const DAMPING = 0.004; // velocity lost per step
const GUST_SECONDS = 1.4;

export const SETUPS = [
  {id: 'corners', name: 'Hung by two corners'},
  {id: 'edge', name: 'Hung along one edge'},
  {id: 'drape', name: 'Draped over a ball'},
  {id: 'heap', name: 'Dropped in a heap'},
  {id: 'float', name: 'Floating'},
];
export const SETUP_IDS = SETUPS.map(s => s.id);
/** Particles along each side, by quality. */
export const QUALITY = {low: 28, medium: 38, high: 48};

/** Seeded random numbers in 0..1 (mulberry32). */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * What each setup puts in the scene: a floor height, a ball, where the camera looks,
 * how much of the scene it frames (half-height) and how far it looks down (degrees).
 */
function sceneFor(setup) {
  switch (setup) {
    case 'drape': return {floor: -0.8, ball: {c: [0, -0.25, 0], r: 0.55}, target: [0, -0.3, 0], half: 1.3, lift: 8, gravity: 1, selfHit: true};
    case 'heap': return {floor: -0.8, ball: null, target: [0, -0.7, 0], half: 0.8, lift: 24, gravity: 1, selfHit: true};
    case 'float': return {floor: null, ball: null, target: [0, 0, 0], half: 1.45, lift: 0, gravity: 0, selfHit: false};
    default: return {floor: null, ball: null, target: [0, 0, 0], half: 1.45, lift: 0, gravity: 1, selfHit: false};
  }
}

export class Cloth {
  /** setup: one of SETUP_IDS; res: particles per side; seed: shapes the start and the wind. */
  constructor({setup = 'corners', res = QUALITY.medium, seed = 1} = {}) {
    const W = Math.max(4, Math.round(res)), N = W * W, h = SIZE / (W - 1);
    Object.assign(this, {setup, W, N, h, seed, time: 0, acc: 0, gustAt: -1e9, grab: null});
    this.scene = sceneFor(setup);
    // bend: 0..1, how much a fold springs back over one step (not per iteration)
    this.params = {gravity: 1, bend: 0.3, wind: 0};
    this.pos = new Float32Array(N * 3);
    this.prev = new Float32Array(N * 3);
    this.nrm = new Float32Array(N * 3);
    this.inv = new Float32Array(N).fill(1); // inverse mass: 0 = pinned
    this.contact = new Uint8Array(N);
    this.uv = new Float32Array(N * 2);
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      this.uv[i * 2] = x / (W - 1); this.uv[i * 2 + 1] = y / (W - 1);
    }
    this.#constraints();
    this.#triangles();
    this.#place(rng(seed));
    this.#tethers();
    this.prev.set(this.pos);
    this.normals();
  }

  #constraints() {
    const {W, h} = this, ab = [], len = [], kind = [];
    const add = (a, b, d, k) => { ab.push(a, b); len.push(d); kind.push(k); };
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (x + 1 < W) add(i, i + 1, h, 0);
      if (y + 1 < W) add(i, i + W, h, 0);
      if (x + 1 < W && y + 1 < W) { add(i, i + W + 1, h * Math.SQRT2, 1); add(i + 1, i + W, h * Math.SQRT2, 1); }
      if (x + 2 < W) add(i, i + 2, 2 * h, 2);
      if (y + 2 < W) add(i, i + 2 * W, 2 * h, 2);
    }
    this.cab = Int32Array.from(ab);
    this.clen = Float32Array.from(len);
    this.ckind = Uint8Array.from(kind);
  }

  #triangles() {
    const {W} = this, idx = [];
    for (let y = 0; y + 1 < W; y++) for (let x = 0; x + 1 < W; x++) {
      const a = y * W + x, b = a + 1, c = a + W, d = c + 1;
      // Alternate the diagonal so the mesh has no grain in one direction.
      if ((x + y) & 1) idx.push(a, c, b, b, c, d); else idx.push(a, c, d, a, d, b);
    }
    this.index = Uint32Array.from(idx);
  }

  /** Starting positions and pins for the setup. */
  #place(R) {
    const {W, pos, inv, setup} = this;
    const phase = R() * Math.PI * 2, spin = R() * Math.PI * 2;
    const put = (i, x, y, z) => { pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z; };
    for (let gy = 0; gy < W; gy++) for (let gx = 0; gx < W; gx++) {
      const i = gy * W + gx, u = gx / (W - 1), v = gy / (W - 1);
      const jitter = (R() - 0.5) * 2e-3;
      if (setup === 'corners') {
        put(i, (u * 2 - 1) * 0.8, 1 - v * 2, 0.04 * Math.sin(u * Math.PI * 2 + phase) + jitter);
      } else if (setup === 'edge') {
        // The top row is gathered into soft pleats; everything below starts straight down.
        put(i, (u * 2 - 1) * 0.72, 1 - v * 2, 0.11 * Math.sin(u * Math.PI * 5 + phase) + jitter);
      } else if (setup === 'drape') {
        const x = u * 2 - 1, z = v * 2 - 1, c = Math.cos(spin * 0.25), s = Math.sin(spin * 0.25);
        put(i, x * c - z * s + 0.08, 0.6 + jitter, x * s + z * c - 0.05);
      } else if (setup === 'heap') {
        // Held up by its centre like a handkerchief: a narrow cone, crowded around its
        // circumference, so it buckles into folds as it falls.
        const dx = u * 2 - 1, dz = v * 2 - 1, r = Math.hypot(dx, dz);
        let a = Math.atan2(dz, dx) + spin;
        a += 0.35 * Math.sin(3 * a + phase);
        const s = 0.28 + 0.06 * Math.sin(2 * a + phase * 2);
        put(i, Math.cos(a) * r * s, 0.65 - r * Math.sqrt(1 - s * s), Math.sin(a) * r * s);
      } else { // float
        const x = u * 2 - 1, y = 1 - v * 2;
        put(i, x, y, 0.25 * Math.sin(x * 1.7 + phase) * Math.cos(y * 1.3) + jitter);
      }
    }
    if (setup === 'corners') { inv[0] = 0; inv[W - 1] = 0; }
    if (setup === 'edge') for (let x = 0; x < W; x++) inv[x] = 0;
  }

  /** Steady wind toward the camera plus slow turbulence, at a point and time (accel). */
  #wind(x, y, z, t, out) {
    const k = this.params.wind;
    if (k <= 0) { out[0] = out[1] = out[2] = 0; return; }
    const g = 1 + 2 * Math.max(0, 1 - (t - this.gustAt) / GUST_SECONDS);
    const s = this.seed * 0.001;
    const base = 5 * k * g * (0.75 + 0.25 * Math.sin(t * 0.7 + s));
    out[0] = base * 0.25 + 2.2 * k * Math.sin(y * 1.9 + t * 1.3 + s) * Math.cos(z * 1.1 - t * 0.5);
    out[1] = 1.1 * k * Math.sin(x * 2.3 - t * 1.1 + s * 2);
    out[2] = base + 2.2 * k * Math.sin(x * 1.7 + y * 0.9 - t * 1.6 + s * 3);
  }

  /** Run the simulation forward by a frame's worth of real time. */
  advance(dt) {
    this.acc = Math.min(this.acc + dt, MAX_STEPS * STEP);
    this.normals(); // the wind reads them
    while (this.acc >= STEP) { this.step(); this.acc -= STEP; }
  }

  step() {
    const {N, pos, prev, nrm, inv, scene, params} = this;
    const dt2 = STEP * STEP, gy = -9.8 * params.gravity * scene.gravity;
    const w = [0, 0, 0];
    // Floating cloth is pulled gently back to the middle so it stays in view.
    let cx = 0, cy = 0, cz = 0;
    if (setupFloats(this)) {
      for (let i = 0; i < N; i++) { cx += pos[i * 3]; cy += pos[i * 3 + 1]; cz += pos[i * 3 + 2]; }
      cx /= N; cy /= N; cz /= N;
    }
    for (let i = 0; i < N; i++) {
      if (inv[i] === 0) continue;
      const j = i * 3;
      const vx = (pos[j] - prev[j]) * (1 - DAMPING), vy = (pos[j + 1] - prev[j + 1]) * (1 - DAMPING), vz = (pos[j + 2] - prev[j + 2]) * (1 - DAMPING);
      let ax = 0, ay = gy, az = 0;
      this.#wind(pos[j], pos[j + 1], pos[j + 2], this.time, w);
      // Air pushes along the surface normal, in proportion to how square-on it meets it.
      const rx = w[0] - vx / STEP, ry = w[1] - vy / STEP, rz = w[2] - vz / STEP;
      const f = 0.9 * (rx * nrm[j] + ry * nrm[j + 1] + rz * nrm[j + 2]);
      ax += f * nrm[j] + 0.04 * rx; ay += f * nrm[j + 1] + 0.04 * ry; az += f * nrm[j + 2] + 0.04 * rz;
      if (setupFloats(this)) { ax -= 0.8 * cx; ay -= 0.8 * cy; az -= 0.8 * cz; }
      prev[j] = pos[j]; prev[j + 1] = pos[j + 1]; prev[j + 2] = pos[j + 2];
      pos[j] += vx + ax * dt2; pos[j + 1] += vy + ay * dt2; pos[j + 2] += vz + az * dt2;
    }
    this.contact.fill(0);
    if (scene.selfHit) this.#repel();
    for (let it = 0; it < ITERATIONS; it++) {
      this.#solve();
      this.#tether();
      this.#applyGrab();
      this.#collide();
    }
    this.#friction();
    this.time += STEP;
  }

  #solve() {
    const {pos, inv, cab, clen, ckind} = this;
    // Stiffness compounds over the iterations, so set it per iteration from the per-step amount.
    const perIt = k => 1 - Math.pow(1 - Math.min(0.999, k), 1 / ITERATIONS);
    const kBend = perIt(this.params.bend * 0.25), kShear = perIt(0.6);
    const n = clen.length;
    for (let c = 0; c < n; c++) {
      const a = cab[c * 2], b = cab[c * 2 + 1];
      const wa = inv[a], wb = inv[b], ws = wa + wb;
      if (ws === 0) continue;
      const ia = a * 3, ib = b * 3;
      const dx = pos[ib] - pos[ia], dy = pos[ib + 1] - pos[ia + 1], dz = pos[ib + 2] - pos[ia + 2];
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d < 1e-9) continue;
      const k = ckind[c] === 2 ? kBend : ckind[c] === 1 ? kShear : 1;
      const s = k * (d - clen[c]) / (d * ws);
      pos[ia] += dx * s * wa; pos[ia + 1] += dy * s * wa; pos[ia + 2] += dz * s * wa;
      pos[ib] -= dx * s * wb; pos[ib + 1] -= dy * s * wb; pos[ib + 2] -= dz * s * wb;
    }
  }

  /**
   * Long-range attachments (Kim, Chentanez and Müller, 2012): each particle is tied to
   * its two nearest pins by a one-sided limit, its distance from them on the flat sheet.
   * Hanging cloth then can't sag out of shape however few iterations run.
   */
  #tethers() {
    const {N, W, inv, h} = this;
    const pins = [];
    for (let i = 0; i < N; i++) if (inv[i] === 0) pins.push(i);
    this.tie = new Int32Array(N * 2).fill(-1);
    this.tieLen = new Float32Array(N * 2);
    this.tied = pins.length > 0;
    if (!this.tied) return;
    for (let i = 0; i < N; i++) {
      if (inv[i] === 0) continue;
      const xi = i % W, yi = (i / W) | 0;
      let b0 = -1, d0 = Infinity, b1 = -1, d1 = Infinity;
      for (const p of pins) {
        const d = Math.hypot((p % W) - xi, ((p / W) | 0) - yi) * h;
        if (d < d0) { b1 = b0; d1 = d0; b0 = p; d0 = d; } else if (d < d1) { b1 = p; d1 = d; }
      }
      this.tie[i * 2] = b0; this.tieLen[i * 2] = d0;
      this.tie[i * 2 + 1] = b1; this.tieLen[i * 2 + 1] = d1;
    }
  }

  #tether() {
    const {N, pos, inv, tie, tieLen} = this;
    if (!this.tied) return;
    for (let i = 0; i < N; i++) {
      if (inv[i] === 0) continue;
      const j = i * 3;
      for (let k = 0; k < 2; k++) {
        const p = tie[i * 2 + k];
        if (p < 0) continue;
        const q = p * 3, L = tieLen[i * 2 + k];
        const dx = pos[j] - pos[q], dy = pos[j + 1] - pos[q + 1], dz = pos[j + 2] - pos[q + 2];
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d <= L) continue;
        const s = L / d;
        pos[j] = pos[q] + dx * s; pos[j + 1] = pos[q + 1] + dy * s; pos[j + 2] = pos[q + 2] + dz * s;
      }
    }
  }

  #collide() {
    const {N, pos, inv, contact, scene} = this;
    const pad = this.h * 0.35;
    const {floor, ball} = scene;
    if (floor === null && !ball) return;
    for (let i = 0; i < N; i++) {
      if (inv[i] === 0) continue;
      const j = i * 3;
      if (ball) {
        const dx = pos[j] - ball.c[0], dy = pos[j + 1] - ball.c[1], dz = pos[j + 2] - ball.c[2];
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz), r = ball.r + pad;
        if (d < r && d > 1e-9) {
          const s = r / d;
          pos[j] = ball.c[0] + dx * s; pos[j + 1] = ball.c[1] + dy * s; pos[j + 2] = ball.c[2] + dz * s;
          contact[i] = 2;
          this.#grip(j, dx / d, dy / d, dz / d);
        }
      }
      if (floor !== null && pos[j + 1] < floor + pad) { pos[j + 1] = floor + pad; contact[i] = 1; this.#grip(j, 0, 1, 0); }
    }
  }

  /** Friction while touching: undo part of this step's sliding along the surface. */
  #grip(j, nx, ny, nz) {
    const {pos, prev} = this, g = 0.35;
    const dx = pos[j] - prev[j], dy = pos[j + 1] - prev[j + 1], dz = pos[j + 2] - prev[j + 2];
    const dn = dx * nx + dy * ny + dz * nz;
    pos[j] -= (dx - dn * nx) * g; pos[j + 1] -= (dy - dn * ny) * g; pos[j + 2] -= (dz - dn * nz) * g;
  }

  /** Things the cloth touches hold on to it: kill most sliding, and all bounce. */
  #friction() {
    const {N, pos, prev, contact, scene} = this;
    for (let i = 0; i < N; i++) {
      if (!contact[i]) continue;
      const j = i * 3;
      let nx = 0, ny = 1, nz = 0;
      if (contact[i] === 2) {
        const c = scene.ball.c;
        nx = pos[j] - c[0]; ny = pos[j + 1] - c[1]; nz = pos[j + 2] - c[2];
        const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
      }
      const vx = pos[j] - prev[j], vy = pos[j + 1] - prev[j + 1], vz = pos[j + 2] - prev[j + 2];
      const vn = vx * nx + vy * ny + vz * nz;
      const keep = 0.15; // of the sliding speed
      const tx = (vx - vn * nx) * keep, ty = (vy - vn * ny) * keep, tz = (vz - vn * nz) * keep;
      const out = Math.max(0, vn);
      prev[j] = pos[j] - tx - out * nx; prev[j + 1] = pos[j + 1] - ty - out * ny; prev[j + 2] = pos[j + 2] - tz - out * nz;
    }
  }

  /**
   * Keep folds from passing through each other: particles closer than a minimum
   * distance push apart unless they're near neighbours on the sheet. A spatial hash
   * keeps it about linear in the number of particles.
   */
  #repel() {
    const {N, W, pos, inv} = this;
    const r = this.h * 0.75, r2 = r * r, cell = r;
    const T = this.hashSize ||= 1 << Math.ceil(Math.log2(N * 2));
    const head = this.hashHead ||= new Int32Array(T);
    const next = this.hashNext ||= new Int32Array(N);
    head.fill(-1);
    const key = (x, y, z) => ((Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)) >>> 0) & (T - 1);
    for (let i = 0; i < N; i++) {
      const k = key(Math.floor(pos[i * 3] / cell), Math.floor(pos[i * 3 + 1] / cell), Math.floor(pos[i * 3 + 2] / cell));
      next[i] = head[k]; head[k] = i;
    }
    for (let i = 0; i < N; i++) {
      const ia = i * 3, xi = i % W, yi = (i / W) | 0;
      const cx = Math.floor(pos[ia] / cell), cy = Math.floor(pos[ia + 1] / cell), cz = Math.floor(pos[ia + 2] / cell);
      for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) for (let oz = -1; oz <= 1; oz++) {
        for (let j = head[key(cx + ox, cy + oy, cz + oz)]; j !== -1; j = next[j]) {
          if (j <= i) continue;
          const xj = j % W, yj = (j / W) | 0;
          if (Math.abs(xi - xj) <= 2 && Math.abs(yi - yj) <= 2) continue;
          const ib = j * 3;
          const dx = pos[ib] - pos[ia], dy = pos[ib + 1] - pos[ia + 1], dz = pos[ib + 2] - pos[ia + 2];
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 >= r2 || d2 < 1e-12) continue;
          const wa = inv[i], wb = inv[j], ws = wa + wb;
          if (ws === 0) continue;
          const d = Math.sqrt(d2), s = (d - r) / (d * ws) * 0.5;
          pos[ia] += dx * s * wa; pos[ia + 1] += dy * s * wa; pos[ia + 2] += dz * s * wa;
          pos[ib] -= dx * s * wb; pos[ib + 1] -= dy * s * wb; pos[ib + 2] -= dz * s * wb;
        }
      }
    }
  }

  /* ---------- grabbing ---------- */

  /**
   * Take hold of particle i. Nearby particles follow with a soft falloff, keeping
   * their offsets from it, so a drag pulls a patch of cloth rather than a spike.
   */
  grabStart(i, target) {
    const {W, pos} = this;
    const R = Math.max(2, Math.round(0.16 / this.h));
    const xi = i % W, yi = (i / W) | 0, held = [];
    for (let y = Math.max(0, yi - R); y <= Math.min(W - 1, yi + R); y++) for (let x = Math.max(0, xi - R); x <= Math.min(W - 1, xi + R); x++) {
      const d = Math.hypot(x - xi, y - yi) / R;
      if (d >= 1) continue;
      const j = y * W + x;
      held.push({j, w: j === i ? 1 : 0.6 * (1 - d) * (1 - d), off: [pos[j * 3] - pos[i * 3], pos[j * 3 + 1] - pos[i * 3 + 1], pos[j * 3 + 2] - pos[i * 3 + 2]]});
    }
    this.grab = {i, held, target: target.slice()};
  }
  grabMove(target) { if (this.grab) this.grab.target = target.slice(); }
  grabEnd() { this.grab = null; }

  #applyGrab() {
    const g = this.grab;
    if (!g) return;
    const {pos, inv} = this, t = g.target;
    for (const {j, w, off} of g.held) {
      // A pin moves only when it's the particle held, and then it stays where it's dropped.
      if (inv[j] === 0 && j !== g.i) continue;
      const k = j * 3;
      pos[k] += (t[0] + off[0] - pos[k]) * w;
      pos[k + 1] += (t[1] + off[1] - pos[k + 1]) * w;
      pos[k + 2] += (t[2] + off[2] - pos[k + 2]) * w;
      if (inv[j] === 0) { this.prev[k] = pos[k]; this.prev[k + 1] = pos[k + 1]; this.prev[k + 2] = pos[k + 2]; }
    }
  }

  /** A short burst of stronger wind. */
  gust() { this.gustAt = this.time; }

  /* ---------- for drawing and checks ---------- */

  /** Per-particle normals, area-weighted from the triangles. */
  normals() {
    const {pos, nrm, index} = this;
    nrm.fill(0);
    for (let t = 0; t < index.length; t += 3) {
      const a = index[t] * 3, b = index[t + 1] * 3, c = index[t + 2] * 3;
      const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
      const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      for (const p of [a, b, c]) { nrm[p] += nx; nrm[p + 1] += ny; nrm[p + 2] += nz; }
    }
    for (let p = 0; p < nrm.length; p += 3) {
      const l = Math.hypot(nrm[p], nrm[p + 1], nrm[p + 2]) || 1;
      nrm[p] /= l; nrm[p + 1] /= l; nrm[p + 2] /= l;
    }
  }


  /** Mean particle speed, scene units per second: near 0 once settled. */
  speed() {
    const {N, pos, prev} = this;
    let s = 0;
    for (let j = 0; j < N * 3; j += 3) s += Math.hypot(pos[j] - prev[j], pos[j + 1] - prev[j + 1], pos[j + 2] - prev[j + 2]);
    return s / N / STEP;
  }

  /** Largest stretch of any structural constraint, as a ratio of its rest length. */
  maxStretch() {
    const {pos, cab, clen, ckind} = this;
    let m = 0;
    for (let c = 0; c < clen.length; c++) {
      if (ckind[c] !== 0) continue;
      const a = cab[c * 2] * 3, b = cab[c * 2 + 1] * 3;
      m = Math.max(m, Math.hypot(pos[b] - pos[a], pos[b + 1] - pos[a + 1], pos[b + 2] - pos[a + 2]) / clen[c]);
    }
    return m;
  }
}

const setupFloats = c => c.setup === 'float';
