// Built-in pictures for PFHOR to mosaic before you open your own: a stylized portrait,
// lit spheres (from DURANDAL), and big type.
import {makeCanvas} from '@studio/core';

export const SAMPLES = {portrait: 'Portrait', spheres: 'Spheres', type: 'Type'};

function portrait(x, W, H) {
  let g = x.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, '#e8e4dc'); g.addColorStop(1, '#8c9aa3');
  x.fillStyle = g; x.fillRect(0, 0, W, H);
  // Shoulders.
  g = x.createLinearGradient(0, H * 0.7, 0, H);
  g.addColorStop(0, '#3a4a5c'); g.addColorStop(1, '#141c26');
  x.fillStyle = g;
  x.beginPath(); x.ellipse(W / 2, H * 1.02, W * 0.42, H * 0.26, 0, 0, Math.PI * 2); x.fill();
  // Neck.
  x.fillStyle = '#b07a58'; x.fillRect(W / 2 - W * 0.07, H * 0.6, W * 0.14, H * 0.18);
  // Face, lit from the upper left.
  g = x.createRadialGradient(W * 0.44, H * 0.36, W * 0.03, W / 2, H * 0.42, W * 0.3);
  g.addColorStop(0, '#f6d2b4'); g.addColorStop(0.6, '#d49a74'); g.addColorStop(1, '#8a5638');
  x.fillStyle = g;
  x.beginPath(); x.ellipse(W / 2, H * 0.42, W * 0.2, H * 0.24, 0, 0, Math.PI * 2); x.fill();
  // Hair.
  x.fillStyle = '#2a1a12';
  x.beginPath(); x.ellipse(W / 2, H * 0.27, W * 0.22, H * 0.13, 0, Math.PI, Math.PI * 2); x.fill();
  x.beginPath(); x.ellipse(W / 2 - W * 0.18, H * 0.36, W * 0.05, H * 0.13, 0.2, 0, Math.PI * 2); x.fill();
  x.beginPath(); x.ellipse(W / 2 + W * 0.18, H * 0.36, W * 0.05, H * 0.13, -0.2, 0, Math.PI * 2); x.fill();
  // Eyes, brows, nose and mouth: the detail the quadtree should find.
  for (const s of [-1, 1]) {
    const ex = W / 2 + s * W * 0.08, ey = H * 0.41;
    x.fillStyle = '#fbf6ee'; x.beginPath(); x.ellipse(ex, ey, W * 0.04, H * 0.018, 0, 0, Math.PI * 2); x.fill();
    x.fillStyle = '#3b2a1e'; x.beginPath(); x.arc(ex, ey, W * 0.018, 0, Math.PI * 2); x.fill();
    x.fillStyle = '#0c0806'; x.beginPath(); x.arc(ex, ey, W * 0.008, 0, Math.PI * 2); x.fill();
    x.strokeStyle = '#2a1a12'; x.lineWidth = W * 0.012; x.lineCap = 'round';
    x.beginPath(); x.moveTo(ex - s * W * 0.045, ey - H * 0.04); x.quadraticCurveTo(ex, ey - H * 0.06, ex + s * W * 0.04, ey - H * 0.035); x.stroke();
  }
  x.strokeStyle = '#9a5e40'; x.lineWidth = W * 0.008;
  x.beginPath(); x.moveTo(W / 2, H * 0.43); x.lineTo(W / 2 - W * 0.02, H * 0.5); x.lineTo(W / 2 + W * 0.015, H * 0.51); x.stroke();
  x.fillStyle = '#a8343a';
  x.beginPath(); x.ellipse(W / 2, H * 0.565, W * 0.06, H * 0.018, 0, 0, Math.PI * 2); x.fill();
}

function spheres(x, W, H) {
  let g = x.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#f3f1ec'); g.addColorStop(1, '#6f7a80');
  x.fillStyle = g; x.fillRect(0, 0, W, H);
  const ball = (cx, cy, r, light, dark) => {
    x.save(); x.translate(cx, cy + r * 0.95); x.scale(1, 0.18);
    g = x.createRadialGradient(0, 0, 0, 0, 0, r * 1.3);
    g.addColorStop(0, 'rgba(0,0,0,.55)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g; x.fillRect(-r * 1.4, -r * 1.4, r * 2.8, r * 2.8); x.restore();
    g = x.createRadialGradient(cx - r * 0.4, cy - r * 0.45, r * 0.05, cx, cy, r);
    g.addColorStop(0, '#ffffff'); g.addColorStop(0.25, light); g.addColorStop(0.8, dark); g.addColorStop(1, '#050505');
    x.fillStyle = g; x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.fill();
  };
  ball(W * 0.39, H * 0.47, W * 0.22, '#d9c08a', '#4c3046');
  ball(W * 0.76, H * 0.7, W * 0.11, '#a9c3d4', '#00304e');
  ball(W * 0.14, H * 0.8, W * 0.06, '#c9d69a', '#3e4a19');
}

function type(x, W, H) {
  x.fillStyle = '#f2efe8'; x.fillRect(0, 0, W, H);
  const g = x.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, '#141414'); g.addColorStop(1, '#6a6a6a');
  x.fillStyle = g;
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.font = `800 ${Math.round(H * 0.3)}px montserrat, system-ui, sans-serif`;
  x.fillText('PFHOR', W / 2, H * 0.42);
  x.font = `500 ${Math.round(H * 0.07)}px montserrat, system-ui, sans-serif`;
  x.fillText('big where it’s flat, small where it’s busy', W / 2, H * 0.68);
}

const cache = {};
/** A sample as a canvas (drawn once). */
export function sampleCanvas(kind) {
  if (cache[kind]) return cache[kind];
  const W = 960, H = 1200, c = makeCanvas(W, H), x = c.getContext('2d');
  (kind === 'spheres' ? spheres : kind === 'type' ? type : portrait)(x, W, H);
  return (cache[kind] = c);
}
