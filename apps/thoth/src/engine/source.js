// THOTH's source pass: four layers drawn with Canvas2D (backdrop field, media, shape,
// text) that the halftone pass then re-draws as dots. Every motion and colour cycle runs
// a whole number of times per loop, so loops play back seamlessly.

export const MOTIONS = {still: 'Still', wave: 'Wave', orbit: 'Orbit', pulse: 'Pulse', spin: 'Spin', zoom: 'Zoom', scroll: 'Scroll'};
export const BACKDROPS = {solid: 'Solid', linear: 'Linear', radial: 'Radial', conic: 'Conic', bands: 'Bands'};
export const FILLS = {solid: 'Solid', hue: 'Hue cycle', gradient: 'Gradient', rainbow: 'Rainbow'};
export const SHAPES = {heart: 'Heart', circle: 'Circle', star: 'Star', ring: 'Ring', square: 'Square', triangle: 'Triangle'};

const TAU = Math.PI * 2;
const frac = x => x - Math.floor(x);

const PATHS = {};
function shapePath(kind) {
  if (PATHS[kind]) return PATHS[kind];
  let d;
  switch (kind) {
    case 'heart':
      d = 'M0 0.45C-0.15 0.3-0.5 0.1-0.5-0.15C-0.5-0.38-0.32-0.5-0.18-0.5C-0.07-0.5 0-0.42 0-0.32C0-0.42 0.07-0.5 0.18-0.5C0.32-0.5 0.5-0.38 0.5-0.15C0.5 0.1 0.15 0.3 0 0.45Z';
      break;
    case 'star': {
      const pts = [];
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5, r = i & 1 ? 0.21 : 0.5;
        pts.push(`${(Math.cos(a) * r).toFixed(4)} ${(Math.sin(a) * r + 0.04).toFixed(4)}`);
      }
      d = 'M' + pts.join('L') + 'Z';
      break;
    }
    case 'ring': d = 'M0.5 0A0.5 0.5 0 1 0-0.5 0A0.5 0.5 0 1 0 0.5 0ZM0.32 0A0.32 0.32 0 1 1-0.32 0A0.32 0.32 0 1 1 0.32 0Z'; break;
    case 'square': d = 'M-0.42-0.42H0.42V0.42H-0.42Z'; break;
    case 'triangle': d = 'M0-0.46L0.5 0.4H-0.5Z'; break;
    default: d = 'M0.5 0A0.5 0.5 0 1 0-0.5 0A0.5 0.5 0 1 0 0.5 0Z';
  }
  return (PATHS[kind] = new Path2D(d));
}

/** The hue in degrees at loop phase `lp` (0..1 over a loop), stepped if hueSteps > 0. */
function hueAt(cfg, base, lp) {
  let h = base + 360 * cfg.hueCycles * lp;
  if (cfg.hueSteps > 1) { const k = 360 / cfg.hueSteps; h = Math.floor(h / k) * k; }
  return ((h % 360) + 360) % 360;
}

/** A layer's transform for its motion at loop phase lp. */
function motionOf(L, lp) {
  const ph = lp * L.speed, u = ph * TAU, a = L.amount;
  const m = {dx: 0, dy: 0, scale: 1, rot: 0, ph, u};
  switch (L.motion) {
    case 'wave': m.dy = Math.sin(u) * a * 0.18; break;
    case 'orbit': m.dx = Math.cos(u) * a * 0.3; m.dy = Math.sin(u) * a * 0.3; break;
    case 'pulse': m.scale = 1 + a * 0.4 * Math.sin(u); break;
    case 'spin': m.rot = u; break;
    case 'zoom': m.scale = Math.exp(a * 2.2 * (0.5 - 0.5 * Math.cos(u))); break;
  }
  return m;
}

/** A fill style for a box (x, y, w, h). */
function fillFor(ctx, cfg, F, lp, box) {
  const [x, y, w, h] = box;
  if (F.kind === 'hue') return `hsl(${hueAt(cfg, F.hue, lp)} 100% 55%)`;
  if (F.kind === 'solid') return F.a;
  const ang = (F.angle * Math.PI) / 180 + (F.kind === 'gradient' ? lp * TAU * cfg.hueCycles : 0);
  const cx = x + w / 2, cy = y + h / 2, r = Math.hypot(w, h) / 2;
  const g = ctx.createLinearGradient(cx - Math.cos(ang) * r, cy - Math.sin(ang) * r, cx + Math.cos(ang) * r, cy + Math.sin(ang) * r);
  if (F.kind === 'gradient') { g.addColorStop(0, F.a); g.addColorStop(1, F.b); return g; }
  const h0 = hueAt(cfg, F.hue, lp);
  for (let i = 0; i <= 6; i++) g.addColorStop(i / 6, `hsl(${h0 + i * 60} 100% 55%)`);
  return g;
}

