// Isolated local-chain integration. Never reads user wallet keys or broadcasts to Sepolia.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import {
  createPublicClient,
  createWalletClient,
  http,
  encodeFunctionData,
  recoverTypedDataAddress,
} from "viem";
import {
  generatePrivateKey,
  privateKeyToAccount,
  mnemonicToAccount,
} from "viem/accounts";
import { foundry } from "viem/chains";
import { buildApp } from "../server/app.js";
import { chainService, BOARD_ABI, scoreTypedData } from "../server/chain.js";
import { RULES_VERSION } from "../squeek-drop-frontend/squeek-drop/js/engine.js";
import { fixtureSource, play } from "../tests/helpers.mjs";

const listener = createServer();
await new Promise((r) => listener.listen(0, "127.0.0.1", r));
const port = listener.address().port;
await new Promise((r) => listener.close(r));
const child = spawn(
  "anvil",
  ["--port", String(port), "--host", "127.0.0.1", "--silent"],
  { windowsHide: true, stdio: "ignore" },
);
let spawnError;
child.on("error", (e) => (spawnError = e));
const exited = new Promise((resolve) => child.once("exit", resolve));
const dir = mkdtempSync(join(tmpdir(), "squeek-chain-"));
let app;
try {
  const rpc = `http://127.0.0.1:${port}`;
  const transport = http(rpc, { retryCount: 0, timeout: 1000 });
  const client = createPublicClient({ chain: foundry, transport });
  let ready = false;
  for (let i = 0; i < 50; i++) {
    if (spawnError) throw spawnError;
    try {
      ready = (await client.getChainId()) === 31337;
      if (ready) break;
    } catch {}
    await delay(100);
  }
  assert.ok(ready, "Anvil did not start");
  const player = mnemonicToAccount(
    "test test test test test test test test test test test junk",
  );
  const key = generatePrivateKey(),
    signer = privateKeyToAccount(key);
  const wallet = createWalletClient({
    account: player,
    chain: foundry,
    transport,
  });
  const artifact = JSON.parse(
    readFileSync(
      "contracts/out/SqueekSupplyBoard.sol/SqueekSupplyBoard.json",
      "utf8",
    ),
  );
  const deploy = await wallet.deployContract({
    abi: artifact.abi,
    bytecode: artifact.bytecode.object,
    args: [player.address, signer.address],
  });
  const receipt = await client.waitForTransactionReceipt({ hash: deploy });
  assert.equal(receipt.status, "success");
  const board = receipt.contractAddress;
  let clock = Date.now();
  app = await buildApp({
    dbPath: join(dir, "test.sqlite"),
    background: false,
    now: () => clock,
    sourceProvider: async () => fixtureSource,
    chain: chainService({
      rpc,
      board,
      privateKey: key,
      chainId: 31337,
      confirmations: 12,
    }),
  });
  await app.listen({ host: "127.0.0.1", port: 0 });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  let token;
  async function request(path, body) {
    const r = await fetch(base + path, {
      method: body ? "POST" : "GET",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: "Bearer " + token } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await r.json();
    assert.equal(r.status, 200, JSON.stringify(json));
    return json;
  }
  const nonce = await request("/v1/auth/nonce", { address: player.address });
  token = (
    await request("/v1/auth/verify", {
      address: player.address,
      message: nonce.message,
      signature: await player.signMessage({ message: nonce.message }),
    })
  ).token;
  const challenge = await request("/v1/challenges/today");
  const run = await request("/v1/runs", {
    mode: "daily",
    challengeId: challenge.challengeId,
    clientRulesVersion: RULES_VERSION,
  });
  const payload = play(challenge.config, 1800);
  clock += 31000;
  const result = await request(`/v1/runs/${run.runId}/finish`, payload);
  assert.equal(result.status, "verified");
  assert.ok(result.summary.score > 0);
  const att = await request(`/v1/runs/${run.runId}/attestation`, {});
  const { signature, ...message } = att;
  assert.equal(
    (
      await recoverTypedDataAddress({
        ...scoreTypedData(board, message, 31337),
        signature,
      })
    ).toLowerCase(),
    signer.address.toLowerCase(),
  );
  const snapshot = await client.request({ method: "evm_snapshot" });
  const hash = await wallet.sendTransaction({
    to: board,
    data: encodeFunctionData({
      abi: BOARD_ABI,
      functionName: "pinScore",
      args: [
        att.runId,
        att.challengeId,
        att.configHash,
        BigInt(att.score),
        att.deliveries,
        BigInt(att.deadline),
        att.signature,
      ],
    }),
  });
  assert.equal(
    (await client.waitForTransactionReceipt({ hash })).status,
    "success",
  );
  const pending = await request(`/v1/runs/${run.runId}/pin`, { txHash: hash });
  assert.equal(pending.status, "pending");
  await client.request({ method: "anvil_mine", params: ["0xc"] });
  await app.syncPins();
  const lb = await request("/v1/leaderboards/today");
  assert.equal(lb.entries[0].score, payload.clientSummary.score);
  assert.equal(lb.entries[0].pinned, true);
  const [score] = await client.readContract({
    address: board,
    abi: BOARD_ABI,
    functionName: "best",
    args: [challenge.challengeId, player.address],
  });
  assert.equal(score, BigInt(payload.clientSummary.score));
  // Confirmed evidence is withdrawn if its receipt disappears after a reorg.
  await client.request({ method: "evm_revert", params: [snapshot] });
  await app.syncPins();
  assert.equal(
    (await request("/v1/leaderboards/today")).entries[0].pinned,
    false,
  );
  console.log(
    "PASS: real HTTP login → frozen challenge → shared-engine replay → persisted leaderboard → EIP-712 signature → deployed EVM contract → 12 confirmations → reorg removes confirmed badge.",
  );
} finally {
  if (app) await app.close();
  child.kill();
  await Promise.race([exited, delay(5000)]);
  const probe = createServer();
  await new Promise((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(port, "127.0.0.1", resolve);
  });
  await new Promise((r) => probe.close(r));
  rmSync(dir, { recursive: true, force: true });
  console.log(`Local test processes stopped; port ${port} released.`);
}
