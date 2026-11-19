// BLOOM's WebGL2 renderer: a three-stop backdrop, the plant's flat-coloured triangles
// (4× MSAA), then a depth-of-field pass that gathers with a per-pixel blur radius.

const VS_FULL = `#version 300 es
out vec2 vUv;
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

// Backdrop: three stops top to bottom, blended in Oklab, dithered against banding.
const FS_BG = `#version 300 es
precision highp float;
in vec2 vUv;
uniform vec3 uC0, uC1, uC2;
out vec4 o;
vec3 lin(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
vec3 gam(vec3 c) { c = clamp(c, 0.0, 1.0); return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
vec3 toLab(vec3 c) {
  vec3 lms = mat3(0.4122214708, 0.2119034982, 0.0883024619, 0.5363325363, 0.6806995451, 0.2817188376, 0.0514459929, 0.1073969566, 0.6299787005) * c;
  lms = pow(max(lms, 0.0), vec3(1.0 / 3.0));
  return mat3(0.2104542553, 1.9779984951, 0.0259040371, 0.793617785, -2.428592205, 0.7827717662, -0.0040720468, 0.4505937099, -0.808675766) * lms;
}
vec3 fromLab(vec3 L) {
  vec3 lms = mat3(1.0, 1.0, 1.0, 0.3963377774, -0.1055613458, -0.0894841775, 0.2158037573, -0.0638541728, -1.291485548) * L;
  lms = lms * lms * lms;
  return mat3(4.0767416621, -1.2684380046, -0.0041960863, -3.3077115913, 2.6097574011, -0.7034186147, 0.2309699292, -0.3413193965, 1.707614701) * lms;
}
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  float t = 1.0 - vUv.y;
  vec3 a = toLab(lin(uC0)), b = toLab(lin(uC1)), c = toLab(lin(uC2));
  vec3 lab = t < 0.5 ? mix(a, b, smoothstep(0.0, 1.0, t * 2.0)) : mix(b, c, smoothstep(0.0, 1.0, t * 2.0 - 1.0));
  o = vec4(gam(fromLab(lab)) + (hash(gl_FragCoord.xy) - 0.5) / 255.0, 1.0);
}`;

const VS_MESH = `#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aCol;
uniform mat4 uVP;
out vec3 vCol;
void main() { vCol = aCol; gl_Position = uVP * vec4(aPos, 1.0); }`;

const FS_MESH = `#version 300 es
precision mediump float;
in vec3 vCol;
out vec4 o;
void main() { o = vec4(vCol, 1.0); }`;

// Depth of field by gathering: each tap counts if its own blur reaches this pixel, and
// taps behind this pixel only count when this pixel is blurred too (so sharp petals
// keep their edges against a blurred background).
const FS_DOF = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uColor, uDepth;
uniform vec2 uRes;
uniform float uNear, uFar, uFocus, uAmount, uMaxR;
out vec4 o;
float linZ(vec2 uv) {
  float d = texture(uDepth, uv).r * 2.0 - 1.0;
  return 2.0 * uNear * uFar / (uFar + uNear - d * (uFar - uNear));
}
float coc(float z) { return min(uMaxR, uAmount * abs(z - uFocus) / z); }
void main() {
  vec4 c0 = texture(uColor, vUv);
  if (uMaxR < 0.5) { o = c0; return; }
  float z0 = linZ(vUv), r0 = coc(z0);
  vec3 sum = c0.rgb; float wsum = 1.0;
  const int N = 64;
  for (int i = 0; i < N; i++) {
    float r = uMaxR * sqrt((float(i) + 0.5) / float(N));
    float a = float(i) * 2.39996323;
    vec2 uv = vUv + vec2(cos(a), sin(a)) * r / uRes;
    float z = linZ(uv), rs = coc(z);
    float w = clamp(rs - r + 1.0, 0.0, 1.0);
    if (z > z0) w *= clamp(r0 - r + 1.0, 0.0, 1.0);
    sum += texture(uColor, uv).rgb * w; wsum += w;
  }
  o = vec4(sum / wsum, 1.0);
}`;

function compile(gl, vs, fs) {
  const prog = gl.createProgram();
  for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) || 'shader error');
    gl.attachShader(prog, sh);
  }
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) || 'link error');
  const u = {};
  const n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const name = gl.getActiveUniform(prog, i).name; u[name] = gl.getUniformLocation(prog, name); }
  return {prog, u};
}

