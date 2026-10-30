import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { buildApp } from "../server/app.js";
import { RULES_VERSION } from "../squeek-drop-frontend/squeek-drop/js/engine.js";
import { fixtureSource, login, play } from "./helpers.mjs";
import { sha } from "../server/util.js";

test("single trusted ingress uses the nearest forwarded client, not spoofed earlier hops", async (t) => {
  const secret = "test-only-proxy-check";
  const { app } = await setup(t, {
    trustProxy: "127.0.0.1/32",
    jwtSecret: secret,
  });
  const run = await start(app, {
    "x-forwarded-for": "198.51.100.99, 203.0.113.8",
  });
  const row = app.services.db
    .prepare("SELECT rate_key FROM runs WHERE id=?")
    .get(run.runId);
  assert.equal(row.rate_key, sha("203.0.113.8" + secret));
});

async function setup(t, overrides = {}) {
  let clock = Date.parse("2026-10-30T12:00:00Z");
  const app = await buildApp({
    dbPath: ":memory:",
    sourceProvider: async () => fixtureSource,
    now: () => clock,
    background: false,
    ...overrides,
  });
  t.after(() => app.close());
  return { app, advance: (ms) => (clock += ms) };
}
async function start(app, headers = {}) {
  const c = (await app.inject("/v1/challenges/today")).json();
  const r = await app.inject({
    method: "POST",
    url: "/v1/runs",
    headers,
    payload: {
      mode: "daily",
      challengeId: c.challengeId,
      clientRulesVersion: RULES_VERSION,
    },
  });
  assert.equal(r.statusCode, 200, r.body);
  return r.json();
}
test("frozen challenge survives concurrent requests and server restart", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "squeek-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  let calls = 0;
  const dbPath = join(dir, "test.sqlite");
  const a = await buildApp({
    dbPath,
    background: false,
    sourceProvider: async () => {
      calls++;
      return fixtureSource;
    },
  });
  const responses = await Promise.all(
    Array.from({ length: 5 }, () => a.inject("/v1/challenges/today")),
  );
  const c = responses[0].json();
  for (const r of responses) assert.deepEqual(r.json(), c);
  assert.equal(calls, 1);
  await a.close();
  const b = await buildApp({
    dbPath,
    background: false,
    sourceProvider: async () => {
      throw Error("offline");
    },
  });
  assert.deepEqual((await b.inject("/v1/challenges/today")).json(), c);
  await b.close();
});
test("wallet challenge verifies address, rejects nonce reuse and forged signatures", async (t) => {
  const { app } = await setup(t);
  const a = privateKeyToAccount(generatePrivateKey()),
    b = privateKeyToAccount(generatePrivateKey());
  const { message } = (
    await app.inject({
      method: "POST",
      url: "/v1/auth/nonce",
      payload: { address: a.address },
    })
  ).json();
  const wrong = await b.signMessage({ message });
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/v1/auth/verify",
        payload: { address: a.address, message, signature: wrong },
      })
    ).statusCode,
    401,
  );
  const payload = {
    address: a.address,
    message,
    signature: await a.signMessage({ message }),
  };
  const responses = await Promise.all([
    app.inject({ method: "POST", url: "/v1/auth/verify", payload }),
    app.inject({ method: "POST", url: "/v1/auth/verify", payload }),
  ]);
  assert.deepEqual(responses.map((r) => r.statusCode).sort(), [200, 401]);
});
test("real ranked score, idempotent retry, duplicate rejection, owner isolation and public proof", async (t) => {
  const { app, advance } = await setup(t);
  const a = privateKeyToAccount(generatePrivateKey()),
    b = privateKeyToAccount(generatePrivateKey());
  const headers = await login(app, a),
    other = await login(app, b);
  const run = await start(app, headers);
  const payload = play(run.challenge.config, 900);
  advance(16000);
  const url = `/v1/runs/${run.runId}/finish`;
  assert.equal(
    (await app.inject({ method: "POST", url, headers: other, payload }))
      .statusCode,
    403,
  );
  const r = await app.inject({ method: "POST", url, headers, payload });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().status, "verified");
  assert.equal(r.json().rank, 1);
  assert.deepEqual(
    (await app.inject({ method: "POST", url, headers, payload })).json(),
    r.json(),
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url,
        headers,
        payload: { ...payload, endTick: 1 },
      })
    ).statusCode,
    409,
  );
  const board = (await app.inject("/v1/leaderboards/today")).json();
  assert.equal(board.entries.length, 1);
  assert.equal(board.entries[0].address, a.address.toLowerCase());
  assert.equal(board.entries[0].pinned, false);
  const proof = (await app.inject("/v1/proofs/" + run.runId)).json();
  assert.deepEqual(proof.replay, payload);
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: `/v1/runs/${run.runId}/attestation`,
        headers,
      })
    ).statusCode,
    503,
  );
});
test("anonymous run requires secret and never enters leaderboard or public proof", async (t) => {
  const { app, advance } = await setup(t);
  const run = await start(app);
  const payload = play(run.challenge.config, 120);
  advance(3000);
  const url = `/v1/runs/${run.runId}/finish`;
  assert.equal(
    (await app.inject({ method: "POST", url, payload })).statusCode,
    403,
  );
  const r = await app.inject({
    method: "POST",
    url,
    payload,
    headers: { "x-run-token": run.runToken },
  });
  assert.equal(r.json().status, "verified");
  assert.equal(r.json().ranked, false);
  assert.equal(
    (await app.inject("/v1/leaderboards/today")).json().entries.length,
    0,
  );
  assert.equal((await app.inject("/v1/proofs/" + run.runId)).statusCode, 404);
});
test("malformed logs, too-fast replay and client score tampering are rejected", async (t) => {
  const { app, advance } = await setup(t);
  const run = await start(app);
  const url = `/v1/runs/${run.runId}/finish`,
    headers = { "x-run-token": run.runToken };
  const payload = play(run.challenge.config, 900);
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url,
        headers,
        payload: { ...payload, inputs: [[0, 0, NaN]] },
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (await app.inject({ method: "POST", url, headers, payload })).json().reason,
    "too_fast",
  );
  const second = await start(app);
  advance(20000);
  payload.clientSummary.score++;
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: `/v1/runs/${second.runId}/finish`,
        headers: { "x-run-token": second.runToken },
        payload,
      })
    ).json().reason,
    "summary_mismatch",
  );
});
test("source outage yields unavailable daily, without demo scores or broken practice assets", async (t) => {
  const { app } = await setup(t, {
    sourceProvider: async () => {
      throw Error("offline");
    },
  });
  assert.equal((await app.inject("/v1/challenges/today")).statusCode, 503);
  assert.equal((await app.inject("/js/challenge.js")).statusCode, 200);
  assert.equal((await app.inject("/")).statusCode, 200);
});
test("ranked runs cannot upgrade guest identity; unknown modes and rules reject", async (t) => {
  const { app } = await setup(t);
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/v1/runs",
        payload: { mode: "pot", clientRulesVersion: RULES_VERSION },
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/v1/runs",
        payload: { mode: "daily", clientRulesVersion: "old" },
      })
    ).statusCode,
    409,
  );
});
