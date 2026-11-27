// Checks for the shared glyph set and the live link outside the suite. Run with `npm test -w @studio/core`.
import {test} from 'node:test';
import assert from 'node:assert/strict';

const mem = new Map();
globalThis.localStorage = {getItem: k => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k)};
const {publishGlyphs, suiteGlyphs, watchGlyphs, glyphSymbol, glyphDocument} = await import('../src/glyphs.js');
const {createLiveSender, watchLiveSources} = await import('../src/live.js');

test('GLYF publishes its set; other tools read it back and are told it changed', () => {
  let calls = 0;
  const stop = watchGlyphs(() => calls++);
  assert.deepEqual(suiteGlyphs(), []);
  publishGlyphs([{id: 'a', name: 'Dot', svg: '<g fill="currentColor"><ellipse cx="50" cy="50" rx="20" ry="20"/></g>'}, {id: 'b', name: 'Bad', svg: ''}]);
  assert.deepEqual(suiteGlyphs().map(g => g.name), ['Dot']); // empty markup is dropped
  assert.equal(calls, 1);
  stop();
  mem.set('studio.shared.glyphs.v1', 'not json');
  assert.deepEqual(suiteGlyphs(), []);
});

test('glyph markup wraps for SVG exports and standalone pictures', () => {
  const g = {id: 'a', name: 'Dot', svg: '<g fill="currentColor"/>'};
  assert.equal(glyphSymbol(g, 'pg0'), '<symbol id="pg0" viewBox="0 0 100 100" overflow="visible"><g fill="currentColor"/></symbol>');
  assert.match(glyphDocument(g, 64, '#00304e'), /^<svg [^>]*width="64" height="64" color="#00304e">/);
});

test('outside the suite the live link does nothing and lists no sources', () => {
  const live = createLiveSender({label: 'x'});
  assert.equal(live.watched(), false);
  live.frame(null);
  live.stop();
  let got = null;
  watchLiveSources(l => { got = l; })();
  assert.deepEqual(got, []);
});
