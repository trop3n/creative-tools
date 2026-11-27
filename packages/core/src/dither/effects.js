// Effects: a stack of glitch, light and texture passes run on the dithered picture
// after it is painted (RGBA, in place), in the order listed. Sizes are in cells, so
// the one-pixel-per-cell preview and a full-size export look alike: `k` is the number
// of output pixels per cell. Glitch effects take a seed; "Moving" adds the frame
// number to it so video and webcam frames each glitch differently.
//
// An effect in a stack is a plain object: {id, on, ...its params}.

const MAX_STACK = 12;

/* ---------- helpers ---------- */
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
const luma = (px, i) => (px[i] * 54 + px[i + 1] * 183 + px[i + 2] * 19) >> 8;
const seedOf = (p, ctx) => (p.seed | 0) * 7919 + (p.moving ? (ctx.frame | 0) * 104729 : 0);
const cellPx = (cells, k) => Math.max(1, Math.round(cells * k));
const hexRGB = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) || 0);

/** Three-pass box blur of one channel (about Gaussian), edges clamped. */
function blur3(buf, w, h, r) {
  const tmp = new Float32Array(buf.length);
  const pass = (src, dst, n, len, stride, step) => {
    // n lines of `len` samples; sample j of line i is at i*stride + j*step.
    const d = 2 * r + 1;
    for (let i = 0; i < n; i++) {
      const o = i * stride;
      let s = 0;
      for (let j = -r; j <= r; j++) s += src[o + Math.min(len - 1, Math.max(0, j)) * step];
      for (let j = 0; j < len; j++) {
        dst[o + j * step] = s / d;
        s += src[o + Math.min(len - 1, j + r + 1) * step] - src[o + Math.max(0, j - r) * step];
      }
    }
  };
  for (let p = 0; p < 3; p++) { pass(buf, tmp, h, w, w, 1); pass(tmp, buf, w, h, 1, w); }
}

/** Shift each line (row or column) by off(line) pixels, wrapping. */
function shiftLines(px, W, H, columns, off) {
  const src = px.slice();
  const n = columns ? W : H, len = columns ? H : W;
  for (let l = 0; l < n; l++) {
    const d = off(l) | 0;
    if (!d) continue;
    for (let j = 0; j < len; j++) {
      const from = (((j - d) % len) + len) % len;
      const a = columns ? (from * W + l) * 4 : (l * W + from) * 4, b = columns ? (j * W + l) * 4 : (l * W + j) * 4;
      px[b] = src[a]; px[b + 1] = src[a + 1]; px[b + 2] = src[a + 2];
    }
  }
}

/* ---------- the effects ---------- */
const seed = {key: 'seed', label: 'Seed', min: 1, max: 999, step: 1, default: 1};
const moving = {key: 'moving', label: 'Moving (video and webcam)', type: 'toggle', default: true};
const direction = {key: 'direction', label: 'Direction', type: 'choice', default: 'rows', options: [{value: 'rows', label: 'Across'}, {value: 'columns', label: 'Down'}]};

