// LEELA's fragment shader: the whole gradient, per pixel, in one pass.
//
//   position → noise warp (+ motion) → shape distance → soft edge
//            → color ramp (Catmull–Rom in Oklab) or mesh blend → film grain → sRGB
//
// The noise and loop math match noise.js step for step (constants come from there).
import {NOISE_GAIN, CORR_K} from './noise.js';
import {MAX_STOPS, MAX_POINTS} from './config.js';

const f = n => n.toFixed(6);

export const VERT = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

// Shared by both passes: hashing, Oklab and gamma, and the film grain.
const COMMON = `
uvec3 hash3(uvec3 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v;
}
vec3 oklabToLinear(vec3 c) {
  float l = c.x + 0.3963377774 * c.y + 0.2158037573 * c.z;
  float m = c.x - 0.1055613458 * c.y - 0.0638541728 * c.z;
  float s = c.x - 0.0894841775 * c.y - 1.2914855480 * c.z;
  l = l * l * l; m = m * m * m; s = s * s * s;
  return vec3(
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s);
}
vec3 linearToOklab(vec3 c) {
  vec3 lms = vec3(
    0.4122214708 * c.r + 0.5363325363 * c.g + 0.0514459929 * c.b,
    0.2119034982 * c.r + 0.6806995451 * c.g + 0.1073969566 * c.b,
    0.0883024619 * c.r + 0.2817188376 * c.g + 0.6299787005 * c.b);
  lms = pow(max(lms, vec3(0.0)), vec3(1.0 / 3.0));
  return vec3(
    0.2104542553 * lms.x + 0.7936177850 * lms.y - 0.0040720468 * lms.z,
    1.9779984951 * lms.x - 2.4285922050 * lms.y + 0.4505937099 * lms.z,
    0.0259040371 * lms.x + 0.7827717662 * lms.y - 0.8086757660 * lms.z);
}
vec3 toGamma(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(12.92 * c, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
vec3 toLinear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}
float hashf(ivec2 p, int frame, uint seed) {
  return float(hash3(uvec3(ivec3(p, frame)) + uvec3(seed)).x & 65535u) / 65535.0 - 0.5;
}
// Film grain on Oklab lightness: full in highlights, 30% in shadows. Changes
// 24 times a second while moving (repeating with a loop), fixed when still.
vec3 grain(vec3 lab, ivec2 px, float amount, uint seed, int motion, float time, float loop) {
  if (amount <= 0.0) return lab;
  int frame = motion == 3 ? 0 : int(floor((loop > 0.0 ? mod(time, loop) : time) * 24.0));
  float g = 0.35 * (hashf(px, frame, seed) + hashf(px + 7919, frame, seed)) + 0.3 * hashf(px / 2 + 3571, frame, seed);
  lab.x += g * 0.14 * amount * mix(0.3, 1.0, smoothstep(0.0, 0.2, lab.x));
  return lab;
}`;

