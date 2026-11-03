// =============================================================================
// TRACK GENERATOR (pure data, no rendering)
//
// The track is a list of "rows" spaced DZ apart along -Z. Each row stores the
// centre x, half-width, surface height, whether there is a surface at all
// (false = gap) and any obstacles. Rendering (trackview.js) and physics
// (physics.js) both read the same rows.
//
// Rows are produced by "patterns" (curves, obstacle fields, ramp+gap jumps,
// hops, drops) chosen by a seeded RNG, so a seed always yields the same course.
// The RNG is only consumed here, in row order, so generation never depends on
// how the player plays.
// =============================================================================
import { Rng } from './rng.js';
import {
  DZ, SLOPE, RAMP_M, GRAVITY, ROWS_PER_CHUNK, OBST_H,
  speedAt, difficultyAt,
} from './config.js';

export const BEHIND_ROWS = ROWS_PER_CHUNK; // start platform behind the ball
const lerp = (a, b, t) => a + (b - a) * t;
const AIR_KINDS = new Set(['gap', 'hop', 'drop']);

export class TrackGenerator {
  constructor(seed, mult = 1) {
    this.seed = seed;
    this.mult = mult;
    this.rng = new Rng(seed);
    this.rows = [];
    this.first = -BEHIND_ROWS; // index of rows[0]
    this.next = -BEHIND_ROWS;  // index of the next row to generate

    // running state of the centre line / width / height
    this.cx = 0;
    this.psi = 0;          // heading: dx per unit z
    this.psiTarget = 0;
    this.psiRate = 0.08;
    this.hw = 4.6;
    this.hwTarget = 4.6;
    this.drop = 0;         // accumulated step-downs
    this.safeUntil = 0;    // no obstacles before this row index
    this.nextObs = 0;
    this.free = null;      // reachable lateral ranges at the last obstacle row
    this.lastKind = 'start';
    this.lastSign = 1;

    // safe, straight start platform
    for (let i = 0; i < BEHIND_ROWS + 14; i++) this._push();
  }

  _v(d) { return speedAt(d, this.mult); }

  // ---- access ---------------------------------------------------------------
  row(i) { return this.rows[i - this.first]; }

  /** Make sure rows up to index i exist. */
  ensure(i) { while (this.next <= i) this._nextPattern(); }

  /** Forget rows older than index i (they are behind the player forever). */
  prune(i) {
    const n = i - this.first;
    if (n > 24) { this.rows.splice(0, n); this.first = i; }
  }

  /**
   * Sample the surface at world z. Fills `out`:
   *  y, x (centre), hw, solid, slope (dy/dz), ymin, i (row index)
   */
  sample(z, out) {
    const f = -z / DZ;
    const i = Math.floor(f);
    const t = f - i;
    const a = this.row(i), b = this.row(i + 1);
    out.i = i;
    if (!a || !b) {
      out.solid = false; out.y = -1e5; out.ymin = -1e5; out.x = 0; out.hw = 0; out.slope = 0;
      return out;
    }
    out.y = a.y + (b.y - a.y) * t;
    out.ymin = Math.min(a.y, b.y);
    out.x = a.x + (b.x - a.x) * t;
    out.hw = a.hw + (b.hw - a.hw) * t;
    out.solid = a.solid && b.solid;
    out.slope = (b.y - a.y) / (b.z - a.z);
    return out;
  }

  // ---- row emission ---------------------------------------------------------
  _push({ solid = true, yOff = 0 } = {}) {
    const i = this.next++;
    this.psi += (this.psiTarget - this.psi) * this.psiRate;
    this.cx += this.psi * DZ;
    this.hw += (this.hwTarget - this.hw) * 0.12;
    const r = {
      i, z: -i * DZ, x: this.cx, hw: this.hw,
      y: -i * DZ * SLOPE - this.drop + yOff,
      solid, obs: [],
    };
    this.rows.push(r);
    return r;
  }

  _baseWidth(D) { return lerp(4.6, 2.6, D); }

  _setWidth(D) {
    const rng = this.rng;
    const base = this._baseWidth(D);
    this.hwTarget = rng.chance(0.12 + 0.3 * D)
      ? Math.max(1.9, base * rng.range(0.62, 0.82))
      : base;
  }

