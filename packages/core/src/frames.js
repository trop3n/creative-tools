// Frame shapes shared by the tools' Frame menus. The LED wall is a shape with a fixed size:
// choosing it frames the view at 24:11 and every export comes out at exactly 3072 × 1408.
// Custom size works the same way with a width and height the user types (`custom`, [w, h]).

export const LED_WALL = {id: 'led', w: 3072, h: 1408, label: 'LED wall'};
export const LED_RATIO = LED_WALL.w / LED_WALL.h;

/** Custom size: the menu id, the default size and the limits (whole, even pixels, so video can encode it). */
export const CUSTOM = {id: 'custom', label: 'Custom size', w: 1920, h: 1080, min: 16, max: 8192};

/** A typed width or height made whole, even and within the limits; `d` when it isn't a number. */
export function cleanSide(v, d) {
  const n = Number(v);
  if (!Number.isFinite(n)) return d;
  return Math.min(CUSTOM.max, Math.max(CUSTOM.min, Math.round(n / 2) * 2));
}

/** The menu ids: a tool's own shapes, then Custom size. */
export const frameIds = ratios => [...Object.keys(ratios), CUSTOM.id];

/** Whether `id` is one of a tool's shapes or Custom size. */
export const isFrame = (id, ratios) => id === CUSTOM.id || Object.prototype.hasOwnProperty.call(ratios, id);

/** Width / height for a frame id (Custom size: from `custom`). */
export const frameRatio = (id, ratios, custom) => (id === CUSTOM.id ? custom[0] / custom[1] : ratios[id]);

/** The menu label for a frame id ('16:9' stays '16:9'). */
export const frameLabel = id => (id === LED_WALL.id ? LED_WALL.label : id === CUSTOM.id ? CUSTOM.label : id);

/** The fixed export size for a frame id, or null when the size follows the long side. */
export const fixedSize = (id, custom) => (id === LED_WALL.id ? [LED_WALL.w, LED_WALL.h] : id === CUSTOM.id ? [custom[0], custom[1]] : null);

/** The fixed export size as text ('3072 × 1408 px'), or '' when the size follows the long side. */
export const fixedSizeLabel = (id, custom) => {
  const f = fixedSize(id, custom);
  return f ? `${f[0]} × ${f[1]} px` : '';
};

/** The usual shapes plus the LED wall, for tools that crop a source to a frame (DURANDAL, GLYF). */
export const FRAME_RATIOS = {'16:9': 16 / 9, '9:16': 9 / 16, '1:1': 1, '4:5': 4 / 5, '4:3': 4 / 3, '3:4': 3 / 4, led: LED_RATIO};

/** The centered part of a sw × sh source with the shape `ratio` (no ratio: all of it). */
export function cropRect(sw, sh, ratio) {
  if (!ratio || !sw || !sh) return {x: 0, y: 0, w: sw, h: sh};
  if (sw / sh > ratio) { const w = sh * ratio; return {x: (sw - w) / 2, y: 0, w, h: sh}; }
  const h = sw / ratio;
  return {x: 0, y: (sh - h) / 2, w: sw, h};
}

/** Export width and height: the fixed size for the LED wall or Custom size, else `long` on the long side (short side even, for video). */
export function frameDims(id, ratio, long, custom) {
  const f = fixedSize(id, custom);
  if (f) return f;
  return ratio >= 1 ? [long, Math.round(long / ratio / 2) * 2] : [Math.round(long * ratio / 2) * 2, long];
}
