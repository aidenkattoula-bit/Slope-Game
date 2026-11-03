// =============================================================================
// COLOUR THEMES - the palette drifts as the score climbs
// =============================================================================
import * as THREE from 'three';

const THEMES = [
  { edge: 0x39ff88, top: 0x160c33, side: 0x0b0620, fog: 0x0a0418, glow: 0x39ffb0 }, // neon green
  { edge: 0x22e6ff, top: 0x0c1c3d, side: 0x050d22, fog: 0x050a1c, glow: 0x22e6ff }, // cyan
  { edge: 0xb06bff, top: 0x1d0f3d, side: 0x0d0622, fog: 0x0c0420, glow: 0xb06bff }, // violet
  { edge: 0xff4fd8, top: 0x2b0b30, side: 0x14051a, fog: 0x14041a, glow: 0xff4fd8 }, // magenta
  { edge: 0xffb02e, top: 0x2a1408, side: 0x140803, fog: 0x140603, glow: 0xffb02e }, // amber
];
const POINTS_PER_THEME = 300;

const A = Object.fromEntries(Object.keys(THEMES[0]).map((k) => [k, new THREE.Color()]));
const B = Object.fromEntries(Object.keys(THEMES[0]).map((k) => [k, new THREE.Color()]));
const OUT = Object.fromEntries(Object.keys(THEMES[0]).map((k) => [k, new THREE.Color()]));

/** Returns a (reused) object of THREE.Colors for the given score. Each theme is
 *  held steady, then blended into the next over the last 35% of its range. */
export function themeAt(score) {
  const t = Math.max(0, score) / POINTS_PER_THEME;
  const i = Math.floor(t);
  const f = t - i;
  const k = Math.min(1, Math.max(0, (f - 0.65) / 0.35));
  const blend = k * k * (3 - 2 * k);
  const a = THEMES[i % THEMES.length], b = THEMES[(i + 1) % THEMES.length];
  for (const key of Object.keys(a)) {
    A[key].setHex(a[key]);
    B[key].setHex(b[key]);
    OUT[key].copy(A[key]).lerp(B[key], blend);
  }
  return OUT;
}
