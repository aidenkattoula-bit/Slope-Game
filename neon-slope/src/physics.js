// =============================================================================
// PHYSICS + COLLISION (pure data, no rendering)
//
// The ball's forward speed is a function of distance (see config.js). Steering
// adds lateral velocity. The ball is either GROUNDED (glued to the surface,
// following its slope) or AIRBORNE (ballistic, floaty steering). It leaves the
// ground whenever the surface falls away faster than gravity pulls it down
// (ramp lips, drops, gaps) and lands when it meets a solid surface from above.
// Crashes: obstacle hit, running into the side of the track, falling off.
// After a crash the ball keeps simulating as a bouncing, tumbling ragdoll.
// =============================================================================
import {
  BALL_R, GRAVITY, SLOPE, EDGE_TOL, START_D, DZ,
  speedAt, scorePerUnit,
} from './config.js';

export const START_Z = -3 * DZ;
const SUBSTEP = 1 / 120;
const OBST_ANGLE = -Math.atan(SLOPE); // obstacles are tilted with the slope

export class Sim {
  constructor(track) {
    this.track = track;
    this.s = {};
    this.reset();
  }

  reset() {
    this.ball = { x: 0, y: 0, z: START_Z, vx: 0, vy: 0, vz: -1, grounded: true };
    this.track.sample(START_Z, this.s);
    this.ball.x = this.s.x;
    this.ball.y = this.s.y + BALL_R;
    this.alive = true;
    this.crash = null;        // 'obstacle' | 'wall' | 'fall'
    this.crashT = 0;
    this.score = 0;
    this.distance = 0;
    this.speed = speedAt(0);
    this.nextBlip = 100;
    this.events = [];         // consumed by the game: {type, ...}
    this.lastSurfY = this.s.y;
  }

  /** Advance by dt seconds. steer in [-1, 1]. */
  update(dt, steer) {
    const n = Math.max(1, Math.ceil(dt / SUBSTEP));
    const h = dt / n;
    for (let k = 0; k < n; k++) {
      if (this.alive) this._step(h, steer);
      else this._ragdoll(h);
    }
  }

  // ---- live ball ------------------------------------------------------------
  _step(h, steer) {
    const b = this.ball, tr = this.track, s = this.s;

    // forward speed by distance; score by distance and speed
    const d = Math.max(0, -b.z - START_D);
    const spd = speedAt(d);
    this.speed = spd;
    b.vz = -spd;
    const dd = spd * h;
    this.distance += dd;
    this.score += dd * scorePerUnit(spd);
    if (this.score >= this.nextBlip) {
      this.nextBlip += 100;
      this.events.push({ type: 'blip' });
    }

    // steering: snappy on the ground, floaty in the air
    const maxLat = b.grounded ? 12 + spd * 0.1 : 9;
    const target = steer * maxLat;
    const acc = steer !== 0 ? (b.grounded ? 75 : 18) : (b.grounded ? 55 : 2.2);
    const dv = target - b.vx;
    const lim = acc * h;
    b.vx += dv > lim ? lim : dv < -lim ? -lim : dv;
    b.x += b.vx * h;
    b.z += b.vz * h;

    tr.sample(b.z, s);
    const supported = s.solid && Math.abs(b.x - s.x) < s.hw + EDGE_TOL;

    if (b.grounded) {
      if (supported) {
        const ty = s.y + BALL_R;
        const yb = b.y + b.vy * h - 0.5 * GRAVITY * h * h;
        if (yb > ty + 0.05) {            // surface fell away -> take off
          b.grounded = false;
          b.y = yb;
          b.vy -= GRAVITY * h;
        } else {                          // stay glued to the slope
          b.y = ty;
          b.vy = s.slope * b.vz;
        }
      } else {                            // rolled off the edge / into a gap
        b.grounded = false;
        b.y += b.vy * h - 0.5 * GRAVITY * h * h;
        b.vy -= GRAVITY * h;
      }
    } else {
      const yPrev = b.y;
      b.vy -= GRAVITY * h;
      b.y += b.vy * h;
      if (supported) {
        const bottom = b.y - BALL_R;
        if (bottom <= s.y) {
          if (yPrev - BALL_R >= this.lastSurfY - 0.12) {   // came from above: land
            const impact = -(b.vy - s.slope * b.vz);
            b.grounded = true;
            b.y = s.y + BALL_R;
            b.vy = s.slope * b.vz;
            if (impact > 5) this.events.push({ type: 'land', impact });
          } else if (bottom < s.y - 0.25) {                // hit the side of the track
            this._crash('wall');
          }
        }
      }
    }
    this.lastSurfY = s.y;

    if (this.alive && b.y < s.ymin - 5) this._crash('fall');
    if (this.alive) this._checkObstacles(s.i);
  }

  /** Sphere vs. tilted box, for obstacles in the rows around the ball. */
  _checkObstacles(ri) {
    const b = this.ball, tr = this.track;
    const c = Math.cos(OBST_ANGLE), sn = Math.sin(OBST_ANGLE);
    const rad = BALL_R * 0.92;
    for (let i = ri - 1; i <= ri + 2; i++) {
      const r = tr.row(i);
      if (!r || r.obs.length === 0) continue;
      for (const o of r.obs) {
        const dx = b.x - o.x, dy = b.y - o.y, dz = b.z - o.z;
        const ly = dy * c + dz * sn;
        const lz = -dy * sn + dz * c;
        const cx = Math.max(-o.hx, Math.min(o.hx, dx));
        const cy = Math.max(-o.hy, Math.min(o.hy, ly));
        const cz = Math.max(-o.hz, Math.min(o.hz, lz));
        const ex = dx - cx, ey = ly - cy, ez = lz - cz;
        if (ex * ex + ey * ey + ez * ez < rad * rad) { this._crash('obstacle'); return; }
      }
    }
  }