/* ---------- colour stops ---------- */
/** '#rrggbb' or 'hsl(h s% l%)' → [r, g, b] 0..255. */
function rgbOf(c) {
  let m = /^#?([\da-f]{6})$/i.exec(c);
  if (m) { const n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  m = /hsl\(\s*([-\d.]+)\s+([\d.]+)%\s+([\d.]+)%\s*\)/.exec(c);
  if (!m) return [0, 0, 0];
  const h = ((+m[1] % 360) + 360) % 360, s = m[2] / 100, l = m[3] / 100;
  const f = n => { const k = (n + h / 30) % 12; return 255 * (l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1))); };
  return [f(0), f(8), f(4)];
}
const css = ([r, g, b]) => `rgb(${Math.round(r)} ${Math.round(g)} ${Math.round(b)})`;
/** Add a run of stops [position, colour], which may reach past 0..1: the ends are clipped with interpolated colours. */
function addStops(g, list) {
  const pts = list.map(([p, c]) => [p, rgbOf(c)]).sort((a, b) => a[0] - b[0]);
  const at = p => {
    let i = 0;
    while (i < pts.length - 1 && pts[i + 1][0] < p) i++;
    const [p0, c0] = pts[i], [p1, c1] = pts[Math.min(i + 1, pts.length - 1)];
    const f = p1 > p0 ? Math.min(1, Math.max(0, (p - p0) / (p1 - p0))) : 0;
    return c0.map((v, k) => v + (c1[k] - v) * f);
  };
  g.addColorStop(0, css(at(0)));
  for (const [p, c] of pts) if (p > 0 && p < 1) g.addColorStop(p, css(c));
  g.addColorStop(1, css(at(1)));
}

