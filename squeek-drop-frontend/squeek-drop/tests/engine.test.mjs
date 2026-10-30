// Historical prototype regression only. Current supply-station tests live at root /tests.
import { Sim, replay, INPUT, Rng, W } from '../../../engines/sd-1.0.0/engine.js';
import assert from 'node:assert/strict';

function bot(cfg, botSeed, smart) {
  const sim = new Sim(cfg); const r = new Rng(botSeed);
  while (!sim.over) {
    if (sim.canDrop()) {
      let x = 20 + r.int(W - 40);
      if (smart) { // drop above same-level ball if any
        const t = sim.balls.filter(b => b.lv === sim.current).sort((a,b)=>a.y-b.y)[0];
        if (t) x = Math.floor(t.x);
      }
      if (r.int(40) === 0) sim.apply(INPUT.SWAP);
      if (r.int(300) === 0) sim.apply(INPUT.SHAKE);
      sim.apply(INPUT.DROP, x);
    }
    sim.step(); sim.events.length = 0;
  }
  return sim;
}
for (const w of ['NAP', 'JOG', 'ZOOMIES']) for (const smart of [false, true]) {
  const cfg = { seed: 'daily-2026-10-30', weather: w, blockStart: 734000000, captainLevel: 0 };
  const s = bot(cfg, 7, smart);
  const rep = replay(cfg, s.inputs, s.tick);
  assert.ok(rep.ok, rep.reason);
  assert.equal(rep.summary.digest, s.digest());
  assert.equal(rep.summary.score, s.score);
  console.log(w, smart ? 'smart' : 'rand ', 'score', s.score, 'secs', (s.tick/60).toFixed(0), 'merges', s.merges, 'maxLv', s.maxLevel, 'blocks', s.blocks, 'digest', s.digest());
}
// Tamper check: shifting one input must change outcome or be rejected
const cfg = { seed: 'x', weather: 'JOG', blockStart: 0 };
const s = bot(cfg, 3, true);
const bad = s.inputs.map(a => a.slice()); bad[5][2] = (bad[5][2] + 50) % 400;
const r2 = replay(cfg, bad, s.tick);
assert.ok(!r2.ok || r2.summary.digest !== s.digest());
// Cooldown abuse rejected
const r3 = replay(cfg, [[0,0,100],[1,0,200]], 100);
assert.equal(r3.ok, false);
console.log('all engine tests passed');
