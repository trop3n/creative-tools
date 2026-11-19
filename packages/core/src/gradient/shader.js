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

export const FRAG = `#version 300 es
precision highp float; precision highp int;

uniform vec2 uRes;          // canvas size in pixels
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

/* ---------- noise (same steps as noise.js) ---------- */
uvec3 hash3(uvec3 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v;
}
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
  if (uLoop > 0.0) return TAU * max(1.0, floor(rate * uLoop + 0.5)) * uTime / uLoop;
  return TAU * rate * uTime;
}

/* ---------- color ---------- */
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
vec3 toGamma(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(12.92 * c, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
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

/* ---------- grain ---------- */
float hashf(ivec2 p, int frame) {
  return float(hash3(uvec3(ivec3(p, frame)) + uvec3(uSeed)).x & 65535u) / 65535.0 - 0.5;
}

// |x| with the point at zero rounded off, so a ridge has no hairline crease.
float softAbs(float x, float r) { return sqrt(x * x + r * r) - r; }

mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, s, -s, c); }

void main() {
  float unit = min(uRes.x, uRes.y);
  vec2 frag = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y); // y down, like the config
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
  vec2 d = p + (coarse + 0.3 * fine) * uWarp * 0.5 + sway;

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
    float slope = length(vec2(dFdx(radial), dFdy(radial))) * unit;
    float edge = (radial - 1.0) / max(slope, 1e-3);
    float falloff = mix(0.01, 0.45, uSoft) * breathe;
    float mask = 0.5 - 0.5 * tanh(1.6 * edge / falloff);

    vec2 dir = vec2(cos(radians(uAngle)), sin(radians(uAngle)));
    float axisT = dot(d - c, dir) / max(1e-3, max(uSize.x, uSize.y)) + 0.5;
    float t = mix(clamp(1.0 - radial, 0.0, 1.0), axisT, uRamp) + flow;
    if (uMotion == 2) t = 1.0 - abs(1.0 - 2.0 * fract(0.5 * t)); // slide back and forth with no jump
    lab = mix(uBackground, ramp(t), mask);
  }

  // Film grain on lightness: full in highlights, 30% in shadows.
  if (uGrain > 0.0) {
    int frame = uMotion == 3 ? 0 : int(floor((uLoop > 0.0 ? mod(uTime, uLoop) : uTime) * 24.0));
    ivec2 px = ivec2(gl_FragCoord.xy);
    float g = 0.35 * (hashf(px, frame) + hashf(px + 7919, frame)) + 0.3 * hashf(px / 2 + 3571, frame);
    lab.x += g * 0.14 * uGrain * mix(0.3, 1.0, smoothstep(0.0, 0.2, lab.x));
  }
  outColor = vec4(toGamma(oklabToLinear(lab)), 1.0);
}`;
