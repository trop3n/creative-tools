// Saving and opening files. Works both as a plain web page (anchor download,
// file picker) and inside a claude.ai Artifact (the `downloads` capability).

/**
 * Offer a generated file to the viewer.
 * @returns {Promise<{status: 'saved' | 'declined' | 'error', message: string}>}
 */
export async function saveFile(filename, data, mime) {
  let dl = null;
  try {
    dl = window.claude && window.claude.use ? await window.claude.use('downloads') : null;
  } catch (e) {
    dl = null;
  }
  if (dl) {
    try {
      await dl.save({filename, data});
      return {status: 'saved', message: 'Saved ' + filename};
    } catch (e) {
      return e && e.code === 'declined'
        ? {status: 'declined', message: 'Save canceled'}
        : {status: 'error', message: 'Could not save the file here'};
    }
  }
  const blob = data instanceof Blob ? data : new Blob([data], {type: mime});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  return {status: 'saved', message: 'Saved ' + filename};
}

/** Open the system file picker without a file input in the page. */
export function pickFiles(accept, multiple = false) {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.onchange = () => resolve([...(input.files || [])]);
    input.click();
  });
}

/** Copy text to the clipboard; resolves true on success. */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    return false;
  }
}

export const slug = s =>
  (s || 'file').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'file';
