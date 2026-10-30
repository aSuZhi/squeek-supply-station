import { buildApp } from "./app.js";
import { chainService } from "./chain.js";
import { fetchSource } from "./challenges.js";
import { isAddress } from "viem";

if (process.argv.includes("--help")) {
  console.log(
    "Squeek Supply Station\n\n  npm start             Start web + API (default :8080)\n  npm test              Engine and API tests\n  npm run test:contracts  Solidity tests\n  npm run test:chain     Isolated local chain integration\n\nConfiguration: .env.example. Stop: Ctrl+C.",
  );
} else {
  const port = Number(process.env.PORT || 8080);
  const origin = process.env.PUBLIC_ORIGIN || `http://localhost:${port}`;
  if (!["http:", "https:"].includes(new URL(origin).protocol))
    throw new Error("PUBLIC_ORIGIN must be an HTTP(S) origin");
  if (process.env.BOARD_ADDRESS && !isAddress(process.env.BOARD_ADDRESS))
    throw new Error("Invalid BOARD_ADDRESS");
  if (
    process.env.NODE_ENV === "production" &&
    (process.env.JWT_SECRET || "").length < 32
  )
    throw new Error("Production requires JWT_SECRET of at least 32 characters");
  const chain = chainService({
    rpc: process.env.SEPOLIA_RPC_URL,
    board: process.env.BOARD_ADDRESS,
    privateKey: process.env.SIGNER_PRIVATE_KEY,
  });
  const app = await buildApp({
    dbPath: process.env.DB_PATH || "data/squeek.sqlite",
    origin,
    jwtSecret: process.env.JWT_SECRET,
    // Enable only behind our sole public nginx ingress; the API port stays loopback-only.
    trustProxy: process.env.TRUST_PROXY_CIDRS || false,
    corsOrigins: (process.env.CORS_ORIGINS || origin).split(","),
    sourceProvider: () =>
      fetchSource(
        process.env.SQUEEK_API || undefined,
        process.env.SQUEEK_CORE_ADDRESS || undefined,
      ),
    chain,
    logger: { level: "warn" },
  });
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await app.close();
    console.log("Stopped. HTTP listener and replay workers closed.");
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  try {
    await app.listen({ port, host: process.env.HOST || "127.0.0.1" });
    console.log(
      `Squeek Supply Station — ${origin}\nWeb + API ready. Storage: SQLite. Ctrl+C to stop.\nScore attestation: ${chain.configured ? "configured (Sepolia)" : "not configured; play and verification available"}`,
    );
  } catch (e) {
    console.error(e.message);
    await app.close();
    process.exitCode = 1;
  }
}