export const FRAG = `#version 300 es
precision highp float; precision highp int;

uniform vec2 uRes;          // full frame size in pixels
uniform vec2 uOrigin;       // this draw's lower-left corner within the frame (tiles); 0 normally
uniform float uCell;        // > 0: cell pass, one fragment per cell of this many pixels (grain left to the effect)
uniform float uGlass, uRib; // glass: strength, and rib width in pixels
uniform vec3 uHover;        // pointer (x, y in 0..1, y down) and strength: + pulls colors in, − pushes them away; 0 off
uniform float uTime;        // seconds
uniform uint uSeed;
uniform int uShape;         // 0 blob, 1 pill, 2 band, 3 ring, 4 mesh
uniform vec2 uCenter;       // 0..1, y down
uniform vec2 uSize;
uniform float uRound, uSoft, uRotation, uRamp, uAngle, uWarp, uWarpScale, uGrain, uSpeed, uLoop;
uniform int uMotion;        // 0 drift, 1 breathe, 2 flow, 3 none
uniform vec3 uStops[${MAX_STOPS}];
uniform int uStopCount;
uniform vec3 uBackground;
uniform vec2 uPoints[${MAX_POINTS}];
uniform vec3 uPointColors[${MAX_POINTS}];
uniform int uPointCount;
out vec4 outColor;

const float TAU = 6.28318530718;

${COMMON}

/* ---------- noise (same steps as noise.js) ---------- */
vec3 grad(ivec3 c) {
  uvec3 h = hash3(uvec3(c) + uvec3(uSeed, 0u, 0u));
  vec3 g = vec3(h & 1023u) / 511.5 - 1.0;
  float l = length(g);
  return l > 0.0 ? g / l : vec3(1.0, 0.0, 0.0);
}
// Sampled in a turned frame so time never runs along the lattice (see noise.js).
const mat3 TURN = mat3(2.0, 2.0, -1.0, -1.0, 2.0, 2.0, 2.0, -1.0, 2.0) / 3.0;
float gnoise(vec3 p) {
  p = TURN * p;
  ivec3 i = ivec3(floor(p));
  vec3 f = p - floor(p);
  vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  #define C(dx, dy, dz) dot(grad(i + ivec3(dx, dy, dz)), f - vec3(dx, dy, dz))
  float v = mix(
    mix(mix(C(0, 0, 0), C(1, 0, 0), u.x), mix(C(0, 1, 0), C(1, 1, 0), u.x), u.y),
    mix(mix(C(0, 0, 1), C(1, 0, 1), u.x), mix(C(0, 1, 1), C(1, 1, 1), u.x), u.y),
    u.z);
  #undef C
  return ${f(NOISE_GAIN)} * v;
}
// The field over time; with uLoop > 0 a seamless loop (see noise.js).
float evolving(vec2 q, float z0, float rate) {
  if (uLoop <= 0.0) return gnoise(vec3(q, z0 + uTime * rate));
  float phase = fract(uTime / uLoop);
  float travel = uLoop * rate;
  float a = gnoise(vec3(q, z0 + phase * travel));
  float b = gnoise(vec3(q, z0 + (phase - 1.0) * travel));
  float blend = phase * phase * (3.0 - 2.0 * phase);
  float rho = exp(${f(-CORR_K)} * travel * travel);
  return mix(a, b, blend) * inversesqrt(max(1e-4, 1.0 - 2.0 * blend * (1.0 - blend) * (1.0 - rho)));
}
// A repeating motion's angle. In a loop it runs a whole number of cycles, so it
// ends where it began.
float cycle(float rate) {
  if (rate <= 0.0) return 0.0; // Speed 0 holds still, loop or not
  if (uLoop > 0.0) return TAU * max(1.0, floor(rate * uLoop + 0.5)) * uTime / uLoop;
  return TAU * rate * uTime;
}

/* ---------- color ---------- */
vec3 stop(int i) { return uStops[clamp(i, 0, uStopCount - 1)]; }
// Catmull–Rom through the stops (as rampAt in color.js).
vec3 ramp(float t) {
  if (uStopCount < 2) return uStops[0];
  float x = clamp(t, 0.0, 1.0) * float(uStopCount - 1);
  int i = min(uStopCount - 2, int(floor(x)));
  float f = x - float(i), f2 = f * f, f3 = f2 * f;
  vec3 p0 = stop(i - 1), p1 = stop(i), p2 = stop(i + 1), p3 = stop(i + 2);
  return 0.5 * (2.0 * p1 + (p2 - p0) * f + (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * f2 + (3.0 * p1 - p0 - 3.0 * p2 + p3) * f3);
}

// |x| with the point at zero rounded off, so a ridge has no hairline crease.
float softAbs(float x, float r) { return sqrt(x * x + r * r) - r; }

mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, s, -s, c); }

void main() {
  float unit = min(uRes.x, uRes.y);
  vec2 full;                                                 // pixel in the whole frame, y up
  if (uCell > 0.0) {
    // Cell pass: this fragment is one cell; take the gradient at the cell's center.
    // Cells count from the frame's top-left; the texture's bottom row is the last row.
    float rows = ceil(uRes.y / uCell);
    vec2 cell = floor(gl_FragCoord.xy);
    full = vec2((cell.x + 0.5) * uCell, uRes.y - (rows - 1.0 - cell.y + 0.5) * uCell);
  } else {
    full = gl_FragCoord.xy + uOrigin;
  }
  vec2 frag = vec2(full.x, uRes.y - full.y);                 // y down, like the config
  // Glass: vertical ribs, each a small lens that mirrors what lies behind it.
  float rib = 0.0;
  if (uGlass > 0.0 && uRib > 0.0) {
    rib = fract(frag.x / uRib) - 0.5;
    frag.x -= rib * uRib * uGlass * 1.6;
  }
  vec2 p = (frag - 0.5 * uRes) / unit;                        // short side spans -0.5..0.5
  vec2 c = (uCenter - 0.5) * uRes / unit;
  float seedOff = float(uSeed % 997u) * 0.731;

  // Motion.
  float drift = uMotion == 0 ? uSpeed * 0.25 : 0.0;                    // z per second
  float breathe = uMotion == 1 ? 1.0 + 0.12 * sin(cycle(0.2 * uSpeed)) : 1.0;
  // Ramp slide, in whole round trips (2 units: there and back), so loops close.
  float flow = uMotion == 2 ? 2.0 * cycle(0.025 * uSpeed) / TAU : 0.0;
  vec2 sway = uMotion == 0 ? 0.025 * vec2(sin(cycle(0.07 * uSpeed)), cos(cycle(0.05 * uSpeed))) : vec2(0.0);

  // Warp: two layers of noise push the position around.
  vec2 q = p * uWarpScale + seedOff;
  vec2 coarse = vec2(evolving(q, 0.0, drift), evolving(q + 17.31, 0.0, drift));
  vec2 fine = vec2(evolving(q * 1.9 + coarse * 1.2 + 5.2, 4.0, drift), evolving(q * 1.9 + coarse * 1.2 + 23.7, 4.0, drift));
  // Push size is divided by the feature scale: finer warp means steeper noise, and
  // once a push changes faster than space itself the picture folds over (a seam).
  // This way folds start only near the top of the Amount slider, at any scale.
  vec2 d = p + (coarse + 0.3 * fine) * uWarp * (0.3 / uWarpScale) + sway;
  // Hover: near the pointer, look a little further from it (colors gather in toward
  // the pointer) or closer to it (they swell out away from it), fading with distance.
  if (uHover.z != 0.0) {
    vec2 ptr = (uHover.xy - 0.5) * uRes / unit;
    vec2 away = d - ptr;
    d += away * uHover.z * 0.9 * exp(-dot(away, away) / 0.035);
  }

  vec3 lab;
  if (uShape == 4) {
    // Mesh: every point pulls the color toward its own, by inverse distance.
    float sharp = mix(3.0, 1.0, uSoft);
    vec2 mid = vec2(0.0);
    for (int i = 0; i < ${MAX_POINTS}; i++) { if (i >= uPointCount) break; mid += uPoints[i]; }
    mid /= max(1.0, float(uPointCount));
    vec3 acc = vec3(0.0); float wsum = 0.0;
    float orbit = uMotion == 2 ? cycle(0.12 * uSpeed) : 0.0;
    for (int i = 0; i < ${MAX_POINTS}; i++) {
      if (i >= uPointCount) break;
      vec2 pt = (uPoints[i] - 0.5) * uRes / unit;
      pt = (pt - (mid - 0.5) * uRes / unit) * breathe + (mid - 0.5) * uRes / unit;
      if (uMotion == 2) pt += 0.06 * vec2(cos(orbit + float(i) * 2.39996), sin(orbit + float(i) * 2.39996));
      vec2 e = d - pt;
      float w = pow(dot(e, e) + 0.002, -sharp);
      acc += uPointColors[i] * w; wsum += w;
    }
    lab = uPointCount > 0 ? acc / wsum : uBackground;
  } else {
    // Shapes, in the shape's own frame.
    vec2 v = rot(-radians(uRotation)) * (d - c);
    vec2 half_ = 0.5 * uSize * breathe;
    float radial;
    if (uShape == 2) {
      radial = softAbs(v.y / max(1e-3, half_.y), 0.12);
    } else {
      float n = mix(8.0, 2.0, uRound);
      vec2 r = abs(v) / max(vec2(1e-3), half_);
      radial = pow(pow(r.x, n) + pow(r.y, n), 1.0 / n);
      if (uShape == 0) {
        // Blob: the outline boils with its own noise.
        vec2 dir = length(v) > 1e-4 ? normalize(v) : vec2(1.0, 0.0);
        radial /= 1.0 + mix(0.45, 0.12, uRound) * 0.5 * evolving(dir * 1.3 + seedOff, 9.0, drift);
      }
      if (uShape == 3) radial = softAbs((radial - 0.68) / 0.32, 0.12);
    }
    // Soft edge with a constant width: distance past the outline in screen units.
    // (In the cell pass neighbours are a cell apart, so divide by the cell size.)
    float slope = length(vec2(dFdx(radial), dFdy(radial))) * unit / max(uCell, 1.0);
    float edge = (radial - 1.0) / max(slope, 1e-3);
    float falloff = mix(0.01, 0.45, uSoft) * breathe;
    float mask = 0.5 - 0.5 * tanh(1.6 * edge / falloff);

    vec2 dir = vec2(cos(radians(uAngle)), sin(radians(uAngle)));
    float axisT = dot(d - c, dir) / max(1e-3, max(uSize.x, uSize.y)) + 0.5;
    // The ramp from the middle rounds off at the very center; a sharp tip there,
    // shaped by a blob's boiling outline, would show as a star-shaped crease.
    float t = mix(clamp(1.0 - softAbs(radial, 0.12), 0.0, 1.0), axisT, uRamp) + flow;
    if (uMotion == 2) t = 1.0 - abs(1.0 - 2.0 * fract(0.5 * t)); // slide back and forth with no jump
    lab = mix(uBackground, ramp(t), mask);
  }

  // Glass ribs: bright down the middle of each, darker at the seams.
  if (uGlass > 0.0) lab.x *= 1.0 + uGlass * 0.22 * (0.3 - 2.0 * abs(rib));

  // Film grain (the cell pass leaves it to the effect pass, at full resolution).
  if (uCell <= 0.0) lab = grain(lab, ivec2(full), uGrain, uSeed, uMotion, uTime, uLoop);
  outColor = vec4(toGamma(oklabToLinear(lab)), 1.0);
}`;

