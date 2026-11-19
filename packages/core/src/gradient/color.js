// Color for LEELA. Everything blends in Oklab (Björn Ottosson, 2020), a space where
// equal steps look equal, so a ramp from blue to orange passes through a clean
// middle instead of a muddy gray-purple. Colors come in as hex or oklch() and are
// kept as Oklab triples [L, a, b].

const toLinear = c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = c => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

/** Linear sRGB (0..1) → Oklab. */
export function linearToOklab([r, g, b]) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** Oklab → linear sRGB (0..1, not clamped). */
export function oklabToLinear([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Parse a color: #rgb, #rrggbb or oklch(L C H) with L as 0..1 or a percentage.
 * Returns Oklab [L, a, b], or null when it isn't a color we read.
 */
export function parseColor(input) {
  const s = String(input || '').trim().toLowerCase();
  let m = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);
  if (m) {
    let hex = m[1];
    if (hex.length === 3) hex = hex.replace(/./g, c => c + c);
    const n = parseInt(hex, 16);
    return linearToOklab([(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => toLinear(v / 255)));
  }
  m = s.match(/^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)(?:deg)?\s*(?:\/\s*[\d.%]+\s*)?\)$/);
  if (m) {
    const L = m[2] ? +m[1] / 100 : +m[1], C = +m[3], h = (+m[4] * Math.PI) / 180;
    if ([L, C, h].some(v => !isFinite(v))) return null;
    return [L, C * Math.cos(h), C * Math.sin(h)];
  }
  return null;
}

/** Oklab → #rrggbb (clamped into sRGB). */
export function oklabToHex(lab) {
  return '#' + oklabToLinear(lab).map(c => Math.round(clamp01(toGamma(clamp01(c))) * 255).toString(16).padStart(2, '0')).join('');
}

/**
 * Catmull–Rom through evenly spaced stops (Oklab triples) at t in 0..1. The curve
 * passes through every stop and has no corners at them, so a ramp has no visible
 * creases where one pair of colors hands over to the next.
 */
export function rampAt(stops, t) {
  const n = stops.length;
  if (n === 1) return stops[0].slice();
  const x = clamp01(t) * (n - 1), i = Math.min(n - 2, Math.floor(x)), f = x - i;
  const p0 = stops[Math.max(0, i - 1)], p1 = stops[i], p2 = stops[i + 1], p3 = stops[Math.min(n - 1, i + 2)];
  const f2 = f * f, f3 = f2 * f;
  return [0, 1, 2].map(k =>
    0.5 * (2 * p1[k] + (p2[k] - p0[k]) * f + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * f2 + (3 * p1[k] - p0[k] - 3 * p2[k] + p3[k]) * f3));
}
