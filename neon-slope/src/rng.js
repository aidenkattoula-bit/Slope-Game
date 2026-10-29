// =============================================================================
// SEEDED RANDOM NUMBER GENERATOR
// Same seed string -> exactly the same stream of numbers on every device.
// This is what makes "Seeded Race" and "Pass & Play" tracks identical for all.
// =============================================================================

/** xmur3-style string hash -> 32-bit unsigned int. */
export function hashSeed(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}

/** mulberry32: tiny, fast, good-quality 32-bit PRNG. Returns a () => [0,1) fn. */
export function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Rng {
  constructor(seed) {
    this._f = mulberry32(hashSeed(String(seed)));
  }
  next() { return this._f(); }
  range(a, b) { return a + (b - a) * this._f(); }
  int(a, b) { return Math.floor(this.range(a, b + 1)); }
  chance(p) { return this._f() < p; }
  sign() { return this._f() < 0.5 ? -1 : 1; }
  /** entries: [[value, weight], ...] -> value (weights of 0 are never picked). */
  weighted(entries) {
    let total = 0;
    for (const e of entries) total += e[1];
    let r = this._f() * total;
    for (const e of entries) {
      if (e[1] <= 0) continue;
      r -= e[1];
      if (r <= 0) return e[0];
    }
    return entries[0][0];
  }
}

const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I / O to avoid confusion with 1 / 0

/** Friendly share code like "KQZ48". (Uses Math.random: it only *picks* a seed.) */
export function randomSeed() {
  let s = '';
  for (let i = 0; i < 3; i++) s += LETTERS[Math.floor(Math.random() * LETTERS.length)];
  s += Math.floor(Math.random() * 90 + 10);
  return s;
}

/** Codes are case-insensitive, alphanumeric, max 12 chars. */
export function normalizeSeed(s) {
  return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
}