/** A renderer bound to one canvas. Throws when WebGL2 isn't there. */
export function createBloomRenderer(canvas, {preserve = false} = {}) {
  const gl = canvas.getContext('webgl2', {antialias: false, alpha: false, depth: false, preserveDrawingBuffer: preserve});
  if (!gl) throw new Error('WebGL2 unavailable');
  const bg = compile(gl, VS_FULL, FS_BG), mesh = compile(gl, VS_MESH, FS_MESH), dof = compile(gl, VS_FULL, FS_DOF);
  const empty = gl.createVertexArray();
  const vao = gl.createVertexArray(), vbo = gl.createBuffer();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
  gl.bindVertexArray(null);
  let vboSize = 0;
  const samples = Math.min(4, gl.getParameter(gl.MAX_SAMPLES) || 0);

  let w = 0, h = 0, msFbo, msColor, msDepth, rFbo, rColor, rDepth;
  function targets() {
    if (w === canvas.width && h === canvas.height) return;
    w = canvas.width; h = canvas.height;
    [msFbo, rFbo].forEach(f => f && gl.deleteFramebuffer(f));
    [msColor, msDepth].forEach(r => r && gl.deleteRenderbuffer(r));
    [rColor, rDepth].forEach(t => t && gl.deleteTexture(t));
    msFbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, msFbo);
    msColor = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, msColor);
    gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.RGBA8, w, h);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, msColor);
    msDepth = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, msDepth);
    gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.DEPTH_COMPONENT24, w, h);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, msDepth);
    const tex = (internal, format, type) => {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, null);
      for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
      return t;
    };
    rColor = tex(gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE);
    rDepth = tex(gl.DEPTH_COMPONENT24, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT);
    rFbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, rFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, rColor, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, rDepth, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  const r = {
    lost: false,
    /**
     * f: {mesh (Mesh), viewProj (Float32Array 16), background [3 sRGB triples],
     *     near, far, focus (linear depth), blur (0..1)}
     */
    render(f) {
      if (gl.isContextLost()) { r.lost = true; return; }
      targets();
      gl.bindFramebuffer(gl.FRAMEBUFFER, msFbo);
      gl.viewport(0, 0, w, h);
      gl.disable(gl.DEPTH_TEST);
      gl.depthMask(false);
      gl.useProgram(bg.prog);
      gl.uniform3fv(bg.u.uC0, f.background[0]); gl.uniform3fv(bg.u.uC1, f.background[1]); gl.uniform3fv(bg.u.uC2, f.background[2]);
      gl.bindVertexArray(empty);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      gl.depthMask(true);
      gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      if (f.mesh.count) {
        gl.useProgram(mesh.prog);
        gl.uniformMatrix4fv(mesh.u.uVP, false, f.viewProj);
        gl.bindVertexArray(vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
        const data = f.mesh.f.subarray(0, f.mesh.n);
        if (data.byteLength > vboSize) { vboSize = data.byteLength * 1.5; gl.bufferData(gl.ARRAY_BUFFER, vboSize, gl.DYNAMIC_DRAW); }
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, data);
        gl.drawArrays(gl.TRIANGLES, 0, f.mesh.count);
      }
      gl.disable(gl.DEPTH_TEST);

      // Resolve the MSAA colour and depth, then the blur pass to the screen.
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, msFbo);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, rFbo);
      gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.COLOR_BUFFER_BIT, gl.LINEAR);
      gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.DEPTH_BUFFER_BIT, gl.NEAREST);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, w, h);
      gl.useProgram(dof.prog);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, rColor);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, rDepth);
      gl.uniform1i(dof.u.uColor, 0); gl.uniform1i(dof.u.uDepth, 1);
      const maxR = f.blur * 0.035 * Math.min(w, h * 1.4);
      gl.uniform2f(dof.u.uRes, w, h);
      gl.uniform1f(dof.u.uNear, f.near); gl.uniform1f(dof.u.uFar, f.far);
      gl.uniform1f(dof.u.uFocus, f.focus); gl.uniform1f(dof.u.uAmount, maxR * 3); gl.uniform1f(dof.u.uMaxR, maxR);
      gl.bindVertexArray(empty);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindVertexArray(null);
    },
    dispose() {
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    },
  };
  return r;
}

