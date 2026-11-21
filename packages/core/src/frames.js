// Frame shapes shared by the tools' Frame menus. The LED wall is a shape with a fixed size:
// choosing it frames the view at 24:11 and every export comes out at exactly 3072 × 1408.

export const LED_WALL = {id: 'led', w: 3072, h: 1408, label: 'LED wall'};
export const LED_RATIO = LED_WALL.w / LED_WALL.h;

/** The menu label for a frame id ('16:9' stays '16:9'). */
export const frameLabel = id => (id === LED_WALL.id ? LED_WALL.label : id);

/** The fixed export size as text ('3072 × 1408 px'), or '' when the size follows the long side. */
export const fixedSizeLabel = id => (id === LED_WALL.id ? `${LED_WALL.w} × ${LED_WALL.h} px` : '');

/** The fixed export size for a frame id, or null when the size follows the long side. */
export const fixedSize = id => (id === LED_WALL.id ? [LED_WALL.w, LED_WALL.h] : null);

/** The usual shapes plus the LED wall, for tools that crop a source to a frame (DURANDAL, GLYF). */
export const FRAME_RATIOS = {'16:9': 16 / 9, '9:16': 9 / 16, '1:1': 1, '4:5': 4 / 5, '4:3': 4 / 3, '3:4': 3 / 4, led: LED_RATIO};

/** The centered part of a sw × sh source with the shape `ratio` (no ratio: all of it). */
export function cropRect(sw, sh, ratio) {
  if (!ratio || !sw || !sh) return {x: 0, y: 0, w: sw, h: sh};
  if (sw / sh > ratio) { const w = sh * ratio; return {x: (sw - w) / 2, y: 0, w, h: sh}; }
  const h = sw / ratio;
  return {x: 0, y: (sh - h) / 2, w: sw, h};
}

/** Export width and height: the fixed size for the LED wall, else `long` on the long side (short side even, for video). */
export function frameDims(id, ratio, long) {
  const f = fixedSize(id);
  if (f) return f;
  return ratio >= 1 ? [long, Math.round(long / ratio / 2) * 2] : [Math.round(long * ratio / 2) * 2, long];
}
