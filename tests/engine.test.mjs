import test from "node:test";
import assert from "node:assert/strict";
import {
  Sim,
  replay,
  INPUT,
  MAX_TICKS,
} from "../squeek-drop-frontend/squeek-drop/js/engine.js";
import {
  practiceConfig,
  phaseFromSettlement,
} from "../squeek-drop-frontend/squeek-drop/js/challenge.js";
import { play } from "./helpers.mjs";

test("three-stage full runs reproduce scores, missions, digest and input log", () => {
  for (const seed of ["one", "two", "three", "four"]) {
    const cfg = practiceConfig(seed);
    const p = play(cfg, MAX_TICKS);
    const result = replay(cfg, p.inputs, p.endTick);
    assert.ok(result.ok, result.reason);
    assert.deepEqual(result.summary, p.clientSummary);
    assert.ok(p.clientSummary.score > 0);
    assert.ok(p.clientSummary.deliveries > 0);
  }
});
test("delivery removes only mature exact-level supply and caps quota", () => {
  const s = new Sim(practiceConfig());
  s.tick = 100;
  const ball = (id, lv, born = 0) => ({
    id,
    lv,
    born,
    x: 100,
    y: 500,
    vx: 0,
    vy: 0,
  });
  s.balls = [ball(1, 2), ball(2, 3, 90)];
  assert.equal(s.apply(INPUT.DELIVER), false);
  s.balls.push(ball(3, 3));
  assert.equal(s.apply(INPUT.DELIVER), true);
  assert.deepEqual(
    s.balls.map((b) => b.id),
    [1, 2],
  );
  assert.equal(s.score, 120);
  s.balls.push(ball(4, 3));
  s.apply(INPUT.DELIVER);
  assert.equal(s.score, 440);
  assert.equal(s.completedMissions, 1);
  s.balls.push(ball(5, 3));
  assert.equal(s.apply(INPUT.DELIVER), false);
  assert.equal(s.deliveries, 2);
});
test("phase boundaries reset tools but not board; time limit is exactly 180 seconds", () => {
  const s = new Sim(practiceConfig());
  s.shakes = 0;
  for (let i = 0; i < 3600; i++) s.step();
  assert.equal(s.phaseIndex, 1);
  assert.equal(s.shakes, 1);
  assert.equal(s.phase.weather, "JOG");
  for (let i = 3600; i < MAX_TICKS; i++) s.step();
  assert.equal(s.phaseIndex, 2);
  assert.equal(s.tick, 10800);
  assert.equal(s.over, true);
});
test("cooldown, unavailable delivery, out-of-order and trailing input reject", () => {
  const c = practiceConfig();
  for (const [inputs, endTick] of [
    [
      [
        [0, 0, 200],
        [1, 0, 200],
      ],
      100,
    ],
    [[[0, 3]], 100],
    [
      [
        [20, 0, 200],
        [10, 1],
      ],
      100,
    ],
    [[[100, 0, 200]], 100],
  ])
    assert.equal(replay(c, inputs, endTick).ok, false);
});
test("tampering and changed mission configuration change replay outcome", () => {
  const c = practiceConfig("tamper");
  const p = play(c, 1800);
  const inputs = structuredClone(p.inputs);
  inputs.splice(1, 0, [1, 0, 200]);
  const r = replay(c, inputs, p.endTick);
  assert.ok(!r.ok || r.summary.digest !== p.clientSummary.digest);
  const different = structuredClone(c);
  different.phases[0].reward += 10;
  const rr = replay(different, p.inputs, p.endTick);
  assert.ok(!rr.ok || rr.summary.score !== p.clientSummary.score);
});
test("zero-work source is Restock, missing source is not treated as zero", () => {
  assert.equal(
    phaseFromSettlement(
      {
        afterRound: "0",
        throughRound: "1",
        workAdded: "0",
        completedBlocks: "0",
      },
      0,
    ).weather,
    "NAP",
  );
  assert.throws(() => phaseFromSettlement({}, 0));
});

test("pouch cannot be reused before a drop; shake charges require a board", () => {
  const s = new Sim(practiceConfig("tools"));
  const first = s.current;
  assert.equal(s.apply(INPUT.SHAKE), false);
  assert.equal(s.apply(INPUT.SWAP), true);
  assert.equal(s.pouch, first);
  assert.equal(s.apply(INPUT.SWAP), false);
  assert.equal(s.apply(INPUT.DROP, 200), true);
  assert.equal(s.apply(INPUT.SWAP), true);
  assert.equal(s.current, first);
  assert.equal(s.apply(INPUT.SHAKE), true);
  assert.equal(s.shakes, 1);
});