/* ---------- effects pass ---------- */

// ASCII glyphs, 5×5, drawn as text. Sorted by how many pixels they light, they
// make a ramp from dark to bright.
const GLYPH_ART = [
  ['.....', '.....', '.....', '.....', '.....'],
  ['.....', '.....', '.....', '.....', '..#..'],
  ['.....', '..#..', '.....', '..#..', '.....'],
  ['.....', '.....', '.###.', '.....', '.....'],
  ['.....', '.###.', '.....', '.###.', '.....'],
  ['.....', '..#..', '.###.', '..#..', '.....'],
  ['.###.', '#...#', '#...#', '#...#', '.###.'],
  ['#.#.#', '.###.', '#####', '.###.', '#.#.#'],
  ['.#.#.', '#####', '.#.#.', '#####', '.#.#.'],
  ['.###.', '#####', '##.##', '#####', '.###.'],
];
const glyphBits = rows => rows.join('').split('').reduce((bits, ch, i) => (ch === '#' ? bits | (1 << i) : bits), 0);
const lit = n => { let c = 0; for (; n; n &= n - 1) c++; return c; };
/** The glyphs as 25-bit masks (bit r·5 + c is row r, column c), dimmest first. */
export const GLYPHS = GLYPH_ART.map(glyphBits).sort((a, b) => lit(a) - lit(b));

