// Checks for recipes: recording a tool's step on top of what it was given, the saved
// list, and the file format. (Running one needs the browser; it's checked headless.)
import {test} from 'node:test';
import assert from 'node:assert/strict';

const mem = new Map();
globalThis.localStorage = {getItem: k => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k)};
globalThis.location = {pathname: '/durandal/', search: '', hash: '', href: 'http://localhost/durandal/'};
const R = await import('../src/recipes.js');

test('a tool records its own step on top of what it was given', () => {
  assert.equal(R.currentRecipe(), null); // nothing registered yet
  let settings = {style: 'atkinson', block: 4};
  R.registerRecipeTool({getSettings: () => settings, renderStill: async () => null});
  R.noteStart();
  assert.deepEqual(R.currentRecipe(), [{tool: 'durandal', settings: {style: 'atkinson', block: 4}, kind: 'image', video: false}]);
  // Settings are copied, not shared: later edits don't change a recipe already taken.
  const taken = R.currentRecipe();
  settings.block = 8;
  assert.equal(taken[0].settings.block, 4);
  // Given a picture from LEELA (its recipe rides on the file) …
  R.noteIncoming({name: 'leela.png', recipe: [{tool: 'leela', settings: {preset: 'brand'}, kind: 'image', video: true}]});
  assert.equal(R.describeRecipe(R.currentRecipe()), 'LEELA → DURANDAL');
  // … or a plain file, which becomes the input to ask for.
  R.noteIncoming({name: 'photo.jpg'});
  const r = R.currentRecipe('video');
  assert.equal(R.describeRecipe(r), 'Your picture → DURANDAL');
  assert.ok(R.needsInput(r));
  assert.equal(r[1].kind, 'video');
  assert.equal(R.canRunAsVideo(r), false); // this tool registered no video render
});

test('saved recipes: same name replaces, bad steps are refused, delete works', () => {
  let calls = 0;
  const stop = R.watchRecipes(() => calls++);
  const steps = [{tool: 'leela', settings: {a: 1}, kind: 'image', video: true}, {tool: 'durandal', settings: {b: 2}, kind: 'image', video: true}];
  assert.ok(R.saveRecipe('Poster', steps));
  assert.ok(R.saveRecipe('poster', steps.slice(0, 1)));
  assert.deepEqual(R.savedRecipes().map(r => r.name), ['poster']);
  assert.ok(R.canRunAsVideo(steps));
  assert.equal(R.saveRecipe('Bad', [{tool: 'nope', settings: {}}]), null);
  assert.equal(R.saveRecipe('Empty', []), null);
  assert.equal(R.saveRecipe('', steps), null);
  R.deleteRecipe(R.savedRecipes()[0].id);
  assert.deepEqual(R.savedRecipes(), []);
  assert.equal(calls, 3);
  stop();
});

test('recipe files round-trip and other JSON is refused', async () => {
  const recipe = {name: 'Loop', steps: [{tool: 'input', name: 'a picture'}, {tool: 'glyf', settings: {gen: {}}, kind: 'image', video: true}]};
  const file = Object.assign(R.recipeFile(recipe), {name: 'loop.recipe.json'});
  const back = await R.importRecipe(file);
  assert.equal(back.name, 'Loop');
  assert.equal(R.describeRecipe(back.steps), 'Your picture → GLYF');
  const junk = Object.assign(new Blob(['{"app":"durandal"}']), {name: 'x.json'});
  await assert.rejects(R.importRecipe(junk), /not a recipe/);
});
