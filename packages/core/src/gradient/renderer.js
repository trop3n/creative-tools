// The WebGL2 side of LEELA: compile the shader once, then draw any config at any
// time. No vertex buffers; one draw call per frame.
import {VERT, FRAG} from './shader.js';
import {SHAPES, MOTIONS, MAX_STOPS, MAX_POINTS, cleanConfig} from './config.js';
import {parseColor} from './color.js';

/**
 * Create a renderer on a canvas (one is made if omitted). Returns null when WebGL2
 * isn't available. Size the canvas (width/height in device pixels) before render().
 */
export function createGradientRenderer(canvas) {
  canvas = canvas || document.createElement('canvas');
  const gl = canvas.getContext('webgl2', {alpha: false, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: true});
  if (!gl) return null;

  const compile = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) throw new Error('LEELA shader: ' + gl.getShaderInfoLog(s));
    return s;
  };
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS) && !gl.isContextLost()) throw new Error('LEELA shader: ' + gl.getProgramInfoLog(prog));
  const vao = gl.createVertexArray();
  const loc = {};
  const u = name => (name in loc ? loc[name] : (loc[name] = gl.getUniformLocation(prog, name)));

  // Colors parse once per config, not every frame.
  let lastConfig = null, prepared = null;
  const prepare = raw => {
    if (raw === lastConfig && prepared) return prepared;
    const cfg = cleanConfig(raw);
    const stops = new Float32Array(MAX_STOPS * 3), points = new Float32Array(MAX_POINTS * 2), pointColors = new Float32Array(MAX_POINTS * 3);
    cfg.palette.forEach((c, i) => stops.set(parseColor(c), i * 3));
    cfg.mesh.forEach((p, i) => { points.set([p.x, p.y], i * 2); pointColors.set(parseColor(p.color), i * 3); });
    lastConfig = raw;
    prepared = {cfg, stops, points, pointColors, background: parseColor(cfg.background)};
    return prepared;
  };

  return {
    canvas,
    gl,
    get lost() { return gl.isContextLost(); },

    /**
     * Draw `config` at `time` seconds into the whole canvas. With `tile`
     * ({x, y, width, height} of a w×h frame, y down) the canvas holds just that part
     * of a bigger frame; the pieces line up exactly, noise and grain included.
     */
    render(config, time = 0, tile = null) {
      const {cfg, stops, points, pointColors, background} = prepare(config);
      const w = canvas.width, h = canvas.height;
      const fullW = tile ? tile.width : w, fullH = tile ? tile.height : h;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, w, h);
      gl.useProgram(prog);
      gl.uniform2f(u('uRes'), fullW, fullH);
      gl.uniform2f(u('uOrigin'), tile ? tile.x : 0, tile ? fullH - tile.y - h : 0);
      gl.uniform1f(u('uTime'), time);
      gl.uniform1ui(u('uSeed'), cfg.seed >>> 0);
      gl.uniform1i(u('uShape'), SHAPES.indexOf(cfg.shape));
      gl.uniform2f(u('uCenter'), cfg.center[0], cfg.center[1]);
      gl.uniform2f(u('uSize'), cfg.size[0], cfg.size[1]);
      gl.uniform1f(u('uRound'), cfg.roundness);
      gl.uniform1f(u('uSoft'), cfg.softness);
      gl.uniform1f(u('uRotation'), cfg.rotation);
      gl.uniform1f(u('uRamp'), cfg.ramp);
      gl.uniform1f(u('uAngle'), cfg.angle);
      gl.uniform1f(u('uWarp'), cfg.warp);
      gl.uniform1f(u('uWarpScale'), cfg.warpScale);
      gl.uniform1f(u('uGrain'), cfg.grain);
      gl.uniform1f(u('uSpeed'), cfg.speed);
      gl.uniform1f(u('uLoop'), cfg.loop);
      gl.uniform1i(u('uMotion'), MOTIONS.indexOf(cfg.motion));
      gl.uniform3fv(u('uStops'), stops);
      gl.uniform1i(u('uStopCount'), cfg.palette.length);
      gl.uniform3fv(u('uBackground'), background);
      gl.uniform2fv(u('uPoints'), points);
      gl.uniform3fv(u('uPointColors'), pointColors);
      gl.uniform1i(u('uPointCount'), cfg.mesh.length);
      gl.bindVertexArray(vao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },

    dispose() {
      gl.deleteProgram(prog);
      gl.deleteVertexArray(vao);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    },
  };
}
