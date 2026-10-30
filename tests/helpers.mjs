import {
  Sim,
  INPUT,
  Rng,
} from "../squeek-drop-frontend/squeek-drop/js/engine.js";
export const fixtureSource = {
  api: "fixture://tests-only",
  core: "0x74665daeca35a2303e767e76a2ff1fb6f93e119f",
  chainId: 11155111,
  safeThroughBlock: "100",
  installationId: "test-only",
  fetchedAt: "2026-10-30T00:00:00.000Z",
  records: [0, 300, 650].map((work, i) => ({
    afterRound: String(i),
    throughRound: String(i + 1),
    workAdded: String(work),
    completedBlocks: String(i * 20),
    transactionHash: "0x" + String(i + 1).repeat(64),
    blockNumber: String(i + 90),
    logIndex: "1",
    settledAt: `2026-10-29T0${i}:00:00.000Z`,
  })),
};
export function play(config, until = 900, seed = 7) {
  const sim = new Sim(config),
    rng = new Rng(seed);
  while (!sim.over && sim.tick < until) {
    if (sim.deliveryCandidate) sim.apply(INPUT.DELIVER);
    if (sim.canDrop()) {
      const same = sim.balls.find((b) => b.lv === sim.current);
      const x = same ? Math.round(same.x) : 25 + rng.int(350);
      sim.apply(INPUT.DROP, Math.max(0, Math.min(400, x)));
    }
    sim.step();
    sim.events.length = 0;
  }
  return {
    inputs: sim.inputs,
    endTick: sim.tick,
    clientSummary: sim.summary(),
  };
}
export async function login(app, account) {
  const nonce = await app.inject({
    method: "POST",
    url: "/v1/auth/nonce",
    payload: { address: account.address },
  });
  const { message } = nonce.json();
  const signature = await account.signMessage({ message });
  const r = await app.inject({
    method: "POST",
    url: "/v1/auth/verify",
    payload: { address: account.address, message, signature },
  });
  if (r.statusCode !== 200) throw new Error(r.body);
  return { authorization: "Bearer " + r.json().token };
}
