// WebGL2 path for the pattern styles. These compare each pixel with a fixed field, so
// every cell is independent and a fragment shader can do the whole pipeline in one or
// two passes, straight from a video or image texture at its native size:
//
//   source → luminance → tone LUT → [blur, 3 box passes per axis] → nearest shrink
//          → compare with the field's cutoff → mask → paint in two colors
//
// The field itself is evaluated on the CPU (only when the style, its parameters, the
// size or the threshold change) as float32 cutoffs from fieldCutoffs(), so the shader's
// single compare matches the CPU engine exactly. Without blur the output is identical
// to ditherGray(); with blur the float32 box sums can differ in the last bit, which
// moves a handful of cells that sit right on a cutoff.
import {fieldCutoffs} from './fields.js';
import {STYLE_BY_ID, defaultParams} from './styles.js';
import {DEFAULT_SETTINGS, blockSize, toneTable} from './pipeline.js';

const VERT = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

// Shared by the luminance and cell passes: Pillow-rounded 601 luma, then the tone LUT.
const LUMA = `
uniform sampler2D uSrc;
uniform sampler2D uLut;
uniform ivec2 uSrcSize;
uniform bool uMirror;
float toned(ivec2 p) {
  if (uMirror) p.x = uSrcSize.x - 1 - p.x;
  ivec4 c = ivec4(round(texelFetch(uSrc, p, 0) * 255.0));
  int l = (c.r * 19595 + c.g * 38470 + c.b * 7471 + 32768) >> 16;
  return texelFetch(uLut, ivec2(l, 0), 0).r;
}`;

const FRAG_LUMA = `#version 300 es
precision highp float; precision highp int; precision highp sampler2D;
${LUMA}
out vec4 o;
void main() { o = vec4(toned(ivec2(gl_FragCoord.xy)), 0.0, 0.0, 1.0); }`;

const FRAG_BLUR = `#version 300 es
precision highp float; precision highp int; precision highp sampler2D;
uniform sampler2D uIn;
uniform ivec2 uDir;
uniform ivec2 uSize;
uniform int uR;
out vec4 o;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  float acc = 0.0;
  for (int i = -uR; i <= uR; i++) acc += texelFetch(uIn, clamp(p + uDir * i, ivec2(0), uSize - 1), 0).r;
  o = vec4(acc * (1.0 / float(2 * uR + 1)), 0.0, 0.0, 1.0);
}`;

// One fragment per cell. Picks the source pixel the same way resizeNearest does, in
// integers: floor((2x + 1) * sw / (2 dw)).
const FRAG_CELL = `#version 300 es
precision highp float; precision highp int; precision highp sampler2D;
${LUMA}
uniform sampler2D uBlurred;
uniform sampler2D uCut;
uniform bool uUseBlurred;
uniform bool uInvert;
uniform ivec2 uCells;
out vec4 o;
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  ivec2 s = min(uSrcSize - 1, ((2 * c + 1) * uSrcSize) / (2 * uCells));
  float v = uUseBlurred ? texelFetch(uBlurred, s, 0).r : toned(s);
  bool on = (v > texelFetch(uCut, c, 0).r) != uInvert;
  o = vec4(on ? 1.0 : 0.0, 0.0, 0.0, 1.0);
}`;

// Paint the mask onto the canvas, k device pixels per cell. Canvas rows run bottom-up.
const FRAG_SHOW = `#version 300 es
precision highp float; precision highp int; precision highp sampler2D;
uniform sampler2D uMask;
uniform int uK;
uniform int uRows;
uniform vec3 uInk;
uniform vec3 uPaper;
out vec4 o;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy) / uK;
  p.y = uRows - 1 - p.y;
  o = vec4(texelFetch(uMask, p, 0).r > 0.5 ? uPaper : uInk, 1.0);
}`;

