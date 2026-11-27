// The style registry. A style is a plain object:
//   { id, name, family, params: [{key, label, min, max, step, default, options?}], run(buf, w, h, params, threshold) }
// `run` dithers a grayscale Float32Array (0..255, length w*h) in place to 0/255.
// Add a style by appending to STYLES; the UI builds its controls from `params`.
import {KERNELS, diffuse, diffuseScanlines} from './diffusion.js';
import {FIELDS, applyField} from './fields.js';
import {diffuseOstromukhov} from './ostromukhov.js';

const serpentine = {key: 'serpentine', label: 'Serpentine scan', type: 'toggle', default: false};

const diffusionStyle = (id, name) => ({
  id, name, family: 'Error diffusion',
  params: [serpentine],
  run: (buf, w, h, p, t) => diffuse(buf, w, h, KERNELS[id], t, !!p.serpentine),
});

const fieldStyle = (id, name, params = []) => ({
  id, name, family: 'Pattern',
  params,
  field: (w, h, p) => FIELDS[id](w, h, p), // pattern styles expose their field (the GPU path uses it)
  run: (buf, w, h, p, t) => applyField(buf, w, h, FIELDS[id](w, h, p), t),
});

export const STYLES = [
  diffusionStyle('floyd-steinberg', 'Floyd–Steinberg'),
  diffusionStyle('atkinson', 'Atkinson'),
  diffusionStyle('jarvis-judice-ninke', 'Jarvis–Judice–Ninke'),
  diffusionStyle('stucki', 'Stucki'),
  diffusionStyle('burkes', 'Burkes'),
  diffusionStyle('sierra', 'Sierra'),
  diffusionStyle('two-row-sierra', 'Two-Row Sierra'),
  diffusionStyle('sierra-lite', 'Sierra Lite'),
  diffusionStyle('stevenson-arce', 'Stevenson–Arce'),
  diffusionStyle('fan', 'Fan'),
  diffusionStyle('shiau-fan', 'Shiau–Fan'),
  diffusionStyle('shiau-fan-2', 'Shiau–Fan 2'),
  diffusionStyle('false-floyd-steinberg', 'False Floyd–Steinberg'),
  diffusionStyle('row', 'Row only'),
  {
    // Weights change with the input level (always a serpentine scan), for blue-noise dots.
    id: 'ostromukhov', name: 'Ostromukhov', family: 'Error diffusion',
    params: [],
    run: (buf, w, h, p, t) => diffuseOstromukhov(buf, w, h, t),
  },

  fieldStyle('bayer', 'Bayer', [{key: 'size', label: 'Matrix', type: 'select', default: 4, options: [2, 4, 8, 16]}]),
  fieldStyle('bittone', 'Cluster', [{key: 'size', label: 'Matrix', type: 'select', default: 4, options: [4, 8]}]),
  fieldStyle('ign', 'Interleaved gradient'),
  fieldStyle('dots', 'Halftone dots', [
    {key: 'cell', label: 'Cell size', min: 2, max: 32, step: 1, default: 6},
    {key: 'angle', label: 'Angle', min: 0, max: 90, step: 1, default: 45},
  ]),
  fieldStyle('lines', 'Engraved lines', [
    {key: 'spacing', label: 'Spacing', min: 2, max: 32, step: 1, default: 6},
    {key: 'angle', label: 'Angle', min: 0, max: 180, step: 1, default: 30},
  ]),
  fieldStyle('crosshatch', 'Crosshatch', [
    {key: 'spacing', label: 'Spacing', min: 2, max: 32, step: 1, default: 6},
    {key: 'layers', label: 'Layers', min: 1, max: 4, step: 1, default: 4},
    {key: 'angle', label: 'Angle', min: 0, max: 90, step: 1, default: 45},
  ]),
  fieldStyle('stipple', 'Stipple'),
  fieldStyle('squares', 'Square dots', [
    {key: 'cell', label: 'Cell size', min: 2, max: 32, step: 1, default: 8},
    {key: 'angle', label: 'Angle', min: 0, max: 90, step: 1, default: 0},
  ]),
  fieldStyle('crosses', 'Crosses', [
    {key: 'cell', label: 'Cell size', min: 2, max: 32, step: 1, default: 8},
    {key: 'angle', label: 'Angle', min: 0, max: 90, step: 1, default: 0},
  ]),
  fieldStyle('hex', 'Hex dots', [
    {key: 'cell', label: 'Cell size', min: 3, max: 32, step: 1, default: 8},
    {key: 'angle', label: 'Angle', min: 0, max: 60, step: 1, default: 0},
  ]),
  fieldStyle('diamonds', 'Diamonds', [
    {key: 'cell', label: 'Cell size', min: 2, max: 32, step: 1, default: 8},
    {key: 'angle', label: 'Angle', min: 0, max: 90, step: 1, default: 0},
  ]),
  fieldStyle('wave', 'Wave', [
    {key: 'cycles', label: 'Cycles', min: 1, max: 20, step: 1, default: 1},
    {key: 'slant', label: 'Slant', min: 1, max: 40, step: 1, default: 10},
  ]),
  fieldStyle('rings', 'Rings', [{key: 'spacing', label: 'Spacing', min: 1, max: 30, step: 1, default: 5}]),
  fieldStyle('spiral', 'Spiral', [
    {key: 'arms', label: 'Arms', min: 1, max: 12, step: 1, default: 3},
    {key: 'spacing', label: 'Spacing', min: 2, max: 40, step: 1, default: 8},
  ]),
  fieldStyle('noise', 'Noise', [{key: 'seed', label: 'Seed', min: 1, max: 999, step: 1, default: 1}]),

  {
    id: 'scanline', name: 'Scanline', family: 'Scanline',
    params: [{key: 'sigma', label: 'Spread', min: 0.5, max: 10, step: 0.5, default: 2}],
    run: (buf, w, h, p, t) => diffuseScanlines(buf, w, h, p.sigma ?? 2, t),
  },
];

export const STYLE_BY_ID = Object.fromEntries(STYLES.map(s => [s.id, s]));

/** Default param values for a style. */
export const defaultParams = style => Object.fromEntries(style.params.map(p => [p.key, p.default]));
