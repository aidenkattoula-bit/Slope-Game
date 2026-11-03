// =============================================================================
// TRACK VIEW - turns generator rows into Three.js meshes, chunk by chunk.
//
// * Chunks are built just ahead of the ball and DISPOSED once far behind it,
//   so the scene (and GPU memory) stays constant no matter how long you run.
// * Chunk geometry is stored relative to the chunk origin, so float precision
//   stays perfect even thousands of units from the world origin.
// =============================================================================
import * as THREE from 'three';
import { DZ, ROWS_PER_CHUNK as RPC, TRACK_THICK as T, SLOPE } from './config.js';

const AHEAD_ROWS = 150;   // build this far ahead of the ball (300 units)
const BEHIND_ROWS = 28;   // keep this far behind before disposing
const E = 0.3;            // glowing edge width

function quad(arr, a, b, c, d) {
  arr.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2],
           a[0], a[1], a[2], c[0], c[1], c[2], d[0], d[1], d[2]);
}
function quadC(pos, col, k, a, b, c, d) {
  quad(pos, a, b, c, d);
  for (let i = 0; i < 6; i++) col.push(k, k, k);
}
function geo(pos, col) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  if (col) g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}

/** Unit box with per-face brightness so obstacles read as 3D without lights. */
function makeObstacleGeometry() {
  const g = new THREE.BoxGeometry(1, 1, 1);
  const shade = [0.75, 0.75, 1.0, 0.45, 0.88, 0.55]; // +x -x +y -y +z -z
  const col = [];
  for (let f = 0; f < 6; f++) for (let v = 0; v < 4; v++) col.push(shade[f], shade[f], shade[f]);
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}

export class TrackView {
  constructor(scene) {
    this.group = new THREE.Group();
    scene.add(this.group);
    this.chunks = new Map();
    this.gen = null;
    this.nextChunk = 0;

    this.mats = {
      top: new THREE.MeshBasicMaterial({
        color: 0x160c33, side: THREE.DoubleSide,
        polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2,
      }),
      side: new THREE.MeshBasicMaterial({ color: 0x0b0620, side: THREE.DoubleSide }),
      glow: new THREE.MeshBasicMaterial({ color: 0x39ff88, vertexColors: true, side: THREE.DoubleSide }),
      obst: new THREE.MeshBasicMaterial({ color: 0xff1f45, vertexColors: true }),
      obstLine: new THREE.LineBasicMaterial({ color: 0xffa0b0 }),
    };
    this.obstGeo = makeObstacleGeometry();
    this.obstEdges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
  }

  setTheme(c) {
    this.mats.top.color.copy(c.top);
    this.mats.side.color.copy(c.side);
    this.mats.glow.color.copy(c.edge);
  }

  /** Start showing a new generator (new run). */
  setTrack(gen) {
    this.clear();
    this.gen = gen;
    this.nextChunk = Math.floor(gen.first / RPC);
  }

  clear() {
    for (const [, ch] of this.chunks) this._dispose(ch);
    this.chunks.clear();
  }

  /** Build chunks ahead, dispose chunks behind, prune generator rows. */
  update(ballZ, maxBuild = 2) {
    const gen = this.gen;
    const ballRow = Math.floor(-ballZ / DZ);
    let built = 0;
    while (this.nextChunk * RPC <= ballRow + AHEAD_ROWS && built < maxBuild) {
      this._build(this.nextChunk++);
      built++;
    }
    const keepFrom = ballRow - BEHIND_ROWS;
    let oldest = Infinity;
    for (const [c, ch] of this.chunks) {
      if ((c + 1) * RPC < keepFrom) { this._dispose(ch); this.chunks.delete(c); }
      else oldest = Math.min(oldest, c);
    }
    if (oldest !== Infinity) gen.prune(oldest * RPC - 1);
  }

  _dispose(ch) {
    this.group.remove(ch.group);
    for (const g of ch.geos) g.dispose();
  }