  _setCurve(D, v) {
    const rng = this.rng;
    if (!rng.chance(0.78)) { this.psiTarget = 0; return; }
    let sign = rng.chance(0.65) ? -this.lastSign : this.lastSign;
    if (Math.abs(this.cx) > 30) sign = this.cx > 0 ? -1 : 1; // keep near the origin
    this.lastSign = sign;
    const maxPsi = (0.1 + 0.14 * D) * Math.min(1, 34 / v);
    this.psiTarget = sign * rng.range(0.05, maxPsi);
  }

  /** Straighten out and widen before airborne sections. */
  _prepareAir(D, rows = 5) {
    this.psiTarget = 0;
    this.psiRate = 0.25;
    this.hwTarget = Math.max(this._baseWidth(D), 3.2);
    for (let k = 0; k < rows; k++) this._push();
    this.psiRate = 0.08;
  }

  // ---- patterns -------------------------------------------------------------
  _nextPattern() {
    const d = this.next * DZ;
    const D = difficultyAt(d);
    const v = this._v(d);
    const rng = this.rng;
    const air = AIR_KINDS.has(this.lastKind);
    const kind = rng.weighted([
      ['straight', 2],
      ['curve', 3],
      ['obstacles', d > 50 ? 2 + 5 * D : 0],
      ['gap', !air && v >= 19 && d > 200 ? 1.2 + 2 * D : 0],
      ['hop', !air && d > 150 ? 1 : 0],
      ['drop', !air && d > 300 ? 1 + D : 0],
    ]);
    this.lastKind = kind;

    switch (kind) {
      case 'straight': this._patPlain(D, v, false, false); break;
      case 'curve': this._patPlain(D, v, true, false); break;
      case 'obstacles': this._patPlain(D, v, rng.chance(0.5), true); break;
      case 'gap': this._patGap(D); break;
      case 'hop': this._patHop(D); break;
      case 'drop': this._patDrop(D); break;
    }
  }

  _patPlain(D, v, curve, obstacles) {
    const rng = this.rng;
    this._setWidth(D);
    if (curve) this._setCurve(D, v); else if (rng.chance(0.5)) this.psiTarget = 0;
    if (obstacles) this.psiTarget *= 0.5; // gentler bends inside obstacle fields
    const n = obstacles ? rng.int(10, 20) : rng.int(8, 18);
    for (let k = 0; k < n; k++) {
      const r = this._push();
      if (obstacles) this._maybeObstacle(r, D);
    }
  }

  /** Ramp that launches the ball over a gap. Size is derived from the speed
   *  the player will have at that distance, so it is always makeable. */
  _patGap(D) {
    const rng = this.rng;
    this._prepareAir(D, rng.int(4, 6));
    const R = 4;
    for (let k = 0; k < R; k++) this._push({ yOff: RAMP_M * DZ * (k + 1) });
    const lip = this.next - 1;
    const v = this._v(lip * DZ);
    const F = (2 * RAMP_M * v * v) / GRAVITY; // flight distance on the base line
    const Gt = F * lerp(0.42, 0.7, D);
    const g = Math.max(1, Math.round(Gt / DZ) - 1);
    for (let k = 0; k < g; k++) this._push({ solid: false });
    const L = Math.max(5, Math.ceil((F - (g + 1) * DZ) / DZ) + 4);
    for (let k = 0; k < L; k++) this._push();
    this.safeUntil = this.next + 2;
    this.free = null;
  }

  _patHop(D) {
    const rng = this.rng;
    this._prepareAir(D, rng.int(3, 5));
    const R = rng.int(3, 4);
    for (let k = 0; k < R; k++) this._push({ yOff: RAMP_M * DZ * (k + 1) });
    const v = this._v((this.next - 1) * DZ);
    const F = (2 * RAMP_M * v * v) / GRAVITY;
    const L = Math.ceil(F / DZ) + 4;
    for (let k = 0; k < L; k++) this._push();
    this.safeUntil = this.next + 2;
    this.free = null;
  }

  _patDrop(D) {
    const rng = this.rng;
    this._prepareAir(D, 3);
    const h = rng.range(2, 3 + 2 * D);
    this.drop += h;
    const v = this._v(this.next * DZ);
    const dist = v * Math.sqrt((2 * h) / GRAVITY);
    const L = Math.ceil(dist / DZ) + 5;
    for (let k = 0; k < L; k++) this._push();
    this.safeUntil = this.next + 2;
    this.free = null;
  }

