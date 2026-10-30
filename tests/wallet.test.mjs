import test from "node:test";
import assert from "node:assert/strict";
import { encodeFunctionData, keccak256, toHex } from "viem";
import { BOARD_ABI } from "../server/chain.js";
globalThis.window = {};
globalThis.location = { origin: "http://localhost:8080" };
const { encodeCall, selector } =
  await import("../squeek-drop-frontend/squeek-drop/js/wallet.js");
test("browser calldata and selector exactly match official viem ABI encoding", () => {
  const run = "0x" + "11".repeat(32),
    challenge = "0x" + "22".repeat(32),
    config = "0x" + "33".repeat(32),
    sig = "0x" + "aa".repeat(65);
  const signature =
    "pinScore(bytes32,bytes32,bytes32,uint64,uint32,uint64,bytes)";
  assert.equal(selector(signature), keccak256(toHex(signature)).slice(0, 10));
  const encoded = encodeCall(signature, [
    { t: "bytes32", v: run },
    { t: "bytes32", v: challenge },
    { t: "bytes32", v: config },
    { t: "uint", v: 1234 },
    { t: "uint", v: 4 },
    { t: "uint", v: 2000000000 },
    { t: "bytes", v: sig },
  ]);
  assert.equal(
    encoded,
    encodeFunctionData({
      abi: BOARD_ABI,
      functionName: "pinScore",
      args: [run, challenge, config, 1234n, 4, 2000000000n, sig],
    }),
  );
});
