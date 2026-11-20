// Writes the launcher's preview card: an analytic face drawn as a PFHOR mosaic with the
// engine's own SVG painter.
import fs from 'node:fs';
import {analyze, buildCells, drawCells, svgPainter} from '../src/engine/mosaic.js';
import {presetConfig, cleanConfig} from '../src/engine/config.js';

const W = 400, H = 240, aW = 200, aH = 120;
const data = new Uint8ClampedArray(aW * aH * 4);
const ell = (x, y, cx, cy, rx, ry) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
for (let y = 0; y < aH; y++) for (let x = 0; x < aW; x++) {
  let v = 200 - y * 0.6; // backdrop
  const head = ell(x, y, 100, 60, 30, 40);
  if (ell(x, y, 100, 125, 70, 30) < 1) v = 40; // shoulders
  if (head < 1) v = 215 - 80 * head - (x - 90) * 0.9; // face, lit from the left
  if (ell(x, y, 100, 30, 33, 20) < 1 && y < 38) v = 30; // hair
  for (const ex of [88, 112]) {
    if (ell(x, y, ex, 55, 6, 3) < 1) v = 245;
    if (ell(x, y, ex, 55, 2.4, 2.4) < 1) v = 20;
  }
  if (ell(x, y, 100, 80, 9, 2.6) < 1) v = 70; // mouth
  const i = (y * aW + x) * 4;
  data[i] = data[i + 1] = data[i + 2] = Math.max(0, Math.min(255, v));
  data[i + 3] = 255;
}
const cfg = cleanConfig({...presetConfig('dots'), threshold: 0.05, roots: 3, minSize: 2, stroke: 1.2});
const A = analyze(data, aW, aH, cfg.contrast, cfg.brightness);
const cells = buildCells(A, cfg, cfg.threshold, false);
const p = svgPainter();
drawCells(p, cells, cfg, W, H, W / aW, 0);
const svg = p.toString().replace(/ width="400" height="240"/, '');
const out = process.argv[2] || '../launcher/src/previews/pfhor.svg';
fs.writeFileSync(out, svg);
console.log('wrote', out, svg.length, 'bytes,', cells.length, 'cells');
