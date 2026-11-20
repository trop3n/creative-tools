// JJARO's foil: holographic film modelled as a diffraction grating. Microscopic grooves
// split each light into its spectrum; which colour reaches the eye depends on the light,
// the eye and the groove direction through the grating equation
//   d · (L + V) · k = m λ
// (k: the in-surface direction across the grooves, d: groove spacing, m: diffraction
// order), as in Stam, "Diffraction Shaders" (SIGGRAPH 1999). Wavelengths become colour
// through Wyman, Sloan and Shirley's analytic fit of the CIE 1931 observer (JCGT 2013).
// The studio is procedural: a few soft boxes that move, and a dim gradient around them.

export const PATTERNS = [
  {id: 'linear', name: 'Lines', hint: 'Straight grooves: rainbow streaks that run along the folds.'},
  {id: 'rings', name: 'Rings', hint: 'Circular grooves around the sheet’s middle: rainbow halos.'},
  {id: 'cells', name: 'Mosaic', hint: 'Small tiles, each with its grooves at its own angle: a glittering security-foil look.'},
  {id: 'swirl', name: 'Swirl', hint: 'Grooves that bend and wander, like brushed or scratched foil.'},
];
export const PATTERN_IDS = PATTERNS.map(p => p.id);
export const MAX_LIGHTS = 3;

// What's printed with the artwork. A kinegram turns the grooves a quarter turn inside
// the artwork, so it lights up when the plain foil goes dark and the other way round;
// foil stamping lays foil only where the artwork is, on matte paper; ink on foil prints
// the artwork's colours over the foil in see-through inks.
export const PRINTS = [
  {id: 'none', name: 'None', hint: 'Plain foil all over.'},
  {id: 'kinegram', name: 'Kinegram', hint: 'The artwork is cut into the grooves at a quarter turn: tilt the foil and it flips from bright to dark against the rest.'},
  {id: 'stamp', name: 'Foil stamp', hint: 'Foil only where the artwork is, pressed onto matte paper, like hot-foil printing.'},
  {id: 'ink', name: 'Ink on foil', hint: 'The artwork’s colors printed over the foil in see-through inks. White leaves the foil bare.'},
];
export const PRINT_IDS = PRINTS.map(p => p.id);

