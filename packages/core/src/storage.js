// JSON in localStorage. Every tool in the suite is served from one origin, so
// keys under `studio.shared.*` are visible to all of them (palettes, libraries).
// Reads and writes never throw: storage can be blocked or cleared.

export function readJSON(key, fallback = null) {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : JSON.parse(v);
  } catch (e) {
    return fallback;
  }
}

export function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    return false;
  }
}

/** Keys namespaced to one tool: toolStore('glyf').get('lib.v1') -> 'glyf.lib.v1'. */
export function toolStore(tool) {
  return {
    get: (key, fallback) => readJSON(`${tool}.${key}`, fallback),
    set: (key, value) => writeJSON(`${tool}.${key}`, value),
  };
}

/** Suite-wide keys shared by every tool. */
export const shared = toolStore('studio.shared');
