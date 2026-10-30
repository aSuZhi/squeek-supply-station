import { keccak256, toHex } from "viem";
import { RULES_VERSION } from "../squeek-drop-frontend/squeek-drop/js/engine.js";
import {
  phaseFromSettlement,
  DURATION_TICKS,
} from "../squeek-drop-frontend/squeek-drop/js/challenge.js";
import { canonical, dayOf, fail, hex32, requireValue } from "./util.js";

// Verified against the official /v1/core identity AND a settlement receipt on 2026-10-30.
// The supplied prototype referenced an older deployment.
export const DEFAULT_CORE = "0x980b4424c007caf7a1f3670b48c8eaef7ebc3d44";
const decimal = (x) => typeof x === "string" && /^\d{1,40}$/.test(x);
export async function fetchSource(
  base = "https://api.squeekchain.com",
  expectedCore = DEFAULT_CORE,
) {
  const fetchJSON = async (path) => {
    try {
      const r = await fetch(base + path, {
        signal: AbortSignal.timeout(12000),
      });
      if (!r.ok) throw fail("source_unavailable", 503);
      return await r.json();
    } catch {
      throw fail("source_unavailable", 503);
    }
  };
  const [data, core] = await Promise.all([
    fetchJSON("/v1/settlements"),
    fetchJSON("/v1/core"),
  ]);
  requireValue(
    core.status === "available" &&
      core.identities?.core?.toLowerCase() === expectedCore.toLowerCase() &&
      core.chain?.chainId === "11155111" &&
      core.installationId === data.installationId,
    "source_identity_mismatch",
    503,
  );
  requireValue(
    data.schemaVersion === 3 &&
      data.status === "available" &&
      data.chain?.chainId === "11155111" &&
      decimal(data.chain.safeThroughBlock) &&
      Array.isArray(data.recentSettlements),
    "source_unavailable",
    503,
  );
  const safe = BigInt(data.chain.safeThroughBlock);
  const records = (data.recentSettlements || [])
    .filter((r) => r.confirmationStatus === "safe")
    .map((r) => {
      requireValue(
        hex32(r.transactionHash) &&
          [
            "previousSettledThroughRound",
            "settledThroughRound",
            "workAdded",
            "completedBlockCount",
            "ethereumBlockNumber",
            "logIndex",
          ].every((k) => decimal(r[k])),
        "source_schema_changed",
        503,
      );
      requireValue(
        BigInt(r.ethereumBlockNumber) <= safe &&
          BigInt(r.settledThroughRound) >
            BigInt(r.previousSettledThroughRound) &&
          Number.isFinite(Date.parse(r.blockTimestamp)) &&
          Date.parse(r.blockTimestamp) <= Date.now(),
        "source_schema_changed",
        503,
      );
      return {
        afterRound: r.previousSettledThroughRound,
        throughRound: r.settledThroughRound,
        workAdded: r.workAdded,
        completedBlocks: r.completedBlockCount,
        transactionHash: r.transactionHash,
        blockNumber: r.ethereumBlockNumber,
        logIndex: r.logIndex,
        settledAt: r.blockTimestamp,
      };
    })
    .sort((a, b) => (BigInt(a.throughRound) < BigInt(b.throughRound) ? 1 : -1));
  // One newest sample per activity band, then fill from newest remaining samples.
  // No invented active periods: if all records are idle, all three stages are idle.
  const selected = [];
  const bands = new Set();
  for (const r of records) {
    const band = phaseFromSettlement(r, 0).weather;
    if (!bands.has(band)) {
      selected.push(r);
      bands.add(band);
    }
  }
  for (const r of records)
    if (selected.length < 3 && !selected.includes(r)) selected.push(r);
  requireValue(selected.length >= 3, "insufficient_settlements", 503);
  selected.sort((a, b) =>
    BigInt(a.throughRound) < BigInt(b.throughRound) ? -1 : 1,
  );
  return {
    api: base,
    core: expectedCore.toLowerCase(),
    chainId: 11155111,
    safeThroughBlock: data.chain.safeThroughBlock,
    installationId: data.installationId,
    records: selected.slice(0, 3),
    fetchedAt: new Date().toISOString(),
  };
}
export function buildChallenge(day, source, now = Date.now()) {
  const challengeId = keccak256(toHex(`squeek-supply:${RULES_VERSION}:${day}`));
  const seed = keccak256(toHex(canonical({ day, records: source.records })));
  const config = {
    rulesVersion: RULES_VERSION,
    seed,
    durationTicks: DURATION_TICKS,
    phases: source.records.map(phaseFromSettlement),
  };
  const configHash = keccak256(
    toHex(canonical({ challengeId, config, source })),
  );
  return {
    challengeId,
    day,
    configHash,
    config,
    source,
    publishedAt: new Date(now).toISOString(),
    closesAt: new Date(Date.parse(day + "T00:00:00Z") + 86400000).toISOString(),
  };
}
export function challengeService(
  db,
  sourceProvider = fetchSource,
  now = Date.now,
) {
  let pending;
  return {
    async today() {
      const day = dayOf(now());
      const saved = db
        .prepare("SELECT json FROM challenges WHERE day=?")
        .get(day);
      if (saved) return JSON.parse(saved.json);
      if (pending) {
        await pending;
        return this.today();
      }
      pending = (async () => {
        const source = await sourceProvider();
        const challenge = buildChallenge(day, source, now());
        db.prepare(
          "INSERT OR IGNORE INTO challenges(day,id,json) VALUES (?,?,?)",
        ).run(day, challenge.challengeId, JSON.stringify(challenge));
      })();
      try {
        await pending;
      } finally {
        pending = null;
      }
      return this.today();
    },
    get(id) {
      const row = db
        .prepare("SELECT json FROM challenges WHERE id=? OR day=?")
        .get(id, id);
      return row ? JSON.parse(row.json) : null;
    },
  };
}