/* ---------- camera ---------- */
function lookAt(eye, target, up) {
  const z = norm([eye[0] - target[0], eye[1] - target[1], eye[2] - target[2]]);
  const x = norm(cross(up, z)), y = cross(z, x);
  return {x, y, z, m: [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1]};
}
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
function perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
  return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0];
}
function mat4mul(a, b) {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
    o[c * 4 + r] = s;
  }
  return o;
}

/**
 * Frame the finished plant for an aspect ratio, with the user's zoom, orbit, height and
 * a slow drift over time. Returns what the mesher and renderer need.
 */
export function frameCamera(plant, cfg, t, aspect) {
  const fov = 32 * Math.PI / 180, near = 0.05, far = 60;
  const lo = plant.lo, hi = plant.hi;
  const center = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
  const halfH = (hi[1] - lo[1]) / 2, halfW = Math.max(hi[0] - lo[0], hi[2] - lo[2]) / 2;
  const tanH = Math.tan(fov / 2);
  // Fit the height fully; let wide bouquets run a little off the sides rather than shrink.
  let dist = Math.max(halfH / tanH * 1.06, halfW / (tanH * aspect) * 0.8) + halfW * 0.15;
  // Zoom closes in on a point high in the plant, where the flowers are.
  const zoom = Math.max(0.3, cfg.zoom);
  dist /= zoom;
  // Sit the stems on the bottom edge of the frame (a wide plant leaves room above,
  // not below), then let zoom move the view up toward the flowers.
  const halfView = dist * tanH;
  const baseY = lo[1] + halfView;
  const up = Math.min(1, Math.max(0, (zoom - 1) * 1.1)); // 0 at zoom 1, the top of the plant by about 2×
  const target = [center[0], baseY + Math.max(0, hi[1] - halfView - baseY) * up, center[2]];
  const drift = cfg.drift;
  const az = (cfg.orbit + drift * 22 * Math.sin(t * 0.13)) * Math.PI / 180;
  const el = (cfg.elevation + drift * 4 * Math.sin(t * 0.09 + 1)) * Math.PI / 180;
  dist *= 1 - drift * 0.08 * (0.5 - 0.5 * Math.cos(Math.min(t, 20) * Math.PI / 20));
  const eye = [target[0] + Math.sin(az) * Math.cos(el) * dist, target[1] + Math.sin(el) * dist, target[2] + Math.cos(az) * Math.cos(el) * dist];
  const view = lookAt(eye, target, [0, 1, 0]);
  const viewProj = mat4mul(perspective(fov, aspect, near, far), view.m);
  // Focus: 0 = the nearest flower is sharp, 1 = the furthest.
  let dmin = Infinity, dmax = 0;
  for (const h of plant.heads) {
    const p = h.curve.pts[h.curve.pts.length - 1];
    const d = Math.hypot(p[0] - eye[0], p[1] - eye[1], p[2] - eye[2]);
    dmin = Math.min(dmin, d); dmax = Math.max(dmax, d);
  }
  if (!isFinite(dmin)) { dmin = dist; dmax = dist; }
  const focus = Math.max(near * 2, dmin + (dmax - dmin) * cfg.focus);
  return {eye, right: view.x, up: view.y, viewProj, near, far, focus};
}
