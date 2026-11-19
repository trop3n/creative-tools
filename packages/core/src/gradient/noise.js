// The noise behind LEELA's motion, in JavaScript. The shader (shader.js) runs the
// same steps on the GPU; this copy exists so the loop math can be tested in Node.
//
// gradientNoise: 3-D gradient (Perlin-style) noise. A hash gives each lattice
// corner a random direction; a pixel blends the corners' dot products with a
// quintic fade. The third axis is time, so moving along it makes the field drift.
//
// evolvingNoise: the field over time, optionally as a seamless loop. For a loop of
// `period` seconds it crossfades between the field at phase·travel and at
// (phase − 1)·travel. At phase 0 that is all of the first; at phase 1 all of the
// second, which is the same field again, so the last frame meets the first. Mixing
// two partly different fields lowers the contrast mid-fade; dividing by the mix's
// expected spread keeps it steady.

const u32 = v => v >>> 0;

/** PCG-style 3-D hash (Jarzynski & Olano 2020) on unsigned 32-bit ints. */
export function hash3(x, y, z) {
  x = u32(Math.imul(x, 1664525) + 1013904223); y = u32(Math.imul(y, 1664525) + 1013904223); z = u32(Math.imul(z, 1664525) + 1013904223);
  x = u32(x + Math.imul(y, z)); y = u32(y + Math.imul(z, x)); z = u32(z + Math.imul(x, y));
  x ^= x >>> 16; y ^= y >>> 16; z ^= z >>> 16;
  x = u32(x + Math.imul(y, z)); y = u32(y + Math.imul(z, x)); z = u32(z + Math.imul(x, y));
  return [x, y, z];
}

function gradient(ix, iy, iz, seed) {
  const [a, b, c] = hash3(ix + seed, iy, iz);
  const g = [(a & 1023) / 511.5 - 1, (b & 1023) / 511.5 - 1, (c & 1023) / 511.5 - 1];
  const l = Math.hypot(g[0], g[1], g[2]) || 1;
  return [g[0] / l, g[1] / l, g[2] / l];
}

const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a, b, t) => a + (b - a) * t;

/** Amplitude so the field's spread (standard deviation) is about 0.5. */
export const NOISE_GAIN = 2.6; // measured: raw spread 0.19

// Noise is sampled in a turned frame (a fixed rotation about the (1, 1, 1) axis),
// so time never runs along the lattice: along a lattice axis the contrast would rise
// and fall once per unit (it is lower on lattice planes), a visible pulse.
export const TURN = [2 / 3, -1 / 3, 2 / 3, 2 / 3, 2 / 3, -1 / 3, -1 / 3, 2 / 3, 2 / 3];

export function gradientNoise(px, py, pz, seed = 0) {
  const T = TURN;
  const x = T[0] * px + T[1] * py + T[2] * pz, y = T[3] * px + T[4] * py + T[5] * pz, z = T[6] * px + T[7] * py + T[8] * pz;
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const dot = (dx, dy, dz) => { const g = gradient(ix + dx, iy + dy, iz + dz, seed); return g[0] * (fx - dx) + g[1] * (fy - dy) + g[2] * (fz - dz); };
  const u = fade(fx), v = fade(fy), w = fade(fz);
  return NOISE_GAIN * lerp(
    lerp(lerp(dot(0, 0, 0), dot(1, 0, 0), u), lerp(dot(0, 1, 0), dot(1, 1, 0), u), v),
    lerp(lerp(dot(0, 0, 1), dot(1, 0, 1), u), lerp(dot(0, 1, 1), dot(1, 1, 1), u), v),
    w,
  );
}

/** How alike the field is at two times `dz` apart along z (fitted; see the tests). */
export const correlation = dz => Math.exp(-CORR_K * dz * dz);
export const CORR_K = 3.4; // measured: fits exp(-k·dz²) for dz up to 0.5, where it matters

/** Contrast correction for a crossfade at `blend` between fields `travel` apart. */
export function loopLevel(blend, travel) {
  const rho = correlation(travel);
  return 1 / Math.sqrt(Math.max(1e-4, 1 - 2 * blend * (1 - blend) * (1 - rho)));
}

const smoothstep = t => t * t * (3 - 2 * t);

/**
 * The noise at (x, y) and time t (seconds). `rate` is z-distance per second. With
 * period > 0 the result repeats every `period` seconds exactly.
 */
export function evolvingNoise(x, y, z0, t, rate, period = 0, seed = 0) {
  if (!(period > 0)) return gradientNoise(x, y, z0 + t * rate, seed);
  const phase = ((t % period) + period) % period / period;
  const travel = period * rate;
  const a = gradientNoise(x, y, z0 + phase * travel, seed);
  const b = gradientNoise(x, y, z0 + (phase - 1) * travel, seed);
  const blend = smoothstep(phase);
  return lerp(a, b, blend) * loopLevel(blend, travel);
}
