// The WebGL2 side of LEELA: compile the shaders once, then draw any config at any
// time. No vertex buffers. Plain gradients (and glass) are one draw; pixelate and
// ASCII draw the gradient once per cell into a small texture, then draw the frame
// from it.
import {VERT, FRAG, FRAG_FX, GLYPHS} from './shader.js';
import {SHAPES, MOTIONS, MAX_STOPS, MAX_POINTS, cleanConfig, effectCell} from './config.js';
import {parseColor} from './color.js';

const CELL_EFFECTS = {pixelate: 1, ascii: 2};

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
  const program = frag => {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, frag));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost()) throw new Error('LEELA shader: ' + gl.getProgramInfoLog(p));
    const loc = {};
    return {p, u: name => (name in loc ? loc[name] : (loc[name] = gl.getUniformLocation(p, name)))};
  };
  const main = program(FRAG), fx = program(FRAG_FX);
  const vao = gl.createVertexArray();

  // The cell texture (one gradient sample per cell) and its framebuffer.
  const cellTex = gl.createTexture(), cellFbo = gl.createFramebuffer();
  gl.bindTexture(gl.TEXTURE_2D, cellTex);
  for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
  let cellSize = '';
  const cellTarget = (w, h) => {
    if (cellSize === `${w}x${h}`) return;
    gl.bindTexture(gl.TEXTURE_2D, cellTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, cellFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, cellTex, 0);
    cellSize = `${w}x${h}`;
  };

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

  /** The gradient pass. `cell` > 0 draws one sample per cell into the cell texture. */
  function drawGradient(P, time, fullW, fullH, origin, cell, glass, rib, hover) {
    const {cfg, stops, points, pointColors, background} = P;
    const {u} = main;
    gl.useProgram(main.p);
    gl.uniform2f(u('uRes'), fullW, fullH);
    gl.uniform2f(u('uOrigin'), origin[0], origin[1]);
    gl.uniform1f(u('uCell'), cell);
    gl.uniform1f(u('uGlass'), glass);
    gl.uniform1f(u('uRib'), rib);
    gl.uniform3f(u('uHover'), hover ? hover[0] : 0, hover ? hover[1] : 0, hover ? hover[2] : 0);
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
  }

  return {
    canvas,
    gl,
    get lost() { return gl.isContextLost(); },

    /**
     * Draw `config` at `time` seconds into the whole canvas. With `tile`
     * ({x, y, width, height} of a w×h frame, y down) the canvas holds just that part
     * of a bigger frame; the pieces line up exactly, noise, grain and cells included.
     * Effects other than glass, pixelate and ASCII are left to the caller. `hover`
     * ([x, y, strength], x and y 0..1 across and down, strength + pull in / − push away)
     * bends the picture around a pointer; leave it out for exports.
     */
    render(config, time = 0, tile = null, hover = null) {
      const P = prepare(config), cfg = P.cfg;
      const w = canvas.width, h = canvas.height;
      const fullW = tile ? tile.width : w, fullH = tile ? tile.height : h;
      const origin = [tile ? tile.x : 0, tile ? fullH - tile.y - h : 0];
      const cell = effectCell(cfg, fullW, fullH);
      const fxKind = CELL_EFFECTS[cfg.effect] || 0;

      if (!fxKind) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, w, h);
        const glass = cfg.effect === 'glass' ? cfg.effectAmount : 0;
        drawGradient(P, time, fullW, fullH, origin, 0, glass, cell, hover);
        return;
      }
      // Pass 1: one gradient sample per cell, for the whole frame (tiles share it).
      const cw = Math.ceil(fullW / cell), ch = Math.ceil(fullH / cell);
      cellTarget(cw, ch);
      gl.bindFramebuffer(gl.FRAMEBUFFER, cellFbo);
      gl.viewport(0, 0, cw, ch);
      drawGradient(P, time, fullW, fullH, [0, 0], cell, 0, 0, hover);
      // Pass 2: the effect, per pixel.
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, w, h);
      const {u} = fx;
      gl.useProgram(fx.p);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, cellTex);
      gl.uniform1i(u('uCells'), 0);
      gl.uniform2f(u('uRes'), fullW, fullH);
      gl.uniform2f(u('uOrigin'), origin[0], origin[1]);
      gl.uniform1f(u('uCell'), cell);
      gl.uniform1i(u('uEffect'), fxKind);
      gl.uniform3fv(u('uBackground'), P.background);
      gl.uniform1f(u('uAmount'), cfg.effectAmount);
      gl.uniform1uiv(u('uGlyph'), Uint32Array.from(GLYPHS));
      gl.uniform1f(u('uGrain'), cfg.grain);
      gl.uniform1f(u('uTime'), time);
      gl.uniform1f(u('uLoop'), cfg.loop);
      gl.uniform1ui(u('uSeed'), cfg.seed >>> 0);
      gl.uniform1i(u('uMotion'), MOTIONS.indexOf(cfg.motion));
      gl.bindVertexArray(vao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },

    dispose() {
      gl.deleteProgram(main.p);
      gl.deleteProgram(fx.p);
      gl.deleteTexture(cellTex);
      gl.deleteFramebuffer(cellFbo);
      gl.deleteVertexArray(vao);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    },
  };
}
