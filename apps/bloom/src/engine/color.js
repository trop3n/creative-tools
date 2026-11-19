// Colour ramps for BLOOM: hex stops blended in Oklab into small sRGB lookup tables.
import {parseColor, oklabToLinear, oklabToHex} from '@studio/core/gradient';

const LUT_SIZE = 48;
const encode = c => {
  const v = Math.min(1, Math.max(0, c));
  return v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
};

/** sRGB 0..1 triple for a colour string. */
export function toRGB(color) {
  const lab = parseColor(color) || [0, 0, 0];
  return oklabToLinear(lab).map(encode);
}

/** Stops (colour strings, first = petal base) → Float32Array of LUT_SIZE sRGB triples. */
export function makeLut(stops) {
  const labs = stops.map(s => parseColor(s) || [0, 0, 0]);
  const out = new Float32Array(LUT_SIZE * 3);
  for (let i = 0; i < LUT_SIZE; i++) {
    const t = (i / (LUT_SIZE - 1)) * (labs.length - 1);
    const k = Math.min(labs.length - 2, Math.floor(t)), f = t - k;
    const a = labs[k], b = labs[k + 1] || a;
    const rgb = oklabToLinear([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]);
    out[i * 3] = encode(rgb[0]); out[i * 3 + 1] = encode(rgb[1]); out[i * 3 + 2] = encode(rgb[2]);
  }
  return out;
}

/** Index of the LUT entry for v in 0..1 (multiply by 3 for the red channel). */
export const lutIndex = v => Math.round(Math.min(1, Math.max(0, v)) * (LUT_SIZE - 1)) * 3;

/** Any colour string → #rrggbb, for pickers. */
export const asHex = c => { const lab = parseColor(c); return lab ? oklabToHex(lab) : '#000000'; };