export const EFFECTS = [
  {
    id: 'blocks', name: 'Block glitch', family: 'Glitch',
    hint: 'Broken-file blocks: smeared, flattened and color-shifted squares, and torn rows.',
    params: [
      {key: 'amount', label: 'Amount', min: 0, max: 100, step: 1, default: 25, unit: '%'},
      {key: 'block', label: 'Block size', min: 2, max: 32, step: 1, default: 8, unit: ' cells'},
      seed, moving,
    ],
    apply(px, W, H, p, ctx) {
      const R = rng(seedOf(p, ctx)), B = cellPx(p.block, ctx.k), src = px.slice(), a = p.amount / 100;
      const bw = Math.ceil(W / B), bh = Math.ceil(H / B);
      const copy = (fx, fy, tx, ty, ch) => { // one pixel, channels ch (bit mask r=1 g=2 b=4)
        if (fx < 0 || fy < 0 || fx >= W || fy >= H) return;
        const s = (fy * W + fx) * 4, t = (ty * W + tx) * 4;
        if (ch & 1) px[t] = src[s]; if (ch & 2) px[t + 1] = src[s + 1]; if (ch & 4) px[t + 2] = src[s + 2];
      };
      for (let by = 0; by < bh; by++) {
        // A torn row: this band of blocks slides sideways.
        if (R() < a * 0.25) {
          const d = Math.round(((R() - 0.5) * W * a * 0.5) / ctx.k) * ctx.k, y0 = by * B;
          for (let y = y0; y < Math.min(H, y0 + B); y++) for (let x = 0; x < W; x++) copy((((x - d) % W) + W) % W, y, x, y, 7);
        }
        for (let bx = 0; bx < bw; bx++) {
          if (R() >= a * 0.5) continue;
          const x0 = bx * B, y0 = by * B, x1 = Math.min(W, x0 + B), y1 = Math.min(H, y0 + B), m = R();
          if (m < 0.4) { // smear: a block from further along the row
            const dx = Math.round((R() - 0.5) * 8) * B;
            for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) copy(x + dx, y, x, y, 7);
          } else if (m < 0.7) { // one channel slips half a block
            const ch = [1, 2, 4][(R() * 3) | 0], dx = Math.max(1, Math.round(B / 2 / ctx.k)) * ctx.k;
            for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) copy(Math.min(W - 1, x + dx), y, x, y, ch);
          } else { // flattened to its average, coarsely quantized
            let r = 0, g = 0, b = 0, n = 0;
            for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * W + x) * 4; r += src[i]; g += src[i + 1]; b += src[i + 2]; n++; }
            const q = v => Math.round(v / n / 85) * 85;
            r = q(r); g = q(g); b = q(b);
            for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * W + x) * 4; px[i] = r; px[i + 1] = g; px[i + 2] = b; }
          }
        }
      }
    },
  },
  {
    id: 'slices', name: 'Slice shift', family: 'Glitch',
    hint: 'Bands of the picture slide sideways, like a bad video signal.',
    params: [
      {key: 'amount', label: 'Shift', min: 0, max: 50, step: 1, default: 10, unit: '%'},
      {key: 'bands', label: 'Bands', min: 2, max: 60, step: 1, default: 16},
      {key: 'share', label: 'Moved', min: 0, max: 100, step: 5, default: 40, unit: '%'},
      direction, seed, moving,
    ],
    apply(px, W, H, p, ctx) {
      const R = rng(seedOf(p, ctx)), cols = p.direction === 'columns', len = cols ? W : H, span = cols ? H : W;
      const cells = Math.max(1, Math.round(len / ctx.k));
      // Random band edges on whole cells, then a shift for some bands.
      const cuts = [...new Set(Array.from({length: Math.max(1, p.bands - 1)}, () => Math.round(R() * cells)))].sort((x, y) => x - y);
      const edges = [0, ...cuts.filter(c => c > 0 && c < cells), cells].map(c => Math.min(len, c * ctx.k));
      const off = new Int32Array(len);
      for (let i = 0; i + 1 < edges.length; i++) {
        const d = R() < p.share / 100 ? Math.round(((R() * 2 - 1) * span * p.amount) / 100 / ctx.k) * ctx.k : 0;
        for (let l = Math.round(edges[i]); l < Math.round(edges[i + 1]); l++) off[l] = d;
      }
      shiftLines(px, W, H, cols, l => off[l]);
    },
  },
  {
    id: 'sort', name: 'Pixel sort', family: 'Glitch',
    hint: 'Runs of pixels are sorted by brightness, into streaks. From and To limit it to a brightness band; Run length caps each streak.',
    params: [
      {key: 'lo', label: 'From', min: 0, max: 100, step: 1, default: 0, unit: '%'},
      {key: 'hi', label: 'To', min: 0, max: 100, step: 1, default: 100, unit: '%'},
      {key: 'length', label: 'Run length', min: 2, max: 200, step: 1, default: 24, unit: ' cells'},
      direction,
      {key: 'reverse', label: 'Dark to light', type: 'toggle', default: false},
      seed,
    ],
    apply(px, W, H, p, ctx) {
      const k = ctx.k, most = p.length * k;
      const lo = (Math.min(p.lo, p.hi) * 255) / 100, hi = (Math.max(p.lo, p.hi) * 255) / 100, cols = p.direction === 'columns';
      const n = cols ? W : H, len = cols ? H : W, keys = new Float64Array(len);
      for (let l = 0; l < n; l++) {
        // The lines of one cell share a random sequence and runs are whole cells, so the grid stays intact.
        const R = rng(seedOf(p, ctx) + Math.floor(l / k) * 31), idx = j => (cols ? j * W + l : l * W + j) * 4;
        let j = 0;
        while (j < len) {
          while (j < len && !inBand(idx(j))) j++;
          // Each run stops at the band's edge or at a random length, whichever comes first.
          const s = j, end = s + Math.max(2, Math.round(((0.3 + 0.7 * R()) * most) / k) * k);
          while (j < len && j < end && inBand(idx(j))) j++;
          if (j - s < 2) continue;
          const run = keys.subarray(0, j - s);
          for (let q = s; q < j; q++) { const i = idx(q); run[q - s] = luma(px, i) * 16777216 + px[i] * 65536 + px[i + 1] * 256 + px[i + 2]; }
          run.sort();
          if (!p.reverse) run.reverse();
          for (let q = s; q < j; q++) { const i = idx(q), v = run[q - s] % 16777216; px[i] = v >> 16; px[i + 1] = (v >> 8) & 255; px[i + 2] = v & 255; }
        }
      }
      function inBand(i) { const v = luma(px, i); return v >= lo && v <= hi; }
    },
  },
  {
    id: 'wave', name: 'Wave warp', family: 'Glitch',
    hint: 'Rows sway on a sine wave. Moving makes it ripple.',
    params: [
      {key: 'amp', label: 'Height', min: 0, max: 20, step: 0.5, default: 3, unit: ' cells'},
      {key: 'length', label: 'Wavelength', min: 2, max: 200, step: 1, default: 40, unit: ' cells'},
      {key: 'phase', label: 'Phase', min: 0, max: 360, step: 1, default: 0, unit: '°'},
      direction, {...moving, default: false},
    ],
    apply(px, W, H, p, ctx) {
      const ph = (p.phase * Math.PI) / 180 + (p.moving ? (ctx.frame | 0) * 0.35 : 0);
      const lenPx = Math.max(1, p.length * ctx.k), amp = p.amp * ctx.k;
      // Whole cells move together, so the dither grid stays intact.
      shiftLines(px, W, H, p.direction === 'columns', l => Math.round((amp * Math.sin((Math.floor(l / ctx.k) * ctx.k * 2 * Math.PI) / lenPx + ph)) / ctx.k) * ctx.k);
    },
  },
  {
    id: 'chroma', name: 'Chromatic aberration', family: 'Glitch',
    hint: 'Red and blue pulled apart in opposite directions.',
    params: [
      {key: 'amount', label: 'Spread', min: 0, max: 10, step: 0.5, default: 1, unit: ' cells'},
      {key: 'angle', label: 'Angle', min: 0, max: 360, step: 5, default: 0, unit: '°'},
    ],
    apply(px, W, H, p, ctx) {
      const d = p.amount * ctx.k, a = (p.angle * Math.PI) / 180, dx = Math.round(Math.cos(a) * d), dy = Math.round(Math.sin(a) * d);
      if (!dx && !dy) return;
      const src = px.slice(), cx = v => (v < 0 ? 0 : v >= W ? W - 1 : v), cy = v => (v < 0 ? 0 : v >= H ? H - 1 : v);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        px[i] = src[(cy(y - dy) * W + cx(x - dx)) * 4];
        px[i + 2] = src[(cy(y + dy) * W + cx(x + dx)) * 4 + 2];
      }
    },
  },
  {
    id: 'glow', name: 'Glow', family: 'Light',
    hint: 'Light spills out of the bright parts, softly.',
    params: [
      {key: 'threshold', label: 'From', min: 0, max: 100, step: 1, default: 60, unit: '%'},
      {key: 'radius', label: 'Radius', min: 1, max: 40, step: 1, default: 6, unit: ' cells'},
      {key: 'strength', label: 'Strength', min: 0, max: 200, step: 5, default: 80, unit: '%'},
    ],
    apply(px, W, H, p, ctx) {
      // Work on a shrunken copy: the blur is wide and soft, so detail there is wasted.
      const rPx = p.radius * ctx.k, f = Math.max(1, Math.floor(rPx / 4)), sw = Math.ceil(W / f), sh = Math.ceil(H / f);
      const T = (p.threshold * 255) / 100, ch = [new Float32Array(sw * sh), new Float32Array(sw * sh), new Float32Array(sw * sh)];
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4, l = luma(px, i);
        if (l <= T) continue;
        const w = T < 255 ? (l - T) / (255 - T) : 0, o = ((y / f) | 0) * sw + ((x / f) | 0);
        ch[0][o] += px[i] * w; ch[1][o] += px[i + 1] * w; ch[2][o] += px[i + 2] * w;
      }
      const r = Math.max(1, Math.round(rPx / f / 2)), s = p.strength / 100 / (f * f);
      for (const c of ch) blur3(c, sw, sh, r);
      for (let y = 0; y < H; y++) {
        const fy = Math.min(sh - 1, Math.max(0, (y + 0.5) / f - 0.5)), y0 = fy | 0, y1 = Math.min(sh - 1, y0 + 1), ty = fy - y0;
        for (let x = 0; x < W; x++) {
          const fx = Math.min(sw - 1, Math.max(0, (x + 0.5) / f - 0.5)), x0 = fx | 0, x1 = Math.min(sw - 1, x0 + 1), tx = fx - x0;
          const a = y0 * sw + x0, b = y0 * sw + x1, c = y1 * sw + x0, d = y1 * sw + x1, i = (y * W + x) * 4;
          for (let k = 0; k < 3; k++) {
            const g = ch[k], v = (g[a] * (1 - tx) + g[b] * tx) * (1 - ty) + (g[c] * (1 - tx) + g[d] * tx) * ty;
            px[i + k] = px[i + k] + v * s;
          }
        }
      }
    },
  },
  {
    id: 'scanlines', name: 'Scan lines', family: 'Light',
    hint: 'Dark lines across the picture, like an old screen.',
    params: [
      {key: 'spacing', label: 'Spacing', min: 0.5, max: 8, step: 0.5, default: 1, unit: ' cells'},
      {key: 'thickness', label: 'Thickness', min: 10, max: 90, step: 5, default: 50, unit: '%'},
      {key: 'strength', label: 'Darkness', min: 0, max: 100, step: 5, default: 40, unit: '%'},
    ],
    apply(px, W, H, p, ctx) {
      const period = Math.max(2, Math.round(p.spacing * ctx.k)), dark = Math.max(1, Math.min(period - 1, Math.round((period * p.thickness) / 100))), m = 1 - p.strength / 100;
      for (let y = 0; y < H; y++) {
        if (y % period >= dark) continue;
        for (let i = y * W * 4, e = i + W * 4; i < e; i += 4) { px[i] *= m; px[i + 1] *= m; px[i + 2] *= m; }
      }
    },
  },
  {
    id: 'vignette', name: 'Vignette', family: 'Light',
    hint: 'The corners fall into shadow.',
    params: [
      {key: 'amount', label: 'Amount', min: 0, max: 100, step: 1, default: 50, unit: '%'},
      {key: 'size', label: 'Clear middle', min: 0, max: 100, step: 1, default: 45, unit: '%'},
    ],
    apply(px, W, H, p) {
      const inner = p.size / 100, outer = Math.SQRT2, a = p.amount / 100;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const nx = (2 * x + 1) / W - 1, ny = (2 * y + 1) / H - 1, d = Math.hypot(nx, ny);
        if (d <= inner) continue;
        const t = Math.min(1, (d - inner) / (outer - inner)), m = 1 - a * t * t * (3 - 2 * t), i = (y * W + x) * 4;
        px[i] *= m; px[i + 1] *= m; px[i + 2] *= m;
      }
    },
  },
  {
    id: 'grain', name: 'Grain', family: 'Texture',
    hint: 'Film grain over the top. Moving makes it crawl.',
    params: [
      {key: 'amount', label: 'Amount', min: 0, max: 100, step: 1, default: 20, unit: '%'},
      {key: 'size', label: 'Size', min: 0.25, max: 4, step: 0.25, default: 0.5, unit: ' cells'},
      {key: 'color', label: 'Colored grain', type: 'toggle', default: false},
      seed, moving,
    ],
    apply(px, W, H, p, ctx) {
      const R = rng(seedOf(p, ctx)), g = cellPx(p.size, ctx.k), gw = Math.ceil(W / g), gh = Math.ceil(H / g), n = p.color ? 3 : 1;
      const amp = p.amount * 1.28, noise = Float32Array.from({length: gw * gh * n}, () => (R() * 2 - 1) * amp);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const o = (((y / g) | 0) * gw + ((x / g) | 0)) * n, i = (y * W + x) * 4;
        px[i] += noise[o]; px[i + 1] += noise[o + (n > 1 ? 1 : 0)]; px[i + 2] += noise[o + (n > 1 ? 2 : 0)];
      }
    },
  },
  {
    id: 'tint', name: 'Tint', family: 'Texture',
    hint: 'Wash the picture in one color.',
    params: [
      {key: 'color', label: 'Color', type: 'color', default: '#c99530'},
      {key: 'amount', label: 'Amount', min: 0, max: 100, step: 1, default: 50, unit: '%'},
      {key: 'blend', label: 'Blend', type: 'choice', default: 'multiply', options: [{value: 'multiply', label: 'Multiply'}, {value: 'screen', label: 'Screen'}, {value: 'color', label: 'Color'}]},
    ],
    apply(px, W, H, p) {
      const c = hexRGB(p.color), a = p.amount / 100;
      for (let i = 0; i < W * H * 4; i += 4) {
        const l = luma(px, i) / 255;
        for (let k = 0; k < 3; k++) {
          const v = px[i + k], t = p.blend === 'screen' ? 255 - ((255 - v) * (255 - c[k])) / 255 : p.blend === 'color' ? c[k] * l * 1.6 : (v * c[k]) / 255;
          px[i + k] = v + (t - v) * a;
        }
      }
    },
  },
];