  _crash(kind) {
    if (!this.alive) return;
    const b = this.ball;
    this.alive = false;
    this.crash = kind;
    this.crashT = 0;
    if (kind !== 'fall') {
      b.vz *= 0.25;
      b.vy += 5;
      b.vx += (Math.random() - 0.5) * 10;
    }
    b.grounded = false;
    this.events.push({ type: 'crash', kind });
  }

  // ---- crashed ball: bounce, tumble, slide off -------------------------------
  _ragdoll(h) {
    const b = this.ball, s = this.s;
    this.crashT += h;
    b.vy -= GRAVITY * h;
    b.x += b.vx * h; b.y += b.vy * h; b.z += b.vz * h;
    this.track.sample(b.z, s);
    if (s.solid && Math.abs(b.x - s.x) < s.hw && b.y - BALL_R < s.y && b.y - BALL_R > s.y - 1.0) {
      const rel = b.vy - s.slope * b.vz;
      if (rel < 0) b.vy = s.slope * b.vz - rel * 0.4;
      b.y = s.y + BALL_R;
      b.vz -= 9 * h;          // slide down the slope
      b.vx *= 0.995;
    }
  }
}

// =============================================================================
// AUTOPILOT (used for the menu attract mode and by test/bot.mjs)
// =============================================================================
export function botSteer(sim) {
  const b = sim.ball, tr = sim.track;
  const spd = Math.max(1, -b.vz);
  const look = {};
  tr.sample(b.z - Math.max(4, spd * 0.32), look);
  let target = look.x;

  // upcoming obstacle rows within ~1.6 s
  const i0 = Math.floor(-b.z / DZ);
  const horizon = Math.ceil((spd * 1.6) / DZ);
  const groups = [];
  for (let i = i0; i <= i0 + horizon; i++) {
    const r = tr.row(i);
    if (r && r.obs.length && b.z - r.z > -1.8) groups.push({ r, t: Math.max(0, (b.z - r.z) / spd) });
  }
  if (groups.length) {
    const margin = BALL_R * 0.92 + 0.2;   // same clearance the generator guarantees
    // candidate x positions per group that are on the track and clear of blocks
    const grids = groups.map(({ r }) => {
      const xs = [];
      const half = Math.max(0, r.hw - 0.7);
      for (let x = r.x - half; x <= r.x + half + 1e-6; x += 0.25) {
        if (!r.obs.some((o) => Math.abs(x - o.x) < o.hx + margin)) xs.push(x);
      }
      return xs;
    });
    // backward pass: cost-to-go J for every free position (squared lateral
    // movement spreads steering out instead of leaving it to the last moment)
    const reachV = (12 + spd * 0.1) * 0.75;
    const viable = grids.map((g) => g.slice());
    const J = grids.map((g) => g.map(() => 0));
    for (let k = groups.length - 2; k >= 0; k--) {
      const reach = reachV * Math.max(0.05, groups[k + 1].t - groups[k].t) + 0.5;
      const keepX = [], keepJ = [];
      grids[k].forEach((x) => {
        let best = Infinity;
        viable[k + 1].forEach((x2, j) => {
          const dx = Math.abs(x2 - x);
          if (dx <= reach) best = Math.min(best, dx * dx + J[k + 1][j]);
        });
        if (best < Infinity) { keepX.push(x); keepJ.push(best); }
      });
      viable[k] = keepX; J[k] = keepJ;
    }
    const reach0 = reachV * Math.max(0.05, groups[0].t) + 0.4;
    let idx = viable[0].map((_, j) => j).filter((j) => Math.abs(viable[0][j] - b.x) <= reach0);
    if (!idx.length) idx = viable[0].map((_, j) => j);
    let bestCost = Infinity;
    for (const j of idx) {
      const dx = viable[0][j] - b.x;
      const cost = dx * dx + J[0][j] + Math.abs(viable[0][j] - look.x) * 0.05;
      if (cost < bestCost) { bestCost = cost; target = viable[0][j]; }
    }
  }
  // steer maps to a target lateral speed: command the fastest speed that still
  // lets the ball brake to a stop on the target (no overshoot off the edge)
  const maxLat = b.grounded ? 12 + spd * 0.1 : 9;
  // never aim off the road *right now* (curves move the road under future targets)
  const cur = {};
  tr.sample(b.z, cur);
  const lo = Math.max(cur.x - (cur.hw - 0.6), look.x - (look.hw - 0.6));
  const hi = Math.min(cur.x + (cur.hw - 0.6), look.x + (look.hw - 0.6));
  target = lo <= hi ? Math.max(lo, Math.min(hi, target)) : look.x;
  sim.botTarget = target; // (debug aid)
  const e = target - b.x;
  const vd = Math.sign(e) * Math.min(maxLat, Math.sqrt(70 * Math.abs(e)), 8 * Math.abs(e));
  return Math.max(-1, Math.min(1, vd / maxLat));
}
