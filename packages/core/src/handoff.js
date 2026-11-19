// Hand a file from one tool to another in the same suite (same origin): the
// sender puts it here and opens the other tool, which takes it on load. Kept in
// IndexedDB (files can be large) under one slot; taking it empties the slot.
const DB = 'studio.handoff', STORE = 'files', KEY = 'next';

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
const run = async (mode, fn) => {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode), out = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(out && 'result' in out ? out.result : undefined);
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
};

/** Leave a file for the next tool: {blob, name, from}. */
export const putHandoff = (blob, name, from) => run('readwrite', s => s.put({blob, name, from, at: Date.now()}, KEY));

/** Take the waiting file, if one was left in the last few minutes. Returns a File or null. */
export async function takeHandoff(maxAgeMs = 5 * 60 * 1000) {
  try {
    const item = await run('readonly', s => s.get(KEY));
    if (!item) return null;
    await run('readwrite', s => s.delete(KEY));
    if (Date.now() - item.at > maxAgeMs) return null;
    return Object.assign(new File([item.blob], item.name, {type: item.blob.type}), {from: item.from});
  } catch (e) {
    return null;
  }
}
