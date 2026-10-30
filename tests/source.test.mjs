import test from "node:test";
import assert from "node:assert/strict";
import { fetchSource, DEFAULT_CORE } from "../server/challenges.js";

function payload() {
  return {
    schemaVersion: 3,
    status: "available",
    installationId: "test-source",
    chain: { chainId: "11155111", safeThroughBlock: "100" },
    recentSettlements: [
      {
        previousSettledThroughRound: "2",
        settledThroughRound: "3",
        workAdded: "700",
        completedBlockCount: "45",
        ethereumBlockNumber: "93",
        logIndex: "1",
        transactionHash: "0x" + "33".repeat(32),
        blockTimestamp: "2026-10-29T03:00:00Z",
        confirmationStatus: "safe",
      },
      {
        previousSettledThroughRound: "1",
        settledThroughRound: "2",
        workAdded: "300",
        completedBlockCount: "20",
        ethereumBlockNumber: "92",
        logIndex: "1",
        transactionHash: "0x" + "22".repeat(32),
        blockTimestamp: "2026-10-29T02:00:00Z",
        confirmationStatus: "safe",
      },
      {
        previousSettledThroughRound: "0",
        settledThroughRound: "1",
        workAdded: "0",
        completedBlockCount: "0",
        ethereumBlockNumber: "91",
        logIndex: "1",
        transactionHash: "0x" + "11".repeat(32),
        blockTimestamp: "2026-10-29T01:00:00Z",
        confirmationStatus: "safe",
      },
    ],
  };
}
function mockSource(t, data, core = DEFAULT_CORE) {
  t.mock.method(
    globalThis,
    "fetch",
    async (url) =>
      new Response(
        JSON.stringify(
          String(url).endsWith("/core")
            ? {
                status: "available",
                installationId: "test-source",
                identities: { core },
                chain: { chainId: "11155111" },
              }
            : data,
        ),
        { status: 200 },
      ),
  );
}
test("official schema parsing preserves zero-work source and chronological provenance", async (t) => {
  mockSource(t, payload());
  const s = await fetchSource();
  assert.equal(s.core, DEFAULT_CORE);
  assert.deepEqual(
    s.records.map((r) => r.throughRound),
    ["1", "2", "3"],
  );
  assert.equal(s.records[0].workAdded, "0");
});
test("identity drift blocks new publication", async (t) => {
  mockSource(t, payload(), "0x" + "aa".repeat(20));
  await assert.rejects(fetchSource(), /source_identity_mismatch/);
});
test("unavailable source is not an empty or synthetic daily challenge", async (t) => {
  mockSource(t, {
    schemaVersion: 3,
    status: "unavailable",
    installationId: "test-source",
  });
  await assert.rejects(fetchSource(), /source_unavailable/);
});
test("unsafe, malformed or beyond-safe-block records cannot be published", async (t) => {
  const data = payload();
  data.recentSettlements[0].ethereumBlockNumber = "101";
  mockSource(t, data);
  await assert.rejects(fetchSource(), /source_schema_changed/);
});
