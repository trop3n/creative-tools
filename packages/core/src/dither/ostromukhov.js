// Ostromukhov's variable-coefficient error diffusion (V. Ostromoukhov, "A Simple and
// Efficient Error-Diffusion Algorithm", SIGGRAPH 2001). Error goes to three
// neighbours only: next in the scan direction (d10), the one below and behind
// (d-11) and the one straight below (d01), on a serpentine path. The weights
// depend on the pixel's input level, which spreads dots as blue noise instead of
// Floyd–Steinberg's worms and regular patches.
//
// The table is Appendix I of the paper: for input levels 0..127, the triple
// A10, A-11, A01, normalised by their sum. Levels 128..255 mirror it (level i uses
// row 255 - i).
export const OSTROMUKHOV_TABLE = Int32Array.from([
  13,0,5, 13,0,5, 21,0,10, 7,0,4, 8,0,5, 47,3,28, 23,3,13, 15,3,8,
  22,6,11, 43,15,20, 7,3,3, 501,224,211, 249,116,103, 165,80,67, 123,62,49, 489,256,191,
  81,44,31, 483,272,181, 60,35,22, 53,32,19, 237,148,83, 471,304,161, 3,2,1, 481,314,185,
  354,226,155, 1389,866,685, 227,138,125, 267,158,163, 327,188,220, 61,34,45, 627,338,505, 1227,638,1075,
  20,10,19, 1937,1000,1767, 977,520,855, 657,360,551, 71,40,57, 2005,1160,1539, 337,200,247, 2039,1240,1425,
  257,160,171, 691,440,437, 1045,680,627, 301,200,171, 177,120,95, 2141,1480,1083, 1079,760,513, 725,520,323,
  137,100,57, 2209,1640,855, 53,40,19, 2243,1720,741, 565,440,171, 759,600,209, 1147,920,285, 2311,1880,513,
  97,80,19, 335,280,57, 1181,1000,171, 793,680,95, 599,520,57, 2413,2120,171, 405,360,19, 2447,2200,57,
  11,10,0, 158,151,3, 178,179,7, 1030,1091,63, 248,277,21, 318,375,35, 458,571,63, 878,1159,147,
  5,7,1, 172,181,37, 97,76,22, 72,41,17, 119,47,29, 4,1,1, 4,1,1, 4,1,1,
  4,1,1, 4,1,1, 4,1,1, 4,1,1, 4,1,1, 4,1,1, 65,18,17, 95,29,26,
  185,62,53, 30,11,9, 35,14,11, 85,37,28, 55,26,19, 80,41,29, 155,86,59, 5,3,2,
  5,3,2, 5,3,2, 5,3,2, 5,3,2, 5,3,2, 5,3,2, 5,3,2, 5,3,2,
  5,3,2, 5,3,2, 5,3,2, 5,3,2, 305,176,119, 155,86,59, 105,56,39, 80,41,29,
  65,32,23, 55,26,19, 335,152,113, 85,37,28, 115,48,37, 35,14,11, 355,136,109, 30,11,9,
  365,128,107, 185,62,53, 25,8,7, 95,29,26, 385,112,103, 65,18,17, 395,104,101, 4,1,1,
]);

/** Normalised weights [right, down-behind, down] for every input level 0..255. */
export const OSTROMUKHOV_WEIGHTS = (() => {
  const out = new Float64Array(256 * 3);
  for (let v = 0; v < 256; v++) {
    const r = (v <= 127 ? v : 255 - v) * 3, t = OSTROMUKHOV_TABLE;
    const sum = t[r] + t[r + 1] + t[r + 2];
    out[v * 3] = t[r] / sum; out[v * 3 + 1] = t[r + 1] / sum; out[v * 3 + 2] = t[r + 2] / sum;
  }
  return out;
})();

const level = v => (v <= 0 ? 0 : v >= 255 ? 255 : Math.round(v));

/**
 * Dither a gray buffer (0..255) in place to 0/255. Weights come from each pixel's
 * original level; `strength` scales how much error is passed on.
 */
export function diffuseOstromukhov(buf, w, h, threshold = 127.5, strength = 1) {
  const W = OSTROMUKHOV_WEIGHTS, orig = Float32Array.from(buf);
  for (let y = 0; y < h; y++) {
    const back = (y & 1) === 1, dir = back ? -1 : 1, row = y * w;
    for (let i = 0, x = back ? w - 1 : 0; i < w; i++, x += dir) {
      const p = row + x, old = buf[p], nv = old < threshold ? 0 : 255;
      buf[p] = nv;
      const err = (old - nv) * strength;
      if (!err) continue;
      const k = level(orig[p]) * 3, nx = x + dir;
      if (nx >= 0 && nx < w) buf[p + dir] = clamp(buf[p + dir] + err * W[k]);
      if (y + 1 < h) {
        const below = p + w;
        if (x - dir >= 0 && x - dir < w) buf[below - dir] = clamp(buf[below - dir] + err * W[k + 1]);
        buf[below] = clamp(buf[below] + err * W[k + 2]);
      }
    }
  }
  return buf;
}

/** Palette version: each channel diffuses its own error with weights from its own level. */
export function paletteOstromukhov(R, G, B, w, h, pal, nearest, strength = 1) {
  const W = OSTROMUKHOV_WEIGHTS, planes = [R, G, B], orig = planes.map(c => Float32Array.from(c));
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const back = (y & 1) === 1, dir = back ? -1 : 1, row = y * w;
    for (let i = 0, x = back ? w - 1 : 0; i < w; i++, x += dir) {
      const p = row + x, k = nearest(pal, R[p], G[p], B[p]);
      out[p] = k;
      for (let c = 0; c < 3; c++) {
        const P = planes[c], err = (P[p] - pal[k * 3 + c]) * strength;
        if (!err) continue;
        const q = level(orig[c][p]) * 3, nx = x + dir;
        if (nx >= 0 && nx < w) P[p + dir] = clamp(P[p + dir] + err * W[q]);
        if (y + 1 < h) {
          const below = p + w;
          if (x - dir >= 0 && x - dir < w) P[below - dir] = clamp(P[below - dir] + err * W[q + 1]);
          P[below] = clamp(P[below] + err * W[q + 2]);
        }
      }
    }
  }
  return out;
}

const clamp = v => (v < 0 ? 0 : v > 255 ? 255 : v);
