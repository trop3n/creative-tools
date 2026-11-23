// Ribbons: a built-in moving source. A few thick bands wander across the frame, curl and
// cross over each other, painted in patches of the palette's colours on black. Every
// motion turns a whole number of times per loop, so a video of one loop repeats with no
// seam. Framework-free: it only needs a 2D canvas context.

const TAU = Math.PI * 2;

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

/** Each ribbon's path shape, from the seed: frequencies, phases and whole-number turns per loop. */
function shapesFor(count, seed) {
  const R = rng(seed * 2654435761 + 1), turn = () => (R() < 0.5 ? -1 : 1) * (1 + Math.floor(R() * 2));
  return Array.from({length: count}, (_, i) => ({
    lane: count > 1 ? i / (count - 1) - 0.5 : 0, // where it sits in the band, -0.5..0.5
    fx: 0.8 + R() * 1.2, px: R() * TAU, mx: turn(), // the sideways swing that makes curls
    fy: 0.5 + R() * 0.9, py: R() * TAU, my: turn(), // the main wave
    fz: 1.3 + R() * 1.4, pz: R() * TAU, mz: turn(), // a faster ripple on top
    patch: R() * 8, // where its colour patches start
  }));
}

/**
 * Points along ribbon `r` at loop phase `phase` (0..1), in 0..1 frame units: x across,
 * y down. Wander 0..1 widens the curls and the swing.
 */
export function ribbonPath(r, phase, wander, n = 160) {
  const a = phase * TAU, pts = new Float32Array(n * 2);
  for (let k = 0; k < n; k++) {
    const s = k / (n - 1);
    const x = -0.12 + 1.24 * s + wander * 0.16 * Math.sin(TAU * r.fx * s + r.px + r.mx * a);
    const y = 0.5 + r.lane * 0.36 * (0.4 + 0.6 * Math.cos(r.py + r.my * a))
      + 0.2 * (0.35 + 0.65 * wander) * Math.sin(TAU * r.fy * s + r.py + r.my * a)
      + 0.06 * wander * Math.sin(TAU * r.fz * s + r.pz + r.mz * a);
    pts[k * 2] = x; pts[k * 2 + 1] = y;
  }
  return pts;
}

/**
 * Draw the ribbons into ctx (W × H) at time t seconds. p: {count, width (of the frame's
 * height), wander 0..1, patches (colour patches along each ribbon), loop (seconds), seed,
 * palette (hex colours), background}. Colour patches drift along the ribbons by a whole
 * palette's worth each loop, so the colours come round too.
 */
export function drawRibbons(ctx, W, H, t, p) {
  const phase = ((t / p.loop) % 1 + 1) % 1, pal = p.palette.length ? p.palette : ['#ffffff'], n = pal.length;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = p.background || '#000';
  ctx.fillRect(0, 0, W, H);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(1, p.width * H);
  for (const r of shapesFor(p.count, p.seed)) {
    const pts = ribbonPath(r, phase, p.wander), m = pts.length / 2;
    const colourAt = s => pal[(((Math.floor(s * p.patches + r.patch + phase * n)) % n) + n) % n];
    let k = 0;
    while (k < m - 1) {
      // One stroke per run of segments that share a colour.
      const c = colourAt((k + 0.5) / (m - 1));
      ctx.beginPath(); ctx.moveTo(pts[k * 2] * W, pts[k * 2 + 1] * H);
      let j = k;
      while (j < m - 1 && colourAt((j + 0.5) / (m - 1)) === c) { j++; ctx.lineTo(pts[j * 2] * W, pts[j * 2 + 1] * H); }
      ctx.strokeStyle = c; ctx.stroke();
      k = j;
    }
  }
}
