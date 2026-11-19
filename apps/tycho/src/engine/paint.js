// TYCHO's drawing layer. Modules draw unit shapes through 2D affine matrices, and a
// painter turns those calls into Canvas2D (live view, PNG, MP4) or SVG markup (SVG export).

/** Affine matrix [a, b, c, d, e, f]: x' = a·x + c·y + e, y' = b·x + d·y + f. */
export const mul = (m, n) => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];
export const T = (x, y) => [1, 0, 0, 1, x, y];
export const R = a => { const c = Math.cos(a), s = Math.sin(a); return [c, s, -s, c, 0, 0]; };
export const Sc = (x, y = x) => [x, 0, 0, y, 0, 0];
/** Compose left to right: chain(A, B, C) = A·B·C. */
export const chain = (...ms) => ms.reduce(mul);

/** Unit shapes, each fitting a 1 × 1 box centred on the origin, as SVG path data. */
export const SHAPE_PATHS = {
  square: 'M-0.5 -0.5H0.5V0.5H-0.5Z',
  circle: 'M0.5 0A0.5 0.5 0 1 0 -0.5 0A0.5 0.5 0 1 0 0.5 0Z',
  // A dome sitting on the bottom edge: rows of these make scallops.
  half: 'M-0.5 0.5A0.5 0.5 0 0 1 0.5 0.5Z',
  // A quarter disc pivoting on the bottom-left corner, reaching the top and right edges.
  quarter: 'M-0.5 0.5V-0.5A1 1 0 0 1 0.5 0.5Z',
  triangle: 'M0 -0.5L0.5 0.5H-0.5Z',
  // Lines are thin bars, so they fill like every other shape.
  line: 'M-0.5 -0.5H0.5V0.5H-0.5Z',
  // Rings are a stroked circle; the stroke width is in unit space.
  ring: 'M0.5 0A0.5 0.5 0 1 0 -0.5 0A0.5 0.5 0 1 0 0.5 0Z',
};

/** Draws to a Canvas2D context. `base` maps scene pixels to canvas pixels. */
export class CanvasPainter {
  constructor(ctx, base = [1, 0, 0, 1, 0, 0]) {
    this.ctx = ctx;
    this.base = base;
    this.paths = {};
    for (const k in SHAPE_PATHS) this.paths[k] = new Path2D(SHAPE_PATHS[k]);
  }
  setBase(base) { this.base = base; }
  rect(x, y, w, h, color) {
    const c = this.ctx;
    c.setTransform(...this.base);
    c.fillStyle = color;
    c.fillRect(x, y, w, h);
  }
  clipStart(x, y, w, h) {
    const c = this.ctx;
    c.save();
    c.setTransform(...this.base);
    c.beginPath();
    c.rect(x, y, w, h);
    c.clip();
  }
  clipEnd() { this.ctx.restore(); }
  fill(shape, m, color) {
    const c = this.ctx;
    c.setTransform(...mul(this.base, m));
    c.fillStyle = color;
    c.fill(this.paths[shape]);
  }
  stroke(shape, m, color, width) {
    const c = this.ctx;
    c.setTransform(...mul(this.base, m));
    c.strokeStyle = color;
    c.lineWidth = width;
    c.stroke(this.paths[shape]);
  }
  /** A disc fading from `inner` at its centre to `outer` at its rim. */
  glow(m, inner, outer) {
    const c = this.ctx;
    c.setTransform(...mul(this.base, m));
    const g = c.createRadialGradient(0, 0, 0, 0, 0, 0.5);
    g.addColorStop(0, inner);
    g.addColorStop(1, outer);
    c.fillStyle = g;
    c.fill(this.paths.circle);
  }
}

const n3 = v => (Math.abs(v) < 1e-9 ? 0 : +v.toFixed(3));
const mat = m => `matrix(${m.map(n3).join(' ')})`;

/** Records the same calls as SVG elements. */
export class SvgPainter {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.parts = [];
    this.defs = [];
    this.ids = 0;
    this.used = new Set();
  }
  rect(x, y, w, h, color) {
    this.parts.push(`<rect x="${n3(x)}" y="${n3(y)}" width="${n3(w)}" height="${n3(h)}" fill="${color}"/>`);
  }
  clipStart(x, y, w, h) {
    const id = 'c' + this.ids++;
    this.defs.push(`<clipPath id="${id}"><rect x="${n3(x)}" y="${n3(y)}" width="${n3(w)}" height="${n3(h)}"/></clipPath>`);
    this.parts.push(`<g clip-path="url(#${id})">`);
  }
  clipEnd() { this.parts.push('</g>'); }
  fill(shape, m, color) {
    this.used.add(shape);
    this.parts.push(`<use href="#s-${shape}" transform="${mat(m)}" fill="${color}"/>`);
  }
  stroke(shape, m, color, width) {
    this.used.add(shape);
    this.parts.push(`<use href="#s-${shape}" transform="${mat(m)}" fill="none" stroke="${color}" stroke-width="${n3(width)}"/>`);
  }
  glow(m, inner, outer) {
    const id = 'g' + this.ids++;
    this.defs.push(`<radialGradient id="${id}"><stop offset="0" stop-color="${inner}"/><stop offset="1" stop-color="${outer}"/></radialGradient>`);
    this.used.add('circle');
    this.parts.push(`<use href="#s-circle" transform="${mat(m)}" fill="url(#${id})"/>`);
  }
  toString() {
    const shapes = [...this.used].map(k => `<path id="s-${k}" d="${SHAPE_PATHS[k]}"/>`);
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${this.width} ${this.height}" width="${this.width}" height="${this.height}">`
      + `<defs>${shapes.join('')}${this.defs.join('')}</defs>${this.parts.join('')}</svg>`;
  }
}
