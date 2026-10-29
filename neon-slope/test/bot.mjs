// Headless sanity test: an autopilot plays many seeds. Verifies the generator is
// deterministic and that courses are survivable (no impossible jumps / walls).
//   npm run test:bot
import { TrackGenerator } from '../src/track.js';
import { Sim, botSteer } from '../src/physics.js';
import { DZ } from '../src/config.js';

// determinism
const sig = (seed) => {
  const g = new TrackGenerator(seed);
  g.ensure(800);
  return g.rows.map((r) => `${r.x.toFixed(3)},${r.y.toFixed(3)},${r.hw.toFixed(3)},${r.solid},${r.obs.length}`).join('|');
};
console.log('deterministic:', sig('FUN42') === sig('FUN42'), ' different seeds differ:', sig('FUN42') !== sig('FUN43'));

const MAX_DIST = Number(process.env.MAX_DIST || 7000);
const results = [];
const crashes = {};
for (let n = 0; n < 40; n++) {
  const seed = 'T' + n;
  const gen = new TrackGenerator(seed);
  const sim = new Sim(gen);
  let t = 0;
  while (sim.alive && sim.distance < MAX_DIST && t < 400) {
    gen.ensure(Math.floor(-sim.ball.z / DZ) + 160);
    sim.update(1 / 60, botSteer(sim));
    t += 1 / 60;
  }
  if (!sim.alive) {
    crashes[sim.crash] = (crashes[sim.crash] || 0) + 1;
    results.push({ seed, dist: Math.round(sim.distance), crash: sim.crash, z: sim.ball.z.toFixed(0), score: Math.floor(sim.score) });
  } else results.push({ seed, dist: Math.round(sim.distance), crash: 'survived', score: Math.floor(sim.score) });
}
results.sort((a, b) => a.dist - b.dist);
console.log(results.slice(0, 12));
console.log('crash types:', crashes, ' survived:', results.filter((r) => r.crash === 'survived').length, '/ 40');
