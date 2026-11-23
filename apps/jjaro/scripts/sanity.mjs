// Run with `npm test -w @studio/jjaro`. Node checks of JJARO's cloth: every setup at
// every quality stays finite, doesn't overstretch, settles when there's no wind, doesn't
// pass through itself (except the heap, which is only counted), survives rough handling,
// and a frame's simulation stays within budget.
import {Cloth, SETUP_IDS, QUALITY, STEP} from '../src/engine/cloth.js';
import {Surface} from '../src/engine/surface.js';
import {piercings} from './pierce.mjs';

let fails = 0;
const fail = (...m) => { fails++; console.log('FAIL', ...m); };
const finite = c => c.pos.every(Number.isFinite);
const run = (c, seconds, frame = 1 / 60) => { for (let t = 0; t < seconds; t += frame) c.advance(frame); };

for (const setup of SETUP_IDS) {
  for (const [q, res] of Object.entries(QUALITY)) {
    const c = new Cloth({setup, res, seed: 7});
    run(c, 8);
    const sp = c.speed(), st = c.maxStretch();
    if (!finite(c)) fail(setup, q, 'non-finite positions');
    const sf = new Surface(c);
    sf.update();
    if (![sf.pos, sf.nrm, sf.tan].every(a => a.every(Number.isFinite))) fail(setup, q, 'non-finite drawn surface');
    // The drawn surface passes through every particle.
    const R = sf.R, k = (R - 1) / (c.W - 1);
    for (const [x, y] of [[0, 0], [c.W - 1, c.W - 1], [c.W >> 1, c.W >> 2]]) {
      const a = (y * c.W + x) * 3, b = (y * k * R + x * k) * 3;
      if (Math.hypot(c.pos[a] - sf.pos[b], c.pos[a + 1] - sf.pos[b + 1], c.pos[a + 2] - sf.pos[b + 2]) > 1e-5) fail(setup, q, 'surface misses particle', x, y);
    }
    if (st > 1.2) fail(setup, q, `overstretched ×${st.toFixed(3)}`);
    // Sheet edges crossing a triangle. The heap crumples through itself (about 1,000, 3,700
    // and 8,000 at low, medium and high); particle repulsion can't stop that without also
    // un-crumpling it (tried Nov. 23), so it is only counted. The others must stay clear.
    const cross = piercings(c);
    if (setup !== 'heap' && cross > 0) fail(setup, q, `passes through itself: ${cross} crossing edges`);
    if (setup !== 'float' && sp > 0.05) fail(setup, q, `still moving after 8 s: ${sp.toFixed(3)} u/s`);
    console.log(`${setup.padEnd(8)} ${q.padEnd(6)} speed ${sp.toFixed(4)}  stretch ×${st.toFixed(3)}  crossings ${cross}`);
  }
}

// Rough handling: maximum wind, gusts, heavy gravity, floppy and stiff, a wild drag.
for (const setup of SETUP_IDS) {
  for (const bend of [0, 1]) {
    const c = new Cloth({setup, res: QUALITY.high, seed: 3});
    Object.assign(c.params, {wind: 1, gravity: 2, bend});
    const mid = (c.W >> 1) * c.W + (c.W >> 1);
    c.grabStart(mid, [c.pos[mid * 3], c.pos[mid * 3 + 1], c.pos[mid * 3 + 2]]);
    for (let f = 0; f < 240; f++) {
      if (f % 60 === 0) c.gust();
      c.grabMove([Math.sin(f * 0.3) * 2.5, Math.cos(f * 0.21) * 2, Math.sin(f * 0.17) * 2]);
      c.advance(1 / 60);
    }
    c.grabEnd();
    run(c, 4);
    if (!finite(c)) fail(setup, bend, 'non-finite after rough handling');
    const st = c.maxStretch();
    if (st > 1.6) fail(setup, bend, `torn apart after rough handling ×${st.toFixed(2)}`);
  }
}

// Budget: one 60 fps frame (two steps) at high quality, the slowest setups.
for (const setup of ['heap', 'drape', 'edge']) {
  const c = new Cloth({setup, res: QUALITY.high, seed: 1});
  c.params.wind = 0.5;
  run(c, 1);
  const t0 = performance.now(), frames = 120;
  for (let f = 0; f < frames; f++) c.advance(1 / 60);
  const ms = (performance.now() - t0) / frames;
  console.log(`${setup} high: ${ms.toFixed(2)} ms per frame`);
  if (ms > 8) fail(setup, `too slow: ${ms.toFixed(1)} ms per frame`);
}
if (Math.abs(STEP - 1 / 120) > 1e-9) fail('step changed');

console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
