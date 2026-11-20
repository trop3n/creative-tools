// THOTH's halftone pass (WebGL2): re-draws a source canvas as per-channel dot screens.
// RGB adds red, green and blue screens on a dark background; CMYK multiplies four
// process inks onto paper; Mono prints one ink. Each pixel checks its own cell and the
// eight around it, so dots bigger than their cell merge with their neighbours.

const VS = `#version 300 es
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const FS = `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform vec2 uRes;
uniform float uPitch, uDot, uAA, uGcr;
uniform int uShape, uMode, uInvert, uShowSrc;
uniform vec4 uAngles;
uniform vec2 uOff[4];
uniform vec3 uBg, uPaper, uInk;
out vec4 o;

vec3 srcAt(vec2 px) { return texture(uSrc, clamp(px / uRes, 0.0, 1.0)).rgb; }

// How much ink (or light) channel ch wants at this colour.
float chan(vec3 c, int ch) {
  if (uMode == 0) return ch == 0 ? c.r : ch == 1 ? c.g : c.b;
  if (uMode == 1) {
    float k = (1.0 - max(c.r, max(c.g, c.b))) * uGcr;
    vec3 cmy = (1.0 - c - k) / max(1e-4, 1.0 - k);
    return ch == 0 ? cmy.x : ch == 1 ? cmy.y : ch == 2 ? cmy.z : k;
  }
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  return uInvert == 1 ? l : 1.0 - l;
}

float cover(vec2 fc, int ch) {
  float a = uAngles[ch];
  mat2 R = mat2(cos(a), sin(a), -sin(a), cos(a));
  vec2 p = R * (fc + uOff[ch]);
  vec2 cell = floor(p / uPitch);
  float best = 0.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 cc = (cell + vec2(i, j) + 0.5) * uPitch;
      float v = clamp(chan(srcAt(transpose(R) * cc - uOff[ch]), ch), 0.0, 1.0);
      if (v < 0.003) continue;
      vec2 d = p - cc;
      float dist, r;
      if (uShape == 0) { dist = length(d); r = sqrt(v) * uPitch * 0.5 * uDot; }
      else if (uShape == 1) { dist = max(abs(d.x), abs(d.y)); r = sqrt(v) * uPitch * 0.5 * uDot; }
      else if (uShape == 2) { dist = abs(d.x) + abs(d.y); r = sqrt(v) * uPitch * 0.7071 * uDot; }
      else { dist = abs(d.y); r = v * uPitch * 0.5 * uDot; }
      best = max(best, 1.0 - smoothstep(r - uAA, r + uAA, dist));
    }
  }
  return best;
}

void main() {
  vec2 fc = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y); // pixels from the top left
  if (uShowSrc == 1) { o = vec4(srcAt(fc), 1.0); return; }
  vec3 col;
  if (uMode == 0) {
    col = min(uBg + vec3(cover(fc, 0), cover(fc, 1), cover(fc, 2)), 1.0);
  } else if (uMode == 1) {
    col = uPaper;
    col *= mix(vec3(1.0), vec3(0.0, 0.66, 0.93), cover(fc, 0));
    col *= mix(vec3(1.0), vec3(0.92, 0.0, 0.55), cover(fc, 1));
    col *= mix(vec3(1.0), vec3(1.0, 0.93, 0.0), cover(fc, 2));
    col *= mix(vec3(1.0), vec3(0.11), cover(fc, 3));
  } else {
    col = mix(uPaper, uInk, cover(fc, 0));
  }
  o = vec4(col, 1.0);
}`;

const hex = c => {
  const m = /^#?([\da-f]{6})$/i.exec(c || '');
  const n = m ? parseInt(m[1], 16) : 0;
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};
const DEG = Math.PI / 180;
export const DOT_SHAPES = {circle: 'Circle', square: 'Square', diamond: 'Diamond', line: 'Line'};
const SHAPE_INDEX = {circle: 0, square: 1, diamond: 2, line: 3};
const MODE_INDEX = {rgb: 0, cmyk: 1, mono: 2};

/** Screen angles (radians) and pixel offsets per channel for a config at a given pitch. */
export function screens(cfg, pitchPx) {
  const base = cfg.angle * DEG;
  if (cfg.mode === 'rgb') {
    const angles = [0, 1, 2, 3].map(i => base + Math.min(i, 2) * cfg.spread * DEG);
    const offs = [90, 210, 330, 0].map((a, i) => (i < 3 ? [Math.cos(a * DEG) * cfg.split * pitchPx, Math.sin(a * DEG) * cfg.split * pitchPx] : [0, 0]));
    return {angles, offs};
  }
  if (cfg.mode === 'cmyk') return {angles: [15, 75, 0, 45].map(a => base + a * DEG), offs: [[0, 0], [0, 0], [0, 0], [0, 0]]};
  return {angles: [base + 45 * DEG, 0, 0, 0], offs: [[0, 0], [0, 0], [0, 0], [0, 0]]};
}

/** Pitch in output pixels: the setting is for a frame 1080 px on its short side. */
export const pitchFor = (cfg, w, h) => Math.max(2, (cfg.pitch * Math.min(w, h)) / 1080);

export function createHalftone(canvas, {preserve = false} = {}) {
  const gl = canvas.getContext('webgl2', {antialias: false, preserveDrawingBuffer: preserve, premultipliedAlpha: false});
  if (!gl) throw new Error('WebGL2 is not available');
  const sh = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader failed');
    return s;
  };
  let prog, U, tex;
  const build = () => {
    prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) || 'link failed');
    U = {};
    for (const n of ['uSrc', 'uRes', 'uPitch', 'uDot', 'uAA', 'uGcr', 'uShape', 'uMode', 'uInvert', 'uShowSrc', 'uAngles', 'uOff', 'uBg', 'uPaper', 'uInk']) U[n] = gl.getUniformLocation(prog, n);
    tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  };
  build();
  const r = {
    gl,
    get lost() { return gl.isContextLost(); },
    /** Restore after a context loss. */
    rebuild() { build(); },
    /** Draw `source` (a canvas) through the halftone at the canvas's current size. */
    render(source, cfg) {
      const W = canvas.width, H = canvas.height;
      gl.viewport(0, 0, W, H);
      gl.useProgram(prog);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      const pitch = pitchFor(cfg, W, H);
      const {angles, offs} = screens(cfg, pitch);
      gl.uniform1i(U.uSrc, 0);
      gl.uniform2f(U.uRes, W, H);
      gl.uniform1f(U.uPitch, pitch);
      gl.uniform1f(U.uDot, cfg.dot);
      gl.uniform1f(U.uAA, 0.75);
      gl.uniform1f(U.uGcr, cfg.gcr);
      gl.uniform1i(U.uShape, SHAPE_INDEX[cfg.dotShape] ?? 0);
      gl.uniform1i(U.uMode, MODE_INDEX[cfg.mode] ?? 0);
      gl.uniform1i(U.uInvert, cfg.invert ? 1 : 0);
      gl.uniform1i(U.uShowSrc, cfg.showSource ? 1 : 0);
      gl.uniform4f(U.uAngles, ...angles);
      gl.uniform2fv(U.uOff, offs.flat());
      gl.uniform3f(U.uBg, ...hex(cfg.background));
      gl.uniform3f(U.uPaper, ...hex(cfg.paper));
      gl.uniform3f(U.uInk, ...hex(cfg.ink));
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    dispose() { gl.getExtension('WEBGL_lose_context')?.loseContext(); },
  };
  return r;
}