function drawBackdrop(ctx, cfg, W, H, lp) {
  const B = cfg.backdrop;
  const m = motionOf(B, lp);
  const S = Math.min(W, H);
  const cols = B.hue ? [0, 1, 2].map(i => `hsl(${hueAt(cfg, i * 120, lp)} 100% 55%)`) : B.colors;
  if (B.kind === 'solid') { ctx.fillStyle = cols[0]; ctx.fillRect(0, 0, W, H); return; }
  const cx = W / 2 + m.dx * S, cy = H / 2 + m.dy * S;
  // Wave and scroll slide the stops by one whole period per cycle, so loops line up.
  const shift = B.motion === 'scroll' || B.motion === 'wave' ? frac(m.ph) : 0;
  let g;
  if (B.kind === 'linear' || B.kind === 'bands') {
    const ang = (B.angle * Math.PI) / 180 + m.rot;
    const r = Math.hypot(W, H) / 2;
    g = ctx.createLinearGradient(cx - Math.cos(ang) * r, cy - Math.sin(ang) * r, cx + Math.cos(ang) * r, cy + Math.sin(ang) * r);
    // Linear runs through the colours and back; bands repeat the first two `count` times.
    const seq = B.kind === 'bands' ? [cols[0], cols[1]] : [...cols, ...cols.slice(1, -1).reverse()];
    const n = B.kind === 'bands' ? B.count : 1;
    const list = [];
    for (let k = -1; k <= n; k++) seq.forEach((c, i) => list.push([(k + i / seq.length + shift) / n, c]));
    addStops(g, list);
  } else if (B.kind === 'radial') {
    // Rings of colour spread outward; one cycle moves them one full round of colours.
    const R = Math.hypot(W, H) * 0.6 * m.scale;
    g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
    const n = cols.length, list = [];
    for (let k = -n; k <= n * 2; k++) list.push([(k + shift * n) / (n * 2), cols[((k % n) + n) % n]]);
    addStops(g, list);
  } else {
    g = ctx.createConicGradient((B.angle * Math.PI) / 180 + m.rot + shift * TAU, cx, cy);
    cols.forEach((c, i) => g.addColorStop(i / cols.length, c));
    g.addColorStop(1, cols[0]);
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

function withMotion(ctx, m, S, cx, cy, fn) {
  ctx.save();
  ctx.translate(cx + m.dx * S, cy + m.dy * S);
  ctx.rotate(m.rot);
  ctx.scale(m.scale, m.scale);
  fn();
  ctx.restore();
}

function drawMedia(ctx, cfg, W, H, lp, media) {
  const L = cfg.media;
  const el = media.el;
  const iw = media.w, ih = media.h;
  const k = (L.fit === 'cover' ? Math.max(W / iw, H / ih) : Math.min(W / iw, H / ih)) * L.scale;
  const m = motionOf(L, lp);
  ctx.save();
  ctx.filter = `contrast(${L.contrast}) brightness(${L.brightness})`;
  withMotion(ctx, m, Math.min(W, H), W / 2, H / 2, () => {
    if (media.mirror) ctx.scale(-1, 1);
    ctx.drawImage(el, (-iw * k) / 2, (-ih * k) / 2, iw * k, ih * k);
  });
  ctx.restore();
}

function drawShape(ctx, cfg, W, H, lp) {
  const L = cfg.shape;
  const S = Math.min(W, H);
  const m = motionOf(L, lp);
  const size = L.size * S;
  const path = shapePath(L.kind);
  const ringR = L.count > 1 ? S * 0.28 : 0;
  ctx.fillStyle = fillFor(ctx, cfg, L.fill, lp, [W / 2 - size / 2 - ringR, H / 2 - size / 2 - ringR, size + 2 * ringR, size + 2 * ringR]);
  withMotion(ctx, {...m, rot: L.count > 1 ? m.rot : 0}, S, W / 2, H / 2, () => {
    for (let i = 0; i < L.count; i++) {
      const a = (i / L.count) * TAU - Math.PI / 2;
      ctx.save();
      ctx.translate(Math.cos(a) * ringR, Math.sin(a) * ringR);
      if (L.count === 1) ctx.rotate(m.rot);
      ctx.scale(size, size);
      ctx.fill(path, 'evenodd');
      ctx.restore();
    }
  });
}

const FONT = 'montserrat, system-ui, sans-serif';
function drawText(ctx, cfg, W, H, lp) {
  const L = cfg.text;
  const lines = String(L.text || '').split('\n').filter(s => s.length);
  if (!lines.length) return;
  const S = Math.min(W, H);
  const px = L.size * S;
  const m = motionOf(L, lp);
  ctx.save();
  ctx.font = `${L.weight} ${px}px ${FONT}`;
  ctx.letterSpacing = `${(L.tracking * px).toFixed(2)}px`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const lh = px * L.leading;
  const widths = lines.map(s => ctx.measureText(s).width);
  const bw = Math.max(...widths), bh = lh * lines.length;
  ctx.fillStyle = fillFor(ctx, cfg, L.fill, lp, [W / 2 - bw / 2, H / 2 - bh / 2, bw, bh]);
  const y0 = H / 2 - bh / 2 + lh / 2;
  if (L.motion === 'scroll') {
    // A marquee per line, alternating directions; one period is the line plus a gap.
    lines.forEach((s, i) => {
      const per = widths[i] + px * 0.6;
      const dir = i & 1 ? -1 : 1;
      const off = frac(m.ph) * per * dir;
      for (let x = W / 2 - Math.ceil(W / per + 1) * per; x < W + per; x += per) ctx.fillText(s, x + off, y0 + i * lh);
    });
  } else if (L.motion === 'wave') {
    // Letters ride a travelling wave.
    lines.forEach((s, i) => {
      const chars = [...s];
      let x = W / 2 - widths[i] / 2;
      ctx.textAlign = 'left';
      chars.forEach((ch, j) => {
        const cw = ctx.measureText(ch).width;
        ctx.fillText(ch, x, y0 + i * lh + Math.sin(m.u - j * 0.55 - i * 0.9) * L.amount * px * 0.45);
        x += cw + L.tracking * px;
      });
    });
  } else {
    withMotion(ctx, m, S, W / 2, H / 2, () => {
      lines.forEach((s, i) => ctx.fillText(s, 0, y0 + i * lh - H / 2));
    });
  }
  ctx.restore();
}

/** Draw the source at time t (seconds) into a W × H 2D context. `media` is {el, w, h, mirror} or null. */
export function drawSource(ctx, cfg, W, H, t, media) {
  const lp = frac(t / cfg.loop);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.filter = 'none';
  drawBackdrop(ctx, cfg, W, H, lp);
  if (cfg.media.on && media) drawMedia(ctx, cfg, W, H, lp, media);
  if (cfg.shape.on) drawShape(ctx, cfg, W, H, lp);
  if (cfg.text.on) drawText(ctx, cfg, W, H, lp);
  ctx.restore();
}