export const EFFECT_BY_ID = Object.fromEntries(EFFECTS.map(e => [e.id, e]));

/** A new stack entry for effect `id`, its params at their defaults. */
export function newEffect(id) {
  const e = EFFECT_BY_ID[id];
  return e ? {id, on: true, ...Object.fromEntries(e.params.map(p => [p.key, p.default]))} : null;
}

/** Only known effects and params, each in range: a hand-edited file can't break the app. */
export function cleanEffects(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const r of raw) {
    const e = r && typeof r === 'object' && EFFECT_BY_ID[r.id];
    if (!e) continue;
    const fx = newEffect(e.id);
    fx.on = r.on !== false;
    for (const p of e.params) {
      const v = r[p.key];
      if (p.type === 'toggle') { if (typeof v === 'boolean') fx[p.key] = v; }
      else if (p.type === 'choice') { if (p.options.some(o => o.value === v)) fx[p.key] = v; }
      else if (p.type === 'color') { if (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)) fx[p.key] = v; }
      else if (typeof v === 'number' && isFinite(v)) fx[p.key] = Math.min(p.max, Math.max(p.min, v));
    }
    out.push(fx);
    if (out.length >= MAX_STACK) break;
  }
  return out;
}
export const MAX_EFFECTS = MAX_STACK;

/** True when the stack would change anything. */
export const hasEffects = list => Array.isArray(list) && list.some(e => e && e.on && EFFECT_BY_ID[e.id]);

/**
 * Run the stack on px (RGBA Uint8ClampedArray, W × H) in place, top to bottom.
 * ctx: {k: output pixels per cell, frame: frame number for Moving effects}.
 */
export function applyEffects(px, W, H, list, ctx = {}) {
  const c = {k: Math.max(1, ctx.k || 1), frame: ctx.frame | 0};
  for (const e of list || []) {
    if (!e || !e.on) continue;
    const def = EFFECT_BY_ID[e.id];
    if (def) def.apply(px, W, H, e, c);
  }
  return px;
}
