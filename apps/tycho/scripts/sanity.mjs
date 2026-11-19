// Run with `npm test -w @studio/tycho`.
// Node check of TYCHO's engine: scenes build, every layer draws without NaNs, timing loops.
import {buildScene, drawScene, timing, roundAt} from '../src/engine/modules.js';
import {SvgPainter} from '../src/engine/paint.js';
import {PRESETS, presetConfig, randomConfig, ASPECTS} from '../src/engine/config.js';
class Probe {
  constructor() { this.n = 0; this.bad = 0; }
  chk(m) { this.n++; if (m.some(v => !isFinite(v))) this.bad++; }
  rect() {} clipStart() {} clipEnd() {}
  fill(s, m) { this.chk(m); } stroke(s, m, c, w) { this.chk([...m, w]); } glow(m) { this.chk(m); }
}
let worst = 0, total = 0;
const cfgs = [...PRESETS.map(p => presetConfig(p.id)), ...Array.from({length: 40}, (_, i) => randomConfig(i * 7919))];
for (const cfg of cfgs) for (const a of Object.values(ASPECTS)) {
  const W = 1920, H = Math.round(1920 / a);
  const {loop} = timing(cfg);
  for (const t of [0, 0.37, loop / 3, loop - 0.01]) {
    const sc = buildScene(cfg, roundAt(cfg, t), a);
    const p = new Probe(); const t0 = performance.now();
    drawScene(p, sc, cfg, W, H, t);
    worst = Math.max(worst, p.n); total++;
    if (p.bad) { console.log('NaN', cfg, t); process.exit(1); }
  }
}
// The loop wraps cleanly: the frame at t = 0 equals the frame at t = loop.
for (const cfg of cfgs.slice(0, 20)) {
  const {loop} = timing(cfg);
  const a = new SvgPainter(800, 450), b = new SvgPainter(800, 450);
  drawScene(a, buildScene(cfg, roundAt(cfg, 0), 16 / 9), cfg, 800, 450, 0);
  drawScene(b, buildScene(cfg, roundAt(cfg, loop), 16 / 9), cfg, 800, 450, loop);
  // Compare per clip group as sets: a ray turned one step lands where its neighbour was.
  const groups = svg => svg.split('<g clip-path').map(g => g.match(/<(use|rect)[^>]*>/g)?.map(e => e.replace(/-0(?=[ )])/g, '0')).sort().join('|'));
  const ga = groups(a.toString()), gb = groups(b.toString());
  ga.forEach((g, i) => {
    if (g === gb[i]) return;
    const A = new Set(g.split('|')), B = new Set(gb[i].split('|'));
    const onlyA = [...A].filter(x => !B.has(x)), onlyB = [...B].filter(x => !A.has(x));
    console.log('loop mismatch', cfg.palette, 'cell', i, onlyA.length, onlyB.length, onlyA[0], '|', onlyB[0]);
  });
}
// No layer may vanish: in both blink states, its colour differs from the cell under it,
// and an upper layer differs from the base layer's colour when the module has a third colour.
let vanish = 0, layersSeen = 0;
for (const cfg of cfgs) for (let r = 0; r < 3; r++) {
  for (const mod of buildScene(cfg, r, 16 / 9).mods) {
    mod.layers.forEach((L, i) => {
      layersSeen++;
      const blinkOn = L.motion === 'blink';
      const states = blinkOn ? [false, true] : [false];
      for (const swap of states) {
        const A = swap ? L.fg2 || L.alt : L.fg;
        const under = swap && L.invert ? L.fg : mod.bg;
        if (A === under) { vanish++; console.log('vanishes', cfg.palette, L.arr, L.shape, L.motion, {swap, A, under}); }
      }
      if (i > 0 && new Set([mod.bg, ...mod.layers.map(l => l.fg)]).size > 2 && L.fg === mod.layers[0].fg) {
        vanish++; console.log('upper layer matches base', cfg.palette, L.arr, L.shape);
      }
    });
  }
}
console.log('layers checked:', layersSeen, 'vanishing:', vanish);
if (vanish) process.exit(1);
const sc = buildScene(cfgs[0], 0, 16 / 9);
console.log('frames ok:', total, 'most shapes in a frame:', worst, 'cells:', sc.cells.length, 'loop s:', timing(cfgs[0]).loop);