export const FS_FOIL = `#version 300 es
precision highp float;
in vec3 vPos, vNrm, vTan;
in vec2 vUv;
uniform vec3 uEye, uFront, uTint, uEnvTop, uEnvBottom;
uniform float uRainbow, uSpread, uSpacing, uScale, uAngle, uSeed;
uniform int uPattern, uLights;
uniform vec3 uLightDir[${MAX_LIGHTS}];
uniform float uLightSize;
uniform int uPrint;
uniform sampler2D uArt;
uniform float uArtAspect, uArtSize, uArtAlpha, uInvert, uInk;
uniform vec3 uPaper;
out vec4 o;

const float PI = 3.14159265;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7)) + uSeed) * 43758.5453); }

// CIE 1931 colour matching functions, multi-lobe Gaussian fit (Wyman et al. 2013).
float lobe(float x, float mu, float s1, float s2) { float t = (x - mu) / (x < mu ? s1 : s2); return exp(-0.5 * t * t); }
vec3 spectrum(float nm) {
  float X = 1.056 * lobe(nm, 599.8, 37.9, 31.0) + 0.362 * lobe(nm, 442.0, 16.0, 26.7) - 0.065 * lobe(nm, 501.1, 20.4, 26.2);
  float Y = 0.821 * lobe(nm, 568.8, 46.9, 40.5) + 0.286 * lobe(nm, 530.9, 16.3, 31.1);
  float Z = 1.217 * lobe(nm, 437.0, 11.8, 36.0) + 0.681 * lobe(nm, 459.0, 26.0, 13.8);
  vec3 rgb = mat3(3.2406, -0.9689, 0.0557, -1.5372, 1.8758, -0.2040, -0.4986, 0.0415, 1.0570) * vec3(X, Y, Z);
  return max(rgb, 0.0);
}

// The direction across the grooves (radians, in the sheet's own u/v frame) and how much
// of the surface is grating rather than plain metal, from the pattern.
vec2 grooves(vec2 uv, out float spacing) {
  spacing = uSpacing;
  if (uPattern == 1) { // rings: grooves circle the middle, so the grating runs outward
    vec2 d = uv - 0.5;
    return vec2(atan(d.y, d.x), 1.0);
  }
  if (uPattern == 2) { // mosaic: tiles with their own angle and spacing, thin plain seams
    vec2 g = uv * uScale, cell = floor(g), f = fract(g);
    spacing *= 0.8 + 0.45 * hash(cell + 7.0);
    float seam = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y));
    return vec2(hash(cell) * PI, smoothstep(0.02, 0.06, seam));
  }
  if (uPattern == 3) { // swirl: a smooth, wandering angle field
    vec2 p = uv * uScale * 0.35;
    float a = sin(p.x * 2.1 + sin(p.y * 1.7 + uSeed)) + sin(p.y * 2.6 + sin(p.x * 1.3 - uSeed)) + 0.5 * sin((p.x + p.y) * 4.3);
    return vec2(a * 1.4 + uAngle, 1.0);
  }
  return vec2(uAngle, 1.0); // lines
}

// A soft box seen in a reflected direction: bright inside its angular size.
float box(vec3 r, vec3 l) { return smoothstep(cos(uLightSize * 1.6 + 0.02), cos(uLightSize * 0.6), dot(r, l)); }

// The studio: a soft bright ceiling over a dark floor, coloured a little by the backdrop,
// with a broad dim fill behind the camera so faces turned to it aren't black.
vec3 environment(vec3 r) {
  vec3 c = mix(vec3(0.03), vec3(0.42), smoothstep(-0.35, 0.95, r.y)) + mix(uEnvBottom, uEnvTop, 0.5 + 0.5 * r.y) * 0.5
    + vec3(0.3) * smoothstep(0.2, 0.9, dot(r, uFront));
  for (int i = 0; i < ${MAX_LIGHTS}; i++) if (i < uLights) c += vec3(4.0) * box(r, uLightDir[i]);
  return c;
}

// How much of this point the artwork covers (0..1), and its colour, centred on the sheet.
float artwork(vec2 uv, out vec4 art) {
  vec2 box = uArtSize * (uArtAspect >= 1.0 ? vec2(1.0, 1.0 / uArtAspect) : vec2(uArtAspect, 1.0));
  vec2 q = (uv - 0.5) / box + 0.5;
  art = texture(uArt, q); // outside any branch, so mip selection sees smooth derivatives
  float inside = step(0.0, q.x) * step(q.x, 1.0) * step(0.0, q.y) * step(q.y, 1.0);
  art.a *= inside;
  float cov = uArtAlpha > 0.5 ? art.a : inside * (1.0 - dot(art.rgb, vec3(0.2126, 0.7152, 0.0722)));
  return uInvert > 0.5 ? 1.0 - cov : cov;
}

vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); } // Narkowicz's fit

void main() {
  vec3 n = normalize(vNrm), v = normalize(uEye - vPos);
  bool front = dot(n, v) >= 0.0; // the printed side
  if (!front) n = -n; // both faces are foil
  vec3 t = normalize(vTan - n * dot(n, vTan)), b = cross(n, t);
  float spacing;
  vec2 gr = grooves(vUv, spacing);
  vec4 art = vec4(0.0);
  float cov = uPrint > 0 ? artwork(vUv, art) : 0.0;
  if (uPrint == 1) gr.x += cov * PI * 0.5; // kinegram: the grooves are cut through both faces
  vec3 k = cos(gr.x) * t + sin(gr.x) * b; // across the grooves
  vec3 g = cross(n, k); // along them
  float grating = gr.y * uRainbow;

  // Plain metal: the studio reflected, tinted by the foil's colour. The grating takes
  // part of the light away from the mirror direction into its rainbow.
  vec3 r = reflect(-v, n);
  vec3 col = uTint * environment(r) * (1.0 - 0.6 * grating);

  // Diffraction: for each light, orders 1–3 of the grating equation.
  float width = 0.04 + uSpread * 0.3 + uLightSize * 0.5;
  for (int i = 0; i < ${MAX_LIGHTS}; i++) {
    if (i >= uLights) break;
    vec3 h = uLightDir[i] + v;
    float u = abs(dot(h, k)), w = dot(h, g);
    float along = exp(-(w * w) / (width * width)); // grooves only bend light across themselves
    // Average each band over the wavelengths this pixel spans, so tight folds blend
    // their colours instead of sparkling from one pixel to the next.
    float du = fwidth(u) * 0.6;
    vec3 rainbow = vec3(0.0);
    for (int m = 1; m <= 3; m++) {
      float s = spacing * 1000.0 / float(m);
      rainbow += (spectrum(s * (u - du)) + spectrum(s * u) + spectrum(s * (u + du))) / (3.0 * float(m));
    }
    col += grating * along * rainbow * mix(vec3(1.0), uTint, 0.35) * 1.6;
  }

  if (uPrint == 2) {
    // Matte paper, lit by the soft boxes and the studio's ceiling, under the stamped foil.
    float light = 0.16 + 0.22 * (0.5 + 0.5 * n.y);
    for (int i = 0; i < ${MAX_LIGHTS}; i++) if (i < uLights) light += 0.55 * max(0.0, dot(n, uLightDir[i]));
    col = mix(uPaper * light, col, front ? cov : 0.0);
  } else if (uPrint == 3 && front) {
    col *= mix(vec3(1.0), pow(art.rgb, vec3(2.2)), art.a * uInk);
  }
  o = vec4(pow(aces(col), vec3(1.0 / 2.2)), 1.0);
}`;

/**
 * Where the lights are at time t: soft boxes sweeping slowly back and forth in front of
 * the sheet, each on its own phase, so the foil flashes as they pass. Every motion
 * repeats after `period` seconds, and the rig turns with the camera's orbit. Returns a
 * flat array of directions (toward the light).
 */
export function lightDirs(cfg, t, period) {
  const out = new Float32Array(MAX_LIGHTS * 3);
  const phase = (2 * Math.PI * t) / period;
  for (let i = 0; i < cfg.lights; i++) {
    const base = cfg.lights === 1 ? 0 : (i / (cfg.lights - 1) - 0.5) * 100; // spread across the front, degrees
    const az = (cfg.orbit + base + cfg.lightSwing * 70 * Math.sin(phase + i * 2.1)) * Math.PI / 180;
    const el = (30 + 15 * Math.sin(phase * (i % 2 ? 1 : 2) + i)) * Math.PI / 180;
    out[i * 3] = Math.sin(az) * Math.cos(el);
    out[i * 3 + 1] = Math.sin(el);
    out[i * 3 + 2] = Math.cos(az) * Math.cos(el);
  }
  return out;
}
