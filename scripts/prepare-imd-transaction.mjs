import fs from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { encodeFunctionData, parseAbi, stringToHex, keccak256 } from "viem";

const TOKEN = "0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7";
const INTAKE = "0xa43e6f75ee006411f79ac1c84120606c2330de82";
const AMOUNT = "500000000000000000";
export function prepareTransaction(
  input,
  order,
  capabilities,
  now = Date.now(),
) {
  const rebuilt = JSON.parse(order.inputJson).rebuilt;
  const chain = capabilities.onchain.chains.find((c) => c.chainId === 1);
  const action = chain?.actions.find((a) => a.action === "workflow.open");
  const quote = order.quote;
  if (
    order.status !== "quoted" ||
    order.paidAt ||
    quote.expiresAt * 1000 < now + 120000
  )
    throw Error("Fresh unpaid quote required");
  if (
    chain?.asset?.toLowerCase() !== TOKEN ||
    chain?.intake?.toLowerCase() !== INTAKE ||
    action?.amount !== AMOUNT ||
    quote.payment.amount !== AMOUNT ||
    quote.payment.network !== "eip155:1"
  )
    throw Error("Payment policy differs from reviewed 0.5 IMD mainnet route");
  for (const field of [
    "repoUrl",
    "baseCommit",
    "owner",
    "chainId",
    "onchain",
    "ipfs",
  ])
    if (input.draft[field] !== rebuilt[field])
      throw Error("Rebuilt quote differs: " + field);
  if (
    input.draft.onchain !== "evm_contracts" ||
    input.draft.chainId !== 11155111
  )
    throw Error("Only no-token Sepolia deployment approved");
  const body = JSON.stringify(input);
  if (Buffer.byteLength(body) > 16384)
    throw Error("Input exceeds intake limit");
  return {
    payer: input.draft.owner,
    asset: TOKEN,
    intake: INTAKE,
    amount: AMOUNT,
    expiresAt: quote.expiresAt,
    repoUrl: input.draft.repoUrl,
    commit: input.draft.baseCommit,
    inputHash: keccak256(stringToHex(body)),
    orderId: order.id,
    approve: {
      to: TOKEN,
      data: encodeFunctionData({
        abi: parseAbi(["function approve(address,uint256) returns (bool)"]),
        functionName: "approve",
        args: [INTAKE, BigInt(AMOUNT)],
      }),
    },
    request: {
      to: INTAKE,
      data: encodeFunctionData({
        abi: parseAbi([
          "function request(bytes32 action,bytes body,(address target,bytes4 selector) callback,address asset,uint256 amount) returns (bytes32)",
        ]),
        functionName: "request",
        args: [
          action.actionId,
          stringToHex(body),
          {
            target: "0x0000000000000000000000000000000000000000",
            selector: "0x00000000",
          },
          TOKEN,
          BigInt(AMOUNT),
        ],
      }),
    },
  };
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const request = JSON.parse(
    await fs.readFile(".local/imd-check-request.json", "utf8"),
  );
  const { order } = JSON.parse(
    await fs.readFile(".local/imd-quote.json", "utf8"),
  );
  const cap = await (
    await fetch("https://api.imd.fun/requests/capabilities")
  ).json();
  const data = prepareTransaction(request.input, order, cap);
  await fs.mkdir(".local/imd-payment", { recursive: true });
  await fs.writeFile(
    ".local/imd-payment/transaction.json",
    JSON.stringify(data, null, 2),
  );
  await fs.writeFile(
    ".local/imd-payment/input.json",
    JSON.stringify(request.input, null, 2),
  );
  console.log(
    "Prepared user-operated transactions. No signing or broadcasting performed.",
  );
}
