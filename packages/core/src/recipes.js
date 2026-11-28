// Recipes: the chain of tools that made a picture, kept so it can be made again, at
// another size (the LED wall, Custom size) or on a new picture.
//
// Every picture a tool saves or sends goes on the shelf with its recipe: the steps
// that made what the tool was given, plus this tool's own settings. "Save recipe" names
// it. Running it opens each tool in turn (in the same tab, ?run=id): the tool applies
// its step, takes the picture so far, renders, and hands over to the next; the last one
// saves the file.
//
// A step is {tool, settings, kind: 'image' | 'video', video: can this tool make video}.
// A recipe that began with a file or a camera starts with {tool: 'input', name} and
// asks for a picture when it runs.
//
// Each tool registers its hooks once: registerRecipeTool({getSettings, applySettings,
// setSize, load, ready, renderStill, renderVideo, toast}) and tells recipes what it was
// given (noteIncoming / noteStart).
import {readJSON, writeJSON} from './storage.js';
import {TOOL_NAMES, currentTool, setRecipeHook, runStore} from './suite.js';
import {saveFile, slug} from './files.js';

const KEY = 'studio.shared.recipes.v1', MAX_RECIPES = 40;

let hooks = null; // the tool's recipe hooks
let incoming = null; // steps that made what this tool was given; null: it starts here

/* ---------- recording ---------- */
/** What the tool was given: a File from the shelf (carries .recipe), or another file or camera (an input). */
export function noteIncoming(file) {
  incoming = file && Array.isArray(file.recipe) && file.recipe.length ? file.recipe : [{tool: 'input', name: (file && file.name) || 'a picture'}];
}
/** The tool starts the chain itself (a maker, or its own built-in sample). */
export function noteStart() { incoming = null; }

/** The recipe for what this tool shows now, as a picture or a video. Null outside the suite or before registering. */
export function currentRecipe(kind = 'image') {
  const tool = currentTool();
  if (!hooks || !tool) return null;
  let settings;
  try { settings = JSON.parse(JSON.stringify(hooks.getSettings())); } catch (e) { return null; }
  return [...(incoming || []), {tool, settings, kind, video: !!hooks.renderVideo}];
}
setRecipeHook(currentRecipe);

/** "LEELA → DURANDAL → GLYF" (a starting picture shows as "Your picture"). */
export const describeRecipe = steps => (steps || []).map(s => (s.tool === 'input' ? 'Your picture' : TOOL_NAMES[s.tool] || s.tool)).join(' → ');
/** True when running it needs a picture to start from. */
export const needsInput = steps => !!(steps && steps[0] && steps[0].tool === 'input');
/** True when every tool in it can make video. */
export const canRunAsVideo = steps => (steps || []).filter(s => s.tool !== 'input').every(s => s.video);

/* ---------- saved recipes ---------- */
const validSteps = steps => Array.isArray(steps) && steps.length > 0 && steps.every(s => s && typeof s.tool === 'string' && (s.tool === 'input' || (TOOL_NAMES[s.tool] && s.settings && typeof s.settings === 'object')));
const stored = () => (readJSON(KEY, []) || []).filter(r => r && typeof r.name === 'string' && validSteps(r.steps));
const listeners = new Set();
const changed = () => listeners.forEach(f => f());

/** Saved recipes, newest first: [{id, name, steps, at}]. */
export const savedRecipes = () => stored().sort((a, b) => (b.at || 0) - (a.at || 0));

/** Save steps under a name (the same name replaces it). Returns the recipe, or null. */
export function saveRecipe(name, steps) {
  name = String(name || '').trim().slice(0, 60);
  if (!name || !validSteps(steps)) return null;
  const recipe = {id: 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name, steps, at: Date.now()};
  writeJSON(KEY, [recipe, ...stored().filter(r => r.name.toLowerCase() !== name.toLowerCase())].slice(0, MAX_RECIPES));
  changed();
  return recipe;
}
export function deleteRecipe(id) { writeJSON(KEY, stored().filter(r => r.id !== id)); changed(); }

/** Call fn() when saved recipes change, here or in another tab. Returns a stop function. */
export function watchRecipes(fn) {
  const onStorage = e => { if (e.key === KEY || e.key === null) fn(); };
  if (typeof window !== 'undefined') window.addEventListener('storage', onStorage);
  listeners.add(fn);
  return () => { if (typeof window !== 'undefined') window.removeEventListener('storage', onStorage); listeners.delete(fn); };
}

