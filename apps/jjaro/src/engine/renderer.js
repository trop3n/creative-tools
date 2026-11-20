// JJARO's WebGL2 renderer: a radial studio backdrop, a soft shadow on the floor when
// there is one, then the sheet in foil (see foil.js).
import {FS_FOIL} from './foil.js';
import {Surface} from './surface.js';

const VS_FULL = `#version 300 es
out vec2 vUv;
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

// Backdrop: a soft pool of light behind the sheet, dithered against banding.
const FS_BG = `#version 300 es
precision highp float;
in vec2 vUv;
uniform vec3 uInner, uOuter;
uniform float uAspect;
out vec4 o;
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec2 p = (vUv - vec2(0.5, 0.56)) * vec2(uAspect, 1.0);
  float t = smoothstep(0.0, 0.85, length(p) / max(1.0, uAspect * 0.8));
  o = vec4(mix(uInner, uOuter, t) + (hash(gl_FragCoord.xy) - 0.5) / 255.0, 1.0);
}`;

// Floor shadow: a quad on the floor, darkest under the sheet's footprint.
const VS_FLOOR = `#version 300 es
uniform mat4 uVP;
uniform vec3 uCenter;
uniform float uY, uR;
out vec2 vP;
void main() {
  vec2 c = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2) * 2.0 - 1.0; // a big triangle
  vP = c * 2.0;
  gl_Position = uVP * vec4(uCenter.x + vP.x * uR, uY, uCenter.z + vP.y * uR, 1.0);
}`;
const FS_FLOOR = `#version 300 es
precision highp float;
in vec2 vP;
uniform float uStrength;
out vec4 o;
void main() {
  float a = uStrength * exp(-2.2 * dot(vP, vP));
  o = vec4(0.0, 0.0, 0.0, a);
}`;

const VS_SHEET = `#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNrm;
layout(location = 2) in vec2 aUv;
layout(location = 3) in vec3 aTan;
uniform mat4 uVP;
out vec3 vPos, vNrm, vTan;
out vec2 vUv;
void main() { vPos = aPos; vNrm = aNrm; vTan = aTan; vUv = aUv; gl_Position = uVP * vec4(aPos, 1.0); }`;


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
export function createRenderer(canvas, {preserve = false} = {}) {
  const gl = canvas.getContext('webgl2', {antialias: true, alpha: false, preserveDrawingBuffer: preserve});
  if (!gl) throw new Error('WebGL2 unavailable');
  const bg = compile(gl, VS_FULL, FS_BG), floor = compile(gl, VS_FLOOR, FS_FLOOR), sheet = compile(gl, VS_SHEET, FS_FOIL);
  const empty = gl.createVertexArray();
  const vao = gl.createVertexArray(), dyn = gl.createBuffer(), uvs = gl.createBuffer(), ibo = gl.createBuffer();
  let cloth = null, surf = null, interleaved = null;
  const artTex = gl.createTexture();
  let artSource = null;
  /** Upload the artwork when it changes, with mipmaps so it stays smooth far away. */
  function bindArt(src) {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, artTex);
    if (src === artSource) return;
    artSource = src;
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, src);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  /** Upload what doesn't change for a sheet: its UVs and triangles. */
  function bind(c) {
    cloth = c;
    surf = new Surface(c);
    interleaved = new Float32Array(surf.N * 9);
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, dyn);
    gl.bufferData(gl.ARRAY_BUFFER, interleaved.byteLength, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 36, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 36, 12);
    gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 3, gl.FLOAT, false, 36, 24);
    gl.bindBuffer(gl.ARRAY_BUFFER, uvs);
    gl.bufferData(gl.ARRAY_BUFFER, surf.uv, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, surf.index, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
  }

  const r = {
    lost: false,
    /**
     * f: {cloth, cam (from frameCamera), background [[sRGB] center, [sRGB] edge],
     *     foil: {tint (linear), env [[linear] top, [linear] bottom], rainbow, spread, spacing (µm), scale, angle (rad), seed,
     *            pattern (index), lights, lightDirs (Float32Array), lightSize},
     *     print: {mode (index; 0 none), art {canvas, alpha, aspect}, size, invert, paper (linear), ink}}
     */
    render(f) {
      if (gl.isContextLost()) { r.lost = true; return; }
      const w = canvas.width, h = canvas.height, c = f.cloth;
      if (c !== cloth) bind(c);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, w, h);
      gl.disable(gl.DEPTH_TEST);
      gl.depthMask(false);
      gl.useProgram(bg.prog);
      gl.uniform3fv(bg.u.uInner, f.background[0]); gl.uniform3fv(bg.u.uOuter, f.background[1]);
      gl.uniform1f(bg.u.uAspect, w / h);
      gl.bindVertexArray(empty);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      if (c.scene.floor !== null) {
        // Centre the shadow on the sheet's footprint.
        let x = 0, z = 0, lo = Infinity, hi = -Infinity;
        for (let j = 0; j < c.N * 3; j += 3) { x += c.pos[j]; z += c.pos[j + 2]; lo = Math.min(lo, c.pos[j]); hi = Math.max(hi, c.pos[j]); }
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.useProgram(floor.prog);
        gl.uniformMatrix4fv(floor.u.uVP, false, f.cam.viewProj);
        gl.uniform3f(floor.u.uCenter, x / c.N, 0, z / c.N);
        gl.uniform1f(floor.u.uY, c.scene.floor);
        gl.uniform1f(floor.u.uR, Math.max(0.6, (hi - lo) * 0.55));
        gl.uniform1f(floor.u.uStrength, 0.45);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.disable(gl.BLEND);
      }

      surf.update();
      const {pos, nrm, tan} = surf;
      for (let i = 0; i < surf.N; i++) {
        for (let k = 0; k < 3; k++) {
          interleaved[i * 9 + k] = pos[i * 3 + k];
          interleaved[i * 9 + 3 + k] = nrm[i * 3 + k];
          interleaved[i * 9 + 6 + k] = tan[i * 3 + k];
        }
      }
      gl.depthMask(true);
      gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);
      gl.useProgram(sheet.prog);
      gl.uniformMatrix4fv(sheet.u.uVP, false, f.cam.viewProj);
      gl.uniform3fv(sheet.u.uEye, f.cam.eye);
      gl.uniform3fv(sheet.u.uFront, f.cam.forward.map(v => -v));
      const m = f.foil, u = sheet.u;
      gl.uniform3fv(u.uTint, m.tint);
      gl.uniform3fv(u.uEnvTop, m.env[0]); gl.uniform3fv(u.uEnvBottom, m.env[1]);
      gl.uniform1f(u.uRainbow, m.rainbow); gl.uniform1f(u.uSpread, m.spread); gl.uniform1f(u.uSpacing, m.spacing);
      gl.uniform1f(u.uScale, m.scale); gl.uniform1f(u.uAngle, m.angle); gl.uniform1f(u.uSeed, m.seed);
      gl.uniform1i(u.uPattern, m.pattern); gl.uniform1i(u.uLights, m.lights);
      gl.uniform3fv(u['uLightDir[0]'], m.lightDirs); gl.uniform1f(u.uLightSize, m.lightSize);
      const p = f.print;
      gl.uniform1i(u.uPrint, p.art ? p.mode : 0);
      if (p.art) {
        bindArt(p.art.canvas);
        gl.uniform1i(u.uArt, 0);
        gl.uniform1f(u.uArtAspect, p.art.aspect); gl.uniform1f(u.uArtSize, p.size);
        gl.uniform1f(u.uArtAlpha, p.art.alpha ? 1 : 0); gl.uniform1f(u.uInvert, p.invert ? 1 : 0);
        gl.uniform3fv(u.uPaper, p.paper); gl.uniform1f(u.uInk, p.ink);
      }
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, dyn);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, interleaved);
      gl.drawElements(gl.TRIANGLES, surf.index.length, gl.UNSIGNED_INT, 0);
      gl.bindVertexArray(null);
      gl.disable(gl.DEPTH_TEST);
    },
    dispose() { gl.getExtension('WEBGL_lose_context')?.loseContext(); },
  };
  return r;
}

/* ---------- camera ---------- */
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
function mat4mul(a, b) {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
    o[c * 4 + r] = s;
  }
  return o;
}

const FOV = 30 * Math.PI / 180;
/** Frame the scene for an aspect ratio with the user's orbit, tilt and zoom. */
export function frameCamera(cfg, scene, aspect) {
  const tanH = Math.tan(FOV / 2), {target, half} = scene;
  const dist = Math.max(half / tanH, half / (tanH * aspect)) / Math.max(0.3, cfg.zoom);
  const az = cfg.orbit * Math.PI / 180, el = Math.min(80, cfg.elevation + scene.lift) * Math.PI / 180;
  const eye = [target[0] + Math.sin(az) * Math.cos(el) * dist, target[1] + Math.sin(el) * dist, target[2] + Math.cos(az) * Math.cos(el) * dist];
  const z = norm([eye[0] - target[0], eye[1] - target[1], eye[2] - target[2]]);
  const x = norm(cross([0, 1, 0], z)), y = cross(z, x);
  const view = [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1];
  const near = 0.05, far = 60, f = 1 / tanH, nf = 1 / (near - far);
  const proj = [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0];
  return {eye, right: x, up: y, forward: [-z[0], -z[1], -z[2]], viewProj: mat4mul(proj, view), tanH, aspect};
}

/** The ray through a point on screen, x and y in -1..1 (y up). */
export function screenRay(cam, nx, ny) {
  const {right: r, up: u, forward: f, tanH, aspect} = cam;
  const sx = nx * tanH * aspect, sy = ny * tanH;
  return {o: cam.eye, d: norm([f[0] + r[0] * sx + u[0] * sy, f[1] + r[1] * sx + u[1] * sy, f[2] + r[2] * sx + u[2] * sy])};
}

/**
 * The particle under a screen point: the nearest to the camera among those within
 * `radius` (in -1..1 units of the screen's height) of it, or -1.
 */
export function pickParticle(cam, pos, nx, ny, radius) {
  const m = cam.viewProj;
  let best = -1, bestDepth = Infinity;
  for (let i = 0, n = pos.length / 3; i < n; i++) {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
    if (cw <= 0) continue;
    const px = (m[0] * x + m[4] * y + m[8] * z + m[12]) / cw, py = (m[1] * x + m[5] * y + m[9] * z + m[13]) / cw;
    if (Math.hypot((px - nx) * cam.aspect, py - ny) > radius) continue;
    if (cw < bestDepth) { bestDepth = cw; best = i; }
  }
  return best;
}

/** Where a ray meets the plane through `p` facing the camera. */
export function onViewPlane(cam, ray, p) {
  const f = cam.forward;
  const t = dot([p[0] - ray.o[0], p[1] - ray.o[1], p[2] - ray.o[2]], f) / (dot(ray.d, f) || 1e-6);
  return [ray.o[0] + ray.d[0] * t, ray.o[1] + ray.d[1] * t, ray.o[2] + ray.d[2] * t];
}