  // ---- obstacles ------------------------------------------------------------
  // Obstacles are proposed as [{x, w}] and only accepted if a comfortable
  // path through them still exists (see _feasible). That guarantees every
  // course is beatable no matter what the RNG rolls.
  _addObs(r, x, w) {
    r.obs.push({ x, y: r.y + OBST_H / 2, z: r.z, hx: w / 2, hy: OBST_H / 2, hz: 0.6 });
  }

  _maybeObstacle(r, D) {
    const rng = this.rng;
    if (r.i < this.safeUntil || r.i < this.nextObs) return;
    if (!rng.chance(0.45 + 0.4 * D)) return;
    const v = this._v(r.i * DZ);
    for (let attempt = 0; attempt < 3; attempt++) {
      const blocks = this._propose(r, D);
      const free = this._feasible(r, blocks, v);
      if (!free) continue;
      for (const b of blocks) this._addObs(r, b.x, b.w);
      this.free = { i: r.i, ranges: free };
      const react = lerp(0.7, 0.42, D); // seconds of warning between obstacles
      this.nextObs = r.i + Math.ceil((v * react) / DZ) + rng.int(0, 2);
      return;
    }
    this.nextObs = r.i + 1; // nothing fit here; try the next row
  }

  _propose(r, D) {
    const rng = this.rng;
    const hw = r.hw;
    const d = r.i * DZ;
    const kind = rng.weighted([
      ['single', 5],
      ['wall', d > 400 ? 1 + 3 * D : 0],
      ['double', d > 250 ? 1 + 2 * D : 0],
    ]);

    if (kind === 'wall') {
      const ow = Math.min(Math.max(2.3, lerp(4.6, 2.6, D)), 2 * hw - 0.6);
      if (ow >= 2.0) {
        const half = hw - ow / 2;
        const oc = rng.range(-half, half);
        const out = [];
        const wl = oc - ow / 2 + hw;
        const wr = hw - (oc + ow / 2);
        if (wl > 0.25) out.push({ x: r.x + (-hw + oc - ow / 2) / 2, w: wl });
        if (wr > 0.25) out.push({ x: r.x + (oc + ow / 2 + hw) / 2, w: wr });
        return out;
      }
    } else if (kind === 'double') {
      const w = rng.range(1.1, 1.6);
      const aMax = hw - 2.4 - 1.5 * w;
      const aMin = -hw + w / 2;
      if (aMax > aMin) {
        const a = rng.range(aMin, aMax);
        return [{ x: r.x + a, w }, { x: r.x + a + w + 2.4, w }];
      }
    }
    const w = Math.min(rng.range(1.2, 2.4), hw);
    const half = Math.max(0, hw - w / 2 - 0.1);
    return [{ x: r.x + rng.range(-half, half), w }];
  }

  /**
   * Which lateral offsets (relative to the track centre) can the ball occupy at
   * row r, given where it could have been at the previous obstacle row and how
   * far it can steer in between? Returns ranges, or null if none are wide enough.
   */
  _feasible(r, blocks, v) {
    const clear = 0.55 + 0.2;              // ball radius + safety
    const lo0 = -(r.hw - 0.7), hi0 = r.hw - 0.7;
    let ranges;
    const dt = this.free ? ((r.i - this.free.i) * DZ) / v : Infinity;
    if (dt > 1.6) {
      ranges = [[lo0, hi0]];
    } else {
      // following a curve already costs lateral speed; keep the rest as reach
      const reach = Math.max(2.0, 0.6 * (12 + 0.1 * v) - Math.abs(this.psi) * v) * dt + 0.3;
      ranges = this.free.ranges
        .map(([a, b]) => [Math.max(lo0, a - reach), Math.min(hi0, b + reach)])
        .filter(([a, b]) => b > a);
    }
    for (const o of blocks) {
      const bl = o.x - r.x - o.w / 2 - clear, bh = o.x - r.x + o.w / 2 + clear;
      const next = [];
      for (const [a, b] of ranges) {
        if (bh <= a || bl >= b) next.push([a, b]);
        else { if (bl > a) next.push([a, bl]); if (bh < b) next.push([bh, b]); }
      }
      ranges = next;
    }
    ranges = ranges.filter(([a, b]) => b - a >= 0.5);
    return ranges.length ? ranges : null;
  }
}