/** A recipe as a .recipe.json file to keep or share. */
export const recipeFile = recipe => new Blob([JSON.stringify({app: 'studio-recipe', version: 1, name: recipe.name, steps: recipe.steps}, null, 2)], {type: 'application/json'});
/** Read a .recipe.json file and save it. Returns the recipe, or throws with a reason. */
export async function importRecipe(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch (e) { throw new Error('That file is not a recipe'); }
  if (!data || data.app !== 'studio-recipe' || !validSteps(data.steps)) throw new Error('That file is not a recipe');
  return saveRecipe(data.name || file.name.replace(/\.recipe\.json$|\.json$/i, ''), data.steps);
}

/* ---------- running ---------- */
const nextUrl = (tool, id) => new URL(`../${tool}/?run=${encodeURIComponent(id)}`, location.href).href;

/**
 * Make a recipe again: size [w, h] (null keeps each step's own frame), kind 'image' or
 * 'video', input File when it starts from a picture. Opens the first tool in this tab.
 */
export async function runRecipe(recipe, {size = null, kind = 'image', input = null} = {}) {
  const steps = recipe.steps.filter(s => s.tool !== 'input');
  if (!steps.length) throw new Error('This recipe has no tools in it');
  if (needsInput(recipe.steps) && !input) throw new Error('This recipe starts from a picture. Choose one first.');
  if (kind === 'video' && !canRunAsVideo(recipe.steps)) throw new Error('Not every tool in this recipe can make video');
  const lead = needsInput(recipe.steps) ? [recipe.steps[0]] : []; // kept so the result's own recipe starts the same way
  const id = await runStore.put({name: recipe.name, steps, lead, step: 0, size, kind, input: input ? {blob: input, name: input.name} : null});
  location.href = nextUrl(steps[0].tool, id);
}

/** Register this tool's hooks; if the page was opened to run a recipe step, run it. */
export function registerRecipeTool(h) {
  hooks = h;
  if (typeof location === 'undefined') return;
  const id = new URLSearchParams(location.search).get('run');
  if (!id) return;
  history.replaceState(null, '', location.pathname + location.hash);
  runStep(id);
}

async function runStep(id) {
  const say = (m, t = 'info') => (hooks.toast ? hooks.toast(m, t) : console.log(m));
  const run = await runStore.get(id);
  if (!run) return say('That recipe run has expired. Start it again from the home page.', 'error');
  const step = run.steps[run.step], n = run.steps.length, me = TOOL_NAMES[currentTool()] || 'this tool';
  if (!step || step.tool !== currentTool()) return;
  say(`Recipe "${run.name}": step ${run.step + 1} of ${n}…`);
  try {
    await hooks.applySettings(step.settings);
    if (run.size && hooks.setSize) await hooks.setSize(run.size[0], run.size[1]);
    if (run.input) {
      if (!hooks.load) throw new Error(`${me} doesn't take a picture in`);
      await hooks.load(new File([run.input.blob], run.input.name, {type: run.input.blob.type}));
    }
    // What this step was given is the recipe so far (the tool's loader just called it a plain input).
    const before = [...(run.lead || []), ...run.steps.slice(0, run.step)];
    incoming = before.length ? before : null;
    if (hooks.ready) await hooks.ready();
    let out;
    if (run.kind === 'video') {
      if (!hooks.renderVideo) throw new Error(`${me} can't make video`);
      out = await hooks.renderVideo();
    } else out = await hooks.renderStill();
    if (!out || !out.blob) throw new Error('the render was canceled');
    if (run.step + 1 < n) {
      await runStore.put({...run, step: run.step + 1, input: {blob: out.blob, name: out.name}});
      location.href = nextUrl(run.steps[run.step + 1].tool, id);
      return;
    }
    await runStore.remove(id);
    const ext = run.kind === 'video' ? (/webm/.test(out.blob.type) ? 'webm' : 'mp4') : 'png';
    const res = await saveFile(`recipe-${slug(run.name)}.${ext}`, out.blob, out.blob.type);
    say(`Recipe "${run.name}" done. ${res.message}`, res.status === 'error' ? 'error' : 'info');
  } catch (e) {
    await runStore.remove(id);
    say(`Recipe "${run.name}" stopped at ${me}: ${e.message || e}`, 'error');
  }
}
