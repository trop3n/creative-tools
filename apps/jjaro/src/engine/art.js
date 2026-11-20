// The artwork printed on the foil: an image the person loads, or a sample emblem.
// Kept as a canvas (transparency intact) plus whether that transparency carries the
// shape, which decides how the shader reads coverage from it.

const MAX_SIDE = 1024;

function describe(canvas, name, custom) {
  const x = canvas.getContext('2d', {willReadFrequently: true});
  const {data} = x.getImageData(0, 0, canvas.width, canvas.height);
  // Images with a see-through background carry their shape in alpha; flat ones in
  // their dark parts.
  let clear = 0;
  for (let i = 3; i < data.length; i += 16) if (data[i] < 200) clear++;
  return {canvas, name, custom, alpha: clear > data.length / 16 * 0.01, aspect: canvas.width / canvas.height};
}

function toCanvas(img) {
  let w = img.naturalWidth || 800, h = img.naturalHeight || 800;
  const k = Math.min(1, MAX_SIDE / Math.max(w, h));
  w = Math.max(1, Math.round(w * k)); h = Math.max(1, Math.round(h * k));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d').drawImage(img, 0, 0, w, h);
  return c;
}

function decode(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('That image could not be read'));
    img.src = src;
  });
}

/** Read an image file into artwork. */
export async function artFromFile(file) {
  const url = URL.createObjectURL(file);
  try { return describe(toCanvas(await decode(url)), file.name, true); }
  finally { URL.revokeObjectURL(url); }
}

/** Artwork from a saved data URL. */
export async function artFromData(data, name) {
  return describe(toCanvas(await decode(data)), name, true);
}

/** A data URL small enough to keep in localStorage. */
export function artData(art) {
  return art.canvas.toDataURL('image/png');
}

/** The sample: an eight-point star in a ring, black on clear. */
export function sampleArt() {
  const S = 768, c = document.createElement('canvas');
  c.width = c.height = S;
  const x = c.getContext('2d'), m = S / 2;
  x.fillStyle = '#000';
  x.beginPath();
  x.arc(m, m, S * 0.47, 0, Math.PI * 2);
  x.arc(m, m, S * 0.41, 0, Math.PI * 2, true);
  x.fill();
  x.beginPath();
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 - Math.PI / 2, r = i % 2 ? S * 0.15 : S * 0.37;
    x.lineTo(m + Math.cos(a) * r, m + Math.sin(a) * r);
  }
  x.closePath();
  x.fill();
  x.globalCompositeOperation = 'destination-out';
  x.beginPath();
  x.arc(m, m, S * 0.06, 0, Math.PI * 2);
  x.fill();
  return describe(c, 'Sample star', false);
}
