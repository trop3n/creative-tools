// Writes the launcher's preview card from the engine: a 400 × 240 frame of a preset.
import fs from 'node:fs';
import {buildScene, drawScene} from '../src/engine/modules.js';
import {SvgPainter} from '../src/engine/paint.js';
import {presetConfig, cleanConfig} from '../src/engine/config.js';
const cfg = cleanConfig({...presetConfig(process.argv[2] || 'navygold'), aspect: '16:9', grid: 3, seed: +(process.argv[3] || 7), moduleSeed: +(process.argv[4] || 11)});
const p = new SvgPainter(400, 240);
drawScene(p, buildScene(cfg, 0, 400 / 240), cfg, 400, 240, 0.3);
const out = process.argv[5] || '../launcher/src/previews/tycho.svg';
fs.writeFileSync(out, p.toString().replace(/ width="400" height="240"/, ''));
console.log('wrote', out, fs.statSync(out).size, 'bytes');
