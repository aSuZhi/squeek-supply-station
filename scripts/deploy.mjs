import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createPublicClient, createWalletClient, http, isAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

if (!process.argv.includes("--broadcast")) {
  console.log(
    "Deploy SqueekSupplyBoard (Sepolia only).\n1. npm run contracts:build\n2. Configure SEPOLIA_RPC_URL, DEPLOYER_PRIVATE_KEY, OWNER_ADDRESS and SIGNER_ADDRESS in .env\n3. npm run deploy -- --broadcast\nNo transaction was sent.",
  );
} else {
  const {
    SEPOLIA_RPC_URL: rpc,
    DEPLOYER_PRIVATE_KEY: key,
    OWNER_ADDRESS: owner,
    SIGNER_ADDRESS: signer,
  } = process.env;
  if (!rpc || !key || !isAddress(owner || "") || !isAddress(signer || ""))
    throw Error("Missing deployment configuration");
  const account = privateKeyToAccount(key),
    transport = http(rpc),
    publicClient = createPublicClient({ chain: sepolia, transport });
  if ((await publicClient.getChainId()) !== 11155111)
    throw Error("Only Sepolia is allowed");
  const artifact = JSON.parse(
    readFileSync(
      "contracts/out/SqueekSupplyBoard.sol/SqueekSupplyBoard.json",
      "utf8",
    ),
  );
  const wallet = createWalletClient({ account, chain: sepolia, transport });
  const hash = await wallet.deployContract({
    abi: artifact.abi,
    bytecode: artifact.bytecode.object,
    args: [owner, signer],
  });
  console.log("Submitted:", hash);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw Error("Deployment reverted");
  mkdirSync("deployments", { recursive: true });
  const deployment = {
    chainId: 11155111,
    board: receipt.contractAddress,
    owner,
    signer,
    transactionHash: hash,
    blockNumber: String(receipt.blockNumber),
  };
  writeFileSync(
    "deployments/sepolia.json",
    JSON.stringify(deployment, null, 2) + "\n",
  );
  console.log(
    "Deployed:",
    receipt.contractAddress,
    "— saved deployments/sepolia.json",
  );
}
