// Writes the launcher's preview card: a heart in a hue sweep, screened as RGB halftone
// dots on black (three offset screens, added with mix-blend-mode: screen).
import fs from 'node:fs';
const W = 400, H = 240, pitch = 12, dot = 1.2;
const hsl = (h, s, l) => {
  const f = n => { const k = (n + h / 30) % 12; return l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
  return [f(0), f(8), f(4)];
};
// Source: a heart filled with a diagonal hue sweep, plus a faint backdrop glow.
// The heart is the classic parametric curve, as a polygon.
const HEART = Array.from({length: 120}, (_, i) => {
  const t = (i / 120) * Math.PI * 2;
  return [W / 2 + 6.2 * 16 * Math.sin(t) ** 3, H / 2 - 4 - 6.2 * (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t))];
});
const inHeart = (x, y) => {
  let c = false;
  for (let i = 0, j = HEART.length - 1; i < HEART.length; j = i++) {
    const [xi, yi] = HEART[i], [xj, yj] = HEART[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
};
function source(x, y) {
  const inside = inHeart(x, y) ? 1 : 0;
  const col = hsl((300 + (x + y) * 0.55) % 360, 1, 0.55);
  const glow = Math.max(0, 1 - Math.hypot(x - W / 2, y - H / 2) / 260) * 0.25;
  return col.map((c, i) => Math.min(1, c * inside + glow * [0.2, 0.4, 1][i]));
}
const screens = [
  {color: '#ff0000', ch: 0, dx: 0, dy: -0.15 * pitch},
  {color: '#00ff00', ch: 1, dx: 0.13 * pitch, dy: 0.075 * pitch},
  {color: '#0000ff', ch: 2, dx: -0.13 * pitch, dy: 0.075 * pitch},
];
const groups = screens.map(s => {
  const dots = [];
  for (let cy = pitch / 2; cy < H + pitch; cy += pitch) {
    for (let cx = pitch / 2; cx < W + pitch; cx += pitch) {
      const v = source(cx, cy)[s.ch];
      if (v < 0.02) continue;
      const r = Math.sqrt(v) * pitch * 0.5 * dot;
      dots.push(`<circle cx="${(cx + s.dx).toFixed(1)}" cy="${(cy + s.dy).toFixed(1)}" r="${r.toFixed(2)}"/>`);
    }
  }
  return `<g fill="${s.color}" style="mix-blend-mode:screen">${dots.join('')}</g>`;
});
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#000"/><g style="isolation:isolate">${groups.join('')}</g></svg>`;
const out = process.argv[2] || '../launcher/src/previews/thoth.svg';
fs.writeFileSync(out, svg);
console.log('wrote', out, svg.length, 'bytes');