  _build(c) {
    const gen = this.gen;
    const a = c * RPC;
    gen.ensure(a + RPC + 1);
    const ra = gen.row(a);
    const ox = ra.x, oy = ra.y, oz = ra.z;
    const P = (x, y, z) => [x - ox, y - oy, z - oz];

    const top = [], side = [], glow = [], glowC = [];
    const obstacles = [];

    for (let i = a; i < a + RPC; i++) {
      const r0 = gen.row(i), r1 = gen.row(i + 1), rp = gen.row(i - 1);
      if (r0.obs.length) obstacles.push(...r0.obs);
      if (!r0.solid) continue;

      const L0 = P(r0.x - r0.hw, r0.y, r0.z), R0 = P(r0.x + r0.hw, r0.y, r0.z);
      const dn = (p) => [p[0], p[1] - T, p[2]];

      // cap where the surface begins (previous row is a gap)
      if (rp && !rp.solid) {
        quad(side, L0, R0, dn(R0), dn(L0));
        const yi = r0.y + (r1.y - r0.y) * (E / DZ) + 0.03;
        quadC(glow, glowC, 1, [L0[0], L0[1] + 0.03, L0[2]], [R0[0], R0[1] + 0.03, R0[2]],
          [R0[0], yi - oy, R0[2] - E], [L0[0], yi - oy, L0[2] - E]);
      }

      if (!r1.solid) {
        // cap where the surface ends (next row is a gap)
        quad(side, L0, R0, dn(R0), dn(L0));
        const yb = rp ? r0.y + (rp.y - r0.y) * (E / DZ) + 0.03 : r0.y + 0.03;
        quadC(glow, glowC, 1, [L0[0], L0[1] + 0.03, L0[2]], [R0[0], R0[1] + 0.03, R0[2]],
          [R0[0], yb - oy, R0[2] + E], [L0[0], yb - oy, L0[2] + E]);
        continue;
      }

      const L1 = P(r1.x - r1.hw, r1.y, r1.z), R1 = P(r1.x + r1.hw, r1.y, r1.z);
      quad(top, L0, R0, R1, L1);
      quad(side, L0, L1, dn(L1), dn(L0));
      quad(side, R0, R1, dn(R1), dn(R0));

      // glowing edge strips
      const up = (p, dx = 0) => [p[0] + dx, p[1] + 0.03, p[2]];
      quadC(glow, glowC, 1, up(L0), up(L0, E), up(L1, E), up(L1));
      quadC(glow, glowC, 1, up(R0, -E), up(R0), up(R1), up(R1, -E));

      // faint cross lines for a sense of speed
      if (i % 4 === 0) {
        const yz = (r1.y - r0.y) * (0.14 / DZ);
        quadC(glow, glowC, 0.3, up(L0), up(R0),
          [R0[0], R0[1] + 0.03 + yz, R0[2] - 0.14], [L0[0], L0[1] + 0.03 + yz, L0[2] - 0.14]);
      }
    }

    const group = new THREE.Group();
    group.position.set(ox, oy, oz);
    const geos = [];
    const add = (pos, col, mat) => {
      if (!pos.length) return;
      const g = geo(pos, col);
      geos.push(g);
      group.add(new THREE.Mesh(g, mat));
    };
    add(top, null, this.mats.top);
    add(side, null, this.mats.side);
    add(glow, glowC, this.mats.glow);

    const tilt = -Math.atan(SLOPE);
    for (const o of obstacles) {
      const m = new THREE.Mesh(this.obstGeo, this.mats.obst);
      m.scale.set(o.hx * 2, o.hy * 2, o.hz * 2);
      m.position.set(o.x - ox, o.y - oy, o.z - oz);
      m.rotation.x = tilt;
      m.add(new THREE.LineSegments(this.obstEdges, this.mats.obstLine));
      group.add(m);
    }

    this.group.add(group);
    this.chunks.set(c, { group, geos });
  }
}
