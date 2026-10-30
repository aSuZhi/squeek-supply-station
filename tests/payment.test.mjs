import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";
import { prepareTransaction } from "../scripts/prepare-imd-transaction.mjs";
import { decodeFunctionData, parseAbi, stringToHex } from "viem";
const payer = "0x51404e4a699e4e338e143fb2a45c5cdc96392575";
const token = "0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7",
  intake = "0xa43e6f75ee006411f79ac1c84120606c2330de82";
function fixture() {
  const input = {
    draft: {
      repoUrl: "https://github.com/example/test.git",
      baseCommit: "a".repeat(40),
      owner: payer,
      chainId: 11155111,
      onchain: "evm_contracts",
      ipfs: "test",
    },
  };
  const order = {
    id: "test",
    status: "quoted",
    paidAt: null,
    inputJson: JSON.stringify({ rebuilt: input.draft }),
    quote: {
      expiresAt: Math.floor(Date.now() / 1000) + 600,
      payment: { amount: "500000000000000000", network: "eip155:1" },
    },
  };
  const cap = {
    onchain: {
      chains: [
        {
          chainId: 1,
          asset: token,
          intake,
          actions: [
            {
              action: "workflow.open",
              amount: "500000000000000000",
              actionId: stringToHex("workflow.open@workflow-1", { size: 32 }),
            },
          ],
        },
      ],
    },
  };
  return { input, order, cap };
}
test("prepared intake calldata has exact price, callback, source input and no native transfer", () => {
  const { input, order, cap } = fixture();
  const result = prepareTransaction(input, order, cap);
  const decoded = decodeFunctionData({
    abi: parseAbi([
      "function request(bytes32 action,bytes body,(address target,bytes4 selector) callback,address asset,uint256 amount) returns(bytes32)",
    ]),
    data: result.request.data,
  });
  assert.equal(decoded.args[4], 500000000000000000n);
  assert.equal(decoded.args[3].toLowerCase(), token);
  assert.deepEqual(
    JSON.parse(Buffer.from(decoded.args[1].slice(2), "hex").toString()),
    input,
  );
  assert.equal(result.request.to, intake);
  order.quote.expiresAt = 1;
  assert.throws(() => prepareTransaction(input, order, cap), /Fresh unpaid/);
});
test("payment page never sends automatically and prevents duplicate user submission", async () => {
  const { input, order, cap } = fixture();
  const config = prepareTransaction(input, order, cap);
  const elements = new Map();
  const el = () => ({ disabled: false, textContent: "", append() {} });
  const document = {
    querySelector: (s) => {
      if (!elements.has(s)) elements.set(s, el());
      return elements.get(s);
    },
    createElement: el,
  };
  const storage = new Map(),
    sent = [];
  let allowed = false;
  const ethereum = {
    on() {},
    async request({ method, params }) {
      if (method === "eth_requestAccounts" || method === "eth_accounts")
        return [payer];
      if (method === "eth_chainId") return "0x1";
      if (method === "eth_call")
        return params[0].data.startsWith("0xdd62ed3e")
          ? allowed
            ? "0x6f05b59d3b20000"
            : "0x0"
          : "0x6f05b59d3b20000";
      if (method === "eth_estimateGas") return "0x10000";
      if (method === "eth_sendTransaction") {
        sent.push(params[0]);
        allowed = true;
        return "0x" + "1".repeat(64);
      }
      if (method === "eth_getTransactionReceipt") return { status: "0x1" };
      throw Error("Unexpected " + method);
    },
  };
  const context = {
    document,
    window: { ethereum },
    fetch: async () => ({ json: async () => config }),
    localStorage: {
      getItem: (k) => storage.get(k),
      setItem: (k, v) => storage.set(k, v),
    },
    setInterval() {},
    setTimeout,
    Date,
    console,
  };
  const code = await fs.readFile("deploy/payment/payment.js", "utf8");
  await vm.runInNewContext("(async()=>{" + code + "})()", context);
  assert.equal(sent.length, 0);
  await elements.get("#connect").onclick();
  assert.equal(sent.length, 0);
  assert.equal(elements.get("#submit").disabled, true);
  await elements.get("#approve").onclick();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, token);
  await elements.get("#submit").onclick();
  assert.equal(sent.length, 2);
  assert.equal(sent[1].to, intake);
  assert.equal(sent[1].value, "0x0");
  await elements.get("#submit").onclick();
  assert.equal(sent.length, 2);
});
