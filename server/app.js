import Fastify from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import rateLimit from "@fastify/rate-limit";
import staticFiles from "@fastify/static";
import { fileURLToPath } from "node:url";
import { isAddress, getAddress, verifyMessage } from "viem";
import { openStore, transaction, standings } from "./store.js";
import { challengeService } from "./challenges.js";
import { ReplayPool } from "./replay-pool.js";
import { chainService } from "./chain.js";
import {
  canonical,
  dayOf,
  fail,
  hex32,
  integer,
  randomHex,
  requireValue,
  sha,
} from "./util.js";
import {
  MAX_TICKS,
  RULES_VERSION,
} from "../squeek-drop-frontend/squeek-drop/js/engine.js";

export async function buildApp(options = {}) {
  const now = options.now || Date.now;
  const origin = options.origin || "http://localhost:8080";
  const db = openStore(options.dbPath || "data/squeek.sqlite");
  const challenges = challengeService(db, options.sourceProvider, now);
  const pool = new ReplayPool(options.workers || 2);
  const chain = options.chain || chainService({});
  let secret = options.jwtSecret;
  if (!secret) {
    secret =
      db.prepare("SELECT value FROM settings WHERE key='jwt_secret'").get()
        ?.value || randomHex();
    db.prepare("INSERT OR IGNORE INTO settings VALUES ('jwt_secret',?)").run(
      secret,
    );
  }
  const app = Fastify({
    logger: options.logger ?? false,
    bodyLimit: 256 * 1024,
    trustProxy: options.trustProxy ?? false,
    requestTimeout: 20000,
    connectionTimeout: 20000,
    forceCloseConnections: true,
  });
  app.decorate("services", { db, challenges, pool, chain });
  await app.register(cors, {
    origin: options.corsOrigins || [origin],
    allowedHeaders: [
      "content-type",
      "authorization",
      "x-run-token",
      "x-request-id",
    ],
  });
  await app.register(jwt, {
    secret,
    sign: { expiresIn: "24h", iss: origin },
    verify: { allowedIss: origin },
  });
  await app.register(rateLimit, {
    max: 180,
    timeWindow: "1 minute",
    errorResponseBuilder: () => ({ error: "rate_limited" }),
  });
  app.addHook("onRequest", async (request, reply) => {
    reply
      .header("x-request-id", request.id)
      .header("x-content-type-options", "nosniff");
    if (request.url.startsWith("/v1/"))
      reply.header("cache-control", "no-store");
    request.address = null;
    if (request.headers.authorization) {
      try {
        const p = await request.jwtVerify();
        requireValue(isAddress(p.sub), "auth_required", 401);
        request.address = p.sub.toLowerCase();
      } catch {
        throw fail("auth_required", 401);
      }
    }
  });
  app.setErrorHandler((error, request, reply) => {
    const status = error.statusCode || 500;
    if (status >= 500)
      request.log.error({ code: error.code || error.name }, "request_failed");
    reply
      .status(status)
      .send({
        error: status === 500 ? "internal_error" : error.code || error.message,
        requestId: request.id,
      });
  });
  const auth = (req) => {
    requireValue(req.address, "auth_required", 401);
    return req.address;
  };
  const ownedRun = (req) => {
    const run = db.prepare("SELECT * FROM runs WHERE id=?").get(req.params.id);
    requireValue(run, "run_not_found", 404);
    if (run.address)
      requireValue(req.address === run.address, "run_forbidden", 403);
    else
      requireValue(
        typeof req.headers["x-run-token"] === "string" &&
          sha(req.headers["x-run-token"]) === run.owner_hash,
        "run_forbidden",
        403,
      );
    return run;
  };
  app.get("/healthz", async () => ({ ok: true, rulesVersion: RULES_VERSION }));
  app.get("/v1/config", async () => ({
    rulesVersion: RULES_VERSION,
    chainId: chain.chainId,
    contracts: { board: chain.board },
    attestationConfigured: chain.configured,
    signer: chain.signer,
    confirmations: chain.confirmations,
    authOrigin: origin,
  }));
  app.post(
    "/v1/auth/nonce",
    { config: { rateLimit: { max: 12, timeWindow: "1 minute" } } },
    async (req) => {
      const address = req.body?.address;
      requireValue(
        typeof address === "string" && isAddress(address),
        "invalid_address",
      );
      const expires = now() + 300000;
      const message = `${new URL(origin).host} wants you to sign in with your Ethereum account:\n${getAddress(address)}\n\nSign in to Squeek Supply Station. No transaction or token approval.\n\nURI: ${origin}\nVersion: 1\nChain ID: ${chain.chainId}\nNonce: ${randomHex(16).slice(2)}\nIssued At: ${new Date(now()).toISOString()}\nExpiration Time: ${new Date(expires).toISOString()}`;
      db.prepare("DELETE FROM nonces WHERE expires < ?").run(now());
      db.prepare("INSERT INTO nonces VALUES (?,?,?)").run(
        message,
        address.toLowerCase(),
        expires,
      );
      return { message };
    },
  );
  app.post(
    "/v1/auth/verify",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (req) => {
      const { address, message, signature } = req.body || {};
      requireValue(
        typeof address === "string" &&
          isAddress(address) &&
          typeof message === "string" &&
          message.length < 1500 &&
          typeof signature === "string" &&
          /^0x[0-9a-fA-F]{130}$/.test(signature),
        "invalid_signature",
      );
      const nonce = db
        .prepare("SELECT * FROM nonces WHERE message=?")
        .get(message);
      requireValue(
        nonce &&
          nonce.address === address.toLowerCase() &&
          nonce.expires > now(),
        "nonce_expired_or_used",
        401,
      );
      let valid = false;
      try {
        valid = await verifyMessage({ address, message, signature });
      } catch {}
      requireValue(valid, "invalid_signature", 401);
      const deleted = db
        .prepare("DELETE FROM nonces WHERE message=? AND expires>?")
        .run(message, now());
      requireValue(deleted.changes === 1, "nonce_expired_or_used", 401);
      return {
        token: app.jwt.sign({ sub: address.toLowerCase() }),
        address: address.toLowerCase(),
      };
    },
  );
  app.get("/v1/me", async (req) => ({ address: auth(req) }));
  app.get("/v1/challenges/today", async () => {
    try {
      return await challenges.today();
    } catch (e) {
      throw e.statusCode ? e : fail("challenge_unavailable", 503);
    }
  });
  app.get("/v1/challenges/:id", async (req) => {
    const challenge = challenges.get(req.params.id);
    requireValue(challenge, "challenge_not_found", 404);
    return challenge;
  });
  app.get("/v1/leaderboards/:id", async (req) => {
    const challenge =
      req.params.id === "today"
        ? await challenges.today()
        : challenges.get(req.params.id);
    requireValue(challenge, "challenge_not_found", 404);
    const entries = standings(db, challenge.challengeId).map((e) => ({
      ...e,
      you: e.address === req.address,
    }));
    return {
      challengeId: challenge.challengeId,
      day: challenge.day,
      entries: entries.slice(0, 50),
      me: entries.find((e) => e.you) || null,
    };
  });
  app.post(
    "/v1/runs",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (req) => {
      requireValue(
        req.body?.clientRulesVersion === RULES_VERSION,
        "rules_version_mismatch",
        409,
      );
      requireValue(req.body?.mode === "daily", "invalid_mode");
      const challenge = await challenges.today();
      requireValue(
        req.body.challengeId === challenge.challengeId,
        "challenge_changed",
        409,
      );
      const rateKey = req.address || sha(req.ip + secret);
      const count = db
        .prepare(
          "SELECT count(*) AS n FROM runs WHERE rate_key=? AND started>=?",
        )
        .get(rateKey, Date.parse(dayOf(now()) + "T00:00:00Z")).n;
      requireValue(count < 200, "daily_limit", 429);
      const runId = randomHex(),
        runToken = randomHex();
      db.prepare(
        "INSERT INTO runs(id,challenge_id,address,owner_hash,rate_key,started) VALUES (?,?,?,?,?,?)",
      ).run(
        runId,
        challenge.challengeId,
        req.address,
        sha(runToken),
        rateKey,
        now(),
      );
      return {
        runId,
        runToken,
        challenge,
        ranked: !!req.address,
        startedAt: new Date(now()).toISOString(),
        expiresAt: new Date(now() + 15 * 60000).toISOString(),
      };
    },
  );
  app.post("/v1/runs/:id/finish", async (req) => {
    const run = ownedRun(req);
    const { inputs, endTick, clientSummary } = req.body || {};
    requireValue(
      Array.isArray(inputs) &&
        inputs.length <= 2500 &&
        integer(endTick, 0, MAX_TICKS) &&
        clientSummary &&
        typeof clientSummary === "object",
      "invalid_replay",
    );
    requireValue(
      inputs.every(
        (a) =>
          Array.isArray(a) &&
          integer(a[0], 0, MAX_TICKS - 1) &&
          integer(a[1], 0, 3) &&
          (a[1] === 0
            ? a.length === 3 && integer(a[2], 0, 400)
            : a.length === 2),
      ),
      "invalid_input",
    );
    const payloadHash = sha(canonical(req.body));
    if (run.status === "verified" || run.status === "rejected") {
      requireValue(
        run.payload_hash === payloadHash,
        "run_already_finished",
        409,
      );
      return JSON.parse(run.result);
    }
    requireValue(run.status === "started", "run_in_progress", 409);
    requireValue(
      db
        .prepare(
          "UPDATE runs SET status='verifying' WHERE id=? AND status='started'",
        )
        .run(run.id).changes === 1,
      "run_in_progress",
      409,
    );
    try {
      const challenge = challenges.get(run.challenge_id);
      let reason =
        now() - run.started > 15 * 60000
          ? "run_expired"
          : (endTick / 60) * 1000 > now() - run.started + 3000
            ? "too_fast"
            : null;
      const replay = reason
        ? null
        : await pool.run({ config: challenge.config, inputs, endTick });
      if (!reason && !replay.ok) reason = replay.reason;
      if (
        !reason &&
        (replay.summary.ticks !== endTick ||
          [
            "rulesVersion",
            "score",
            "ticks",
            "merges",
            "maxLevel",
            "blocks",
            "digest",
            "deliveries",
            "deliveryScore",
            "completedMissions",
          ].some((k) => replay.summary[k] !== clientSummary[k]) ||
          canonical(replay.summary.phaseDelivered) !==
            canonical(clientSummary.phaseDelivered))
      )
        reason = "summary_mismatch";
      const result = {
        runId: run.id,
        status: reason ? "rejected" : "verified",
        reason,
        summary: replay?.summary || null,
        ranked: !!run.address,
        challengeId: run.challenge_id,
      };
      transaction(db, () => {
        const previous = run.address
          ? standings(db, run.challenge_id).find(
              (e) => e.address === run.address,
            )
          : null;
        db.prepare(
          "UPDATE runs SET status=?,payload_hash=?,payload=?,score=?,deliveries=?,finished=? WHERE id=?",
        ).run(
          result.status,
          payloadHash,
          JSON.stringify(req.body),
          reason ? null : replay.summary.score,
          reason ? null : replay.summary.deliveries,
          now(),
          run.id,
        );
        if (!reason && run.address) {
          result.isNewBest = !previous || replay.summary.score > previous.score;
          result.rank = standings(db, run.challenge_id).find(
            (e) => e.address === run.address,
          )?.rank;
        }
        db.prepare("UPDATE runs SET result=? WHERE id=?").run(
          JSON.stringify(result),
          run.id,
        );
      });
      return result;
    } catch (e) {
      db.prepare(
        "UPDATE runs SET status='started' WHERE id=? AND status='verifying'",
      ).run(run.id);
      throw e;
    }
  });
  app.get("/v1/runs/:id", async (req) => {
    const run = ownedRun(req);
    return {
      runId: run.id,
      status: run.status,
      result: run.result ? JSON.parse(run.result) : null,
      pinStatus: run.pin_status,
      txHash: run.pin_hash,
    };
  });
  app.get("/v1/proofs/:id", async (req) => {
    const run = db
      .prepare(
        "SELECT * FROM runs WHERE id=? AND status='verified' AND address IS NOT NULL",
      )
      .get(req.params.id);
    requireValue(run, "proof_not_found", 404);
    return {
      runId: run.id,
      player: run.address,
      challenge: challenges.get(run.challenge_id),
      replay: JSON.parse(run.payload),
      result: JSON.parse(run.result),
      pinStatus: run.pin_status,
      txHash: run.pin_hash,
    };
  });
  app.post("/v1/runs/:id/attestation", async (req) => {
    auth(req);
    const run = ownedRun(req);
    requireValue(
      run.status === "verified" && run.score > 0,
      "run_not_eligible",
      409,
    );
    requireValue(
      standings(db, run.challenge_id).find((e) => e.address === run.address)
        ?.runId === run.id,
      "not_personal_best",
      409,
    );
    const challenge = challenges.get(run.challenge_id);
    return chain.sign({
      runId: run.id,
      challengeId: run.challenge_id,
      configHash: challenge.configHash,
      player: run.address,
      score: run.score,
      deliveries: run.deliveries,
      deadline: Math.floor(now() / 1000) + 86400,
    });
  });
  app.post("/v1/runs/:id/pin", async (req) => {
    auth(req);
    const run = ownedRun(req);
    requireValue(
      run.status === "verified" && hex32(req.body?.txHash),
      "invalid_pin",
    );
    const check = await chain.inspect(
      req.body.txHash,
      run,
      challenges.get(run.challenge_id),
    );
    requireValue(check.status !== "failed", "invalid_pin_transaction", 400);
    db.prepare("UPDATE runs SET pin_hash=?,pin_status=? WHERE id=?").run(
      req.body.txHash,
      check.status,
      run.id,
    );
    return check;
  });
  let syncing = false,
    syncTask = Promise.resolve();
  const syncPins = () => {
    if (syncing || !chain.configured) return syncTask;
    syncing = true;
    syncTask = (async () => {
      try {
        for (const run of db
          .prepare(
            "SELECT * FROM runs WHERE pin_hash IS NOT NULL AND pin_status!='failed' ORDER BY finished DESC LIMIT 100",
          )
          .all()) {
          const check = await chain.inspect(
            run.pin_hash,
            run,
            challenges.get(run.challenge_id),
          );
          db.prepare("UPDATE runs SET pin_status=? WHERE id=?").run(
            check.status,
            run.id,
          );
        }
      } catch {
        app.log.warn("pin_sync_unavailable");
      } finally {
        syncing = false;
      }
    })();
    return syncTask;
  };
  const timer =
    options.background === false ? null : setInterval(syncPins, 15000);
  timer?.unref();
  app.decorate("syncPins", syncPins);
  await app.register(staticFiles, {
    root: fileURLToPath(
      new URL("../squeek-drop-frontend/squeek-drop/", import.meta.url),
    ),
    index: "index.html",
    dotfiles: "deny",
  });
  app.addHook("onClose", async () => {
    clearInterval(timer);
    await syncTask;
    await pool.close();
    db.close();
  });
  return app;
}