// Reads the cell texture (one gradient sample per cell, sRGB) and draws each pixel.
export const FRAG_FX = `#version 300 es
precision highp float; precision highp int; precision highp sampler2D;
uniform sampler2D uCells;
uniform vec2 uRes, uOrigin;
uniform float uCell;
uniform int uEffect;          // 1 pixelate, 2 ascii
uniform vec3 uBackground;     // Oklab, behind ASCII glyphs
uniform float uAmount;        // ASCII: contrast (0..1)
uniform uint uGlyph[${GLYPHS.length}];
uniform float uGrain, uTime, uLoop;
uniform uint uSeed;
uniform int uMotion;
out vec4 outColor;
${COMMON}
void main() {
  vec2 full = gl_FragCoord.xy + uOrigin;
  vec2 frag = vec2(full.x, uRes.y - full.y);
  vec2 cell = floor(frag / uCell);
  float rows = ceil(uRes.y / uCell);
  vec3 rgb = texelFetch(uCells, ivec2(cell.x, rows - 1.0 - cell.y), 0).rgb;
  vec3 lab = linearToOklab(toLinear(rgb));
  if (uEffect == 2) {
    // ASCII: the further a cell stands out from the backdrop (lighter on a dark one,
    // darker or more colorful on a light one), the denser its glyph. Glyphs keep the
    // cell's hue, pushed away from the backdrop so they read. Each glyph takes 5 of
    // every 6 pixels across and down, leaving a gap.
    vec3 bg = uBackground;
    float dark = step(bg.x, 0.5);
    float room = mix(bg.x, 1.0 - bg.x, dark);
    float stand = length(vec2((lab.x - bg.x) / max(room, 0.05), length(lab.yz - bg.yz) * 3.0));
    float b = pow(clamp(stand * (0.5 + 3.0 * uAmount), 0.0, 1.0), 0.75);
    int level = clamp(int(b * ${GLYPHS.length}.0), 0, ${GLYPHS.length - 1});
    ivec2 g = ivec2(floor((frag - cell * uCell) / uCell * 6.0));
    bool on = g.x < 5 && g.y < 5 && ((uGlyph[level] >> uint(g.y * 5 + g.x)) & 1u) == 1u;
    vec3 ink = vec3(dark > 0.5 ? max(lab.x, 0.6) : min(lab.x, 0.45), lab.yz * 1.2);
    lab = on ? ink : bg;
  }
  lab = grain(lab, ivec2(full), uGrain, uSeed, uMotion, uTime, uLoop);
  outColor = vec4(toGamma(oklabToLinear(lab)), 1.0);
}`;