const hexRGB = hex => {
  const n = parseInt(String(hex).replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};
const isToneIdentity = s => !s.brightness && !s.contrast && !s.midtones && !s.highlights && !s.shadows;
const sourceSize = el => [el.videoWidth || el.naturalWidth || el.width, el.videoHeight || el.naturalHeight || el.height];

/**
 * Create the GPU dither engine, or return null when WebGL2 isn't available.
 * @param {HTMLCanvasElement} [canvas] canvas to draw into (one is made if omitted)
 */
export function createGpuDither(canvas) {
  canvas = canvas || document.createElement('canvas');
  const gl = canvas.getContext('webgl2', {alpha: false, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: true});
  if (!gl) return null;
  const floatTargets = !!gl.getExtension('EXT_color_buffer_float');
  const maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE);

  /* ---------- programs ---------- */
  const compile = (type, src) => {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src); gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error('Shader: ' + gl.getShaderInfoLog(sh));
    return sh;
  };
  const vs = compile(gl.VERTEX_SHADER, VERT);
  const program = frag => {
    const p = gl.createProgram();
    gl.attachShader(p, vs); gl.attachShader(p, compile(gl.FRAGMENT_SHADER, frag)); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('Program: ' + gl.getProgramInfoLog(p));
    const loc = {};
    const u = name => (name in loc ? loc[name] : (loc[name] = gl.getUniformLocation(p, name)));
    return {p, u};
  };
  const P = {luma: program(FRAG_LUMA), blur: program(FRAG_BLUR), cell: program(FRAG_CELL), show: program(FRAG_SHOW)};
  const vao = gl.createVertexArray();

  /* ---------- textures and targets ---------- */
  const texture = () => {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    return t;
  };
  // Uploads and allocations happen on a spare unit, so they never disturb (or create a
  // feedback loop with) the units the passes sample from.
  const SPARE = 7;
  const scratch = name => { gl.activeTexture(gl.TEXTURE0 + SPARE); gl.bindTexture(gl.TEXTURE_2D, T[name]); };
  const T = {};
  for (const name of ['src', 'lut', 'cut', 'a', 'b', 'mask']) { gl.activeTexture(gl.TEXTURE0 + SPARE); T[name] = texture(); }
  const fbo = {a: gl.createFramebuffer(), b: gl.createFramebuffer(), mask: gl.createFramebuffer()};
  const sizes = {}; // texture name -> "w×h" it was allocated at

  /** (Re)allocate a render-target texture and attach it to its framebuffer. */
  const target = (name, w, h, internal, format, type) => {
    const key = `${w}x${h}`;
    if (sizes[name] === key) return;
    scratch(name);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo[name]);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, T[name], 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error(`GPU target ${name} is incomplete`);
    sizes[name] = key;
  };
  const upload = (name, w, h, data) => {
    scratch(name);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, w, h, 0, gl.RED, gl.FLOAT, data);
  };
  const bind = (unit, name) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, T[name]); };
  const draw = (fb, w, h) => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.viewport(0, 0, w, h);
    gl.bindVertexArray(vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  /* ---------- state ---------- */
  let sw = 0, sh = 0, mirror = false;
  let lutKey = '', cutKey = '';
  let out = null; // {w, h} of the last mask
  let generation = 0;

  const styleOf = settings => STYLE_BY_ID[settings.style];

  const engine = {
    canvas,
    gl,
    /** Bumped on every render(), so callers can tell whether a mask is still current. */
    get generation() { return generation; },

    /** True when this engine can render `settings` for a source of w×h. */
    supports(settings, w = sw, h = sh) {
      const style = styleOf(settings);
      if (!style || !style.field) return false;
      if (w > maxTex || h > maxTex) return false;
      if (Math.round(settings.blur || 0) >= 1 && !floatTargets) return false;
      return true;
    },

    /** Upload a frame: a canvas, image or video element (video at its native size). */
    setSource(el, mirrored = false) {
      [sw, sh] = sourceSize(el);
      mirror = mirrored;
      scratch('src');
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, el);
    },

    get sourceSize() { return [sw, sh]; },

    /** Run the pipeline into the mask. Returns {w, h} in cells. */
    render(settings) {
      if (!sw || !sh) throw new Error('No image loaded yet');
      const s = {...DEFAULT_SETTINGS, ...settings};
      const style = styleOf(s);
      if (!style || !style.field) throw new Error(`"${s.style}" has no GPU path`);
      const params = {...defaultParams(style), ...s.params};
      const {w, h} = blockSize(sw, sh, s.block);
      const threshold = (s.threshold / 100) * 255;

      // Tone LUT: identity when every slider is at zero, as on the CPU.
      const tone = isToneIdentity(s) ? 'id' : [s.brightness, s.contrast, s.midtones, s.highlights, s.shadows].join();
      if (tone !== lutKey) {
        const lut = tone === 'id' ? Float32Array.from({length: 256}, (_, i) => i) : toneTable(s);
        upload('lut', 256, 1, lut);
        lutKey = tone;
      }
      // Field cutoffs, one per cell.
      const ck = [style.id, JSON.stringify(params), w, h, threshold].join('|');
      if (ck !== cutKey) {
        upload('cut', w, h, fieldCutoffs(style.field(w, h, params), w, h, threshold));
        cutKey = ck;
      }

      const r = Math.round(s.blur || 0);
      const lumaUniforms = prog => {
        gl.uniform1i(prog.u('uSrc'), 0);
        gl.uniform1i(prog.u('uLut'), 1);
        gl.uniform2i(prog.u('uSrcSize'), sw, sh);
        gl.uniform1i(prog.u('uMirror'), mirror ? 1 : 0);
      };
      bind(0, 'src'); bind(1, 'lut');

      if (r >= 1) {
        target('a', sw, sh, gl.R32F, gl.RED, gl.FLOAT);
        target('b', sw, sh, gl.R32F, gl.RED, gl.FLOAT);
        gl.useProgram(P.luma.p);
        lumaUniforms(P.luma);
        draw(fbo.a, sw, sh);
        gl.useProgram(P.blur.p);
        gl.uniform1i(P.blur.u('uIn'), 2);
        gl.uniform2i(P.blur.u('uSize'), sw, sh);
        gl.uniform1i(P.blur.u('uR'), r);
        for (let k = 0; k < 3; k++) {
          bind(2, 'a'); gl.uniform2i(P.blur.u('uDir'), 1, 0); draw(fbo.b, sw, sh);
          bind(2, 'b'); gl.uniform2i(P.blur.u('uDir'), 0, 1); draw(fbo.a, sw, sh);
        }
        bind(2, 'a');
      } else bind(2, 'lut'); // unused this pass, but keep a complete texture on the unit

      target('mask', w, h, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE);
      bind(3, 'cut');
      gl.useProgram(P.cell.p);
      lumaUniforms(P.cell);
      gl.uniform1i(P.cell.u('uBlurred'), 2);
      gl.uniform1i(P.cell.u('uCut'), 3);
      gl.uniform1i(P.cell.u('uUseBlurred'), r >= 1 ? 1 : 0);
      gl.uniform1i(P.cell.u('uInvert'), s.invert ? 1 : 0);
      gl.uniform2i(P.cell.u('uCells'), w, h);
      draw(fbo.mask, w, h);

      out = {w, h};
      generation++;
      return {w, h};
    },

    /** Paint the last mask onto the canvas at k pixels per cell. */
    present(ink = '#000000', paper = '#ffffff', k = 1) {
      if (!out) return;
      const W = out.w * k, H = out.h * k;
      if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
      gl.useProgram(P.show.p);
      bind(0, 'mask');
      gl.uniform1i(P.show.u('uMask'), 0);
      gl.uniform1i(P.show.u('uK'), k);
      gl.uniform1i(P.show.u('uRows'), out.h);
      gl.uniform3fv(P.show.u('uInk'), hexRGB(ink));
      gl.uniform3fv(P.show.u('uPaper'), hexRGB(paper));
      draw(null, W, H);
    },

    /** Read the last mask back: Uint8Array of 0/255, row-major from the top. */
    readMask() {
      if (!out) return null;
      const {w, h} = out, px = new Uint8Array(w * h * 4), mask = new Uint8Array(w * h);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo.mask);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      for (let i = 0; i < mask.length; i++) mask[i] = px[i * 4] > 127 ? 255 : 0;
      return mask;
    },

    get lost() { return gl.isContextLost(); },
  };
  return engine;
}
