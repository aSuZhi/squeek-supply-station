import { createPublicClient, http, parseAbi, decodeEventLog } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { fail, requireValue } from "./util.js";

export const BOARD_ABI = parseAbi([
  "function signer() view returns (address)",
  "function pinned(bytes32) view returns (bool)",
  "function best(bytes32,address) view returns (uint64 score,bytes32 runId)",
  "function pinScore(bytes32 runId,bytes32 challengeId,bytes32 configHash,uint64 score,uint32 deliveries,uint64 deadline,bytes signature)",
  "event ScorePinned(address indexed player,bytes32 indexed challengeId,bytes32 indexed runId,bytes32 configHash,uint64 score,uint32 deliveries)",
]);
export const SCORE_TYPES = {
  ScoreAttestation: [
    { name: "runId", type: "bytes32" },
    { name: "challengeId", type: "bytes32" },
    { name: "configHash", type: "bytes32" },
    { name: "player", type: "address" },
    { name: "score", type: "uint64" },
    { name: "deliveries", type: "uint32" },
    { name: "deadline", type: "uint64" },
  ],
};
export function scoreTypedData(address, attestation, chainId = 11155111) {
  return {
    domain: {
      name: "SqueekSupply",
      version: "2",
      chainId,
      verifyingContract: address,
    },
    types: SCORE_TYPES,
    primaryType: "ScoreAttestation",
    message: attestation,
  };
}
export function chainService({
  rpc,
  board,
  privateKey,
  confirmations = 12,
  chainId = 11155111,
}) {
  const account = privateKey ? privateKeyToAccount(privateKey) : null;
  const client =
    rpc && board
      ? createPublicClient({
          chain: { ...sepolia, id: chainId },
          transport: http(rpc, { timeout: 10000, retryCount: 1 }),
        })
      : null;
  const configured = Boolean(client && account);
  let lastCheck = 0;
  async function check() {
    if (!configured) throw fail("attestation_not_configured", 503);
    if (Date.now() - lastCheck < 15000) return;
    requireValue(
      (await client.getChainId()) === chainId,
      "wrong_rpc_chain",
      503,
    );
    const signer = await client.readContract({
      address: board,
      abi: BOARD_ABI,
      functionName: "signer",
    });
    requireValue(
      signer.toLowerCase() === account.address.toLowerCase(),
      "signer_mismatch",
      503,
    );
    lastCheck = Date.now();
  }
  return {
    configured,
    board: board || null,
    signer: account?.address || null,
    chainId,
    confirmations,
    async sign(message) {
      await check();
      const [best] = await client.readContract({
        address: board,
        abi: BOARD_ABI,
        functionName: "best",
        args: [message.challengeId, message.player],
      });
      requireValue(BigInt(message.score) > best, "score_already_pinned", 409);
      return {
        ...message,
        signature: await account.signTypedData(
          scoreTypedData(board, message, chainId),
        ),
      };
    },
    async inspect(hash, run, challenge) {
      if (!client) throw fail("attestation_not_configured", 503);
      requireValue(
        (await client.getChainId()) === chainId,
        "wrong_rpc_chain",
        503,
      );
      let receipt;
      try {
        receipt = await client.getTransactionReceipt({ hash });
      } catch (e) {
        if (e.name === "TransactionReceiptNotFoundError")
          return { status: "pending" };
        throw e;
      }
      if (
        receipt.status !== "success" ||
        receipt.to?.toLowerCase() !== board.toLowerCase()
      )
        return { status: "failed" };
      const matched = receipt.logs.some((log) => {
        if (log.address.toLowerCase() !== board.toLowerCase()) return false;
        try {
          const { eventName, args: a } = decodeEventLog({
            abi: BOARD_ABI,
            data: log.data,
            topics: log.topics,
          });
          return (
            eventName === "ScorePinned" &&
            a.runId.toLowerCase() === run.id.toLowerCase() &&
            a.player.toLowerCase() === run.address &&
            a.challengeId === challenge.challengeId &&
            a.configHash === challenge.configHash &&
            a.score === BigInt(run.score) &&
            a.deliveries === run.deliveries
          );
        } catch {
          return false;
        }
      });
      if (!matched) return { status: "failed" };
      const [head, block] = await Promise.all([
        client.getBlockNumber({ cacheTime: 0 }),
        client.getBlock({ blockNumber: receipt.blockNumber }),
      ]);
      if (block.hash !== receipt.blockHash) return { status: "pending" };
      return {
        status:
          head - receipt.blockNumber + 1n >= BigInt(confirmations)
            ? "confirmed"
            : "pending",
        blockNumber: String(receipt.blockNumber),
      };
    },
  };
}
