// Minimal EIP-1193 wallet + ABI helpers. No dependencies.
import { CONFIG } from "./config.js";

// ---- keccak256 (BigInt lanes; only used for short inputs) ----
const M64 = (1n << 64n) - 1n;
const RC = [
  "0x1",
  "0x8082",
  "0x800000000000808a",
  "0x8000000080008000",
  "0x808b",
  "0x80000001",
  "0x8000000080008081",
  "0x8000000000008009",
  "0x8a",
  "0x88",
  "0x80008009",
  "0x8000000a",
  "0x8000808b",
  "0x800000000000008b",
  "0x8000000000008089",
  "0x8000000000008003",
  "0x8000000000008002",
  "0x8000000000000080",
  "0x800a",
  "0x800000008000000a",
  "0x8000000080008081",
  "0x8000000000008080",
  "0x80000001",
  "0x8000000080008008",
].map(BigInt);
const ROT = [
  [0, 36, 3, 41, 18],
  [1, 44, 10, 45, 2],
  [62, 6, 43, 15, 61],
  [28, 55, 25, 21, 56],
  [27, 20, 39, 8, 14],
];
const rotl = (v, n) =>
  n === 0 ? v : ((v << BigInt(n)) | (v >> BigInt(64 - n))) & M64;
function keccakF(s) {
  const C = new Array(5),
    B = new Array(25);
  for (let r = 0; r < 24; r++) {
    for (let x = 0; x < 5; x++)
      C[x] = s[x] ^ s[x + 5] ^ s[x + 10] ^ s[x + 15] ^ s[x + 20];
    for (let x = 0; x < 5; x++) {
      const d = C[(x + 4) % 5] ^ rotl(C[(x + 1) % 5], 1);
      for (let y = 0; y < 25; y += 5) s[x + y] ^= d;
    }
    for (let x = 0; x < 5; x++)
      for (let y = 0; y < 5; y++)
        B[y + 5 * ((2 * x + 3 * y) % 5)] = rotl(s[x + 5 * y], ROT[x][y]);
    for (let x = 0; x < 5; x++)
      for (let y = 0; y < 5; y++)
        s[x + 5 * y] =
          B[x + 5 * y] ^
          (~B[((x + 1) % 5) + 5 * y] & M64 & B[((x + 2) % 5) + 5 * y]);
    s[0] ^= RC[r];
  }
}
export function keccak256(bytes) {
  if (typeof bytes === "string") bytes = new TextEncoder().encode(bytes);
  const rate = 136,
    s = new Array(25).fill(0n);
  const padded = new Uint8Array(Math.ceil((bytes.length + 1) / rate) * rate);
  padded.set(bytes);
  padded[bytes.length] ^= 0x01;
  padded[padded.length - 1] ^= 0x80;
  for (let o = 0; o < padded.length; o += rate) {
    for (let i = 0; i < rate / 8; i++) {
      let lane = 0n;
      for (let b = 7; b >= 0; b--)
        lane = (lane << 8n) | BigInt(padded[o + i * 8 + b]);
      s[i] ^= lane;
    }
    keccakF(s);
  }
  let hex = "";
  for (let i = 0; i < 4; i++)
    for (let b = 0; b < 8; b++)
      hex += Number((s[i] >> BigInt(8 * b)) & 0xffn)
        .toString(16)
        .padStart(2, "0");
  return "0x" + hex;
}
export const selector = (sig) => keccak256(sig).slice(0, 10);

// ---- ABI encoding (static types + trailing dynamic bytes) ----
const word = (hex) => hex.replace(/^0x/, "").padStart(64, "0");
export const enc = {
  uint: (v) => word(BigInt(v).toString(16)),
  address: (a) => word(a.toLowerCase()),
  bytes32: (h) => h.replace(/^0x/, "").padEnd(64, "0"),
};
/** encodeCall('f(uint256,bytes)', [{t:'uint',v:1},{t:'bytes',v:'0x..'}]) */
export function encodeCall(sig, args) {
  const head = [],
    tail = [];
  const headLen = args.length * 32;
  for (const a of args) {
    if (a.t === "bytes") {
      const data = a.v.replace(/^0x/, "");
      const offset = headLen + tail.join("").length / 2;
      head.push(enc.uint(offset));
      const padLen = Math.ceil(data.length / 64) * 64;
      tail.push(enc.uint(data.length / 2) + data.padEnd(padLen, "0"));
    } else head.push(enc[a.t](a.v));
  }
  return selector(sig) + head.join("") + tail.join("");
}

// ---- Wallet ----
const listeners = new Set();
export const wallet = {
  address: null,
  chainId: null,
  onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  _emit() {
    listeners.forEach((fn) => fn(this));
  },
  get provider() {
    return window.ethereum || null;
  },
  async connect() {
    const p = this.provider;
    if (!p) throw new Error("no_provider");
    const [a] = await p.request({ method: "eth_requestAccounts" });
    this.address = a;
    this.chainId = await p.request({ method: "eth_chainId" });
    if (!this._bound) {
      this._bound = true;
      p.on?.("accountsChanged", (acc) => {
        this.address = acc[0] || null;
        this._emit();
      });
      p.on?.("chainChanged", (c) => {
        this.chainId = c;
        this._emit();
      });
    }
    this._emit();
    return a;
  },
  disconnect() {
    this.address = null;
    this._emit();
  },
  async ensureSepolia() {
    const p = this.provider;
    if (!p) throw new Error("no_provider");
    this.chainId = await p.request({ method: "eth_chainId" });
    if (this.chainId.toLowerCase() === CONFIG.chain.hex) return;
    try {
      await p.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: CONFIG.chain.hex }],
      });
    } catch (e) {
      if (e.code === 4902) {
        await p.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: CONFIG.chain.hex,
              chainName: "Sepolia",
              nativeCurrency: {
                name: "Sepolia ETH",
                symbol: "ETH",
                decimals: 18,
              },
              rpcUrls: [CONFIG.chain.rpc],
              blockExplorerUrls: [CONFIG.chain.explorer],
            },
          ],
        });
      } else throw e;
    }
    this.chainId = await p.request({ method: "eth_chainId" });
    if (this.chainId.toLowerCase() !== CONFIG.chain.hex)
      throw new Error("wrong_chain");
  },
  async signMessage(message) {
    return this.provider.request({
      method: "personal_sign",
      params: [utf8Hex(message), this.address],
    });
  },
  async send(to, data) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(to || ""))
      throw new Error("attestation_not_configured");
    await this.ensureSepolia();
    return this.provider.request({
      method: "eth_sendTransaction",
      params: [{ from: this.address, to, data }],
    });
  },
  async call(to, data) {
    const p = this.provider;
    if (p)
      return p.request({
        method: "eth_call",
        params: [{ to, data }, "latest"],
      });
    const r = await fetch(CONFIG.chain.rpc, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_call",
        params: [{ to, data }, "latest"],
      }),
    });
    return (await r.json()).result;
  },
  async waitReceipt(hash, timeoutMs = 120000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      const r = await this.provider.request({
        method: "eth_getTransactionReceipt",
        params: [hash],
      });
      if (r) {
        if (r.status !== "0x1") throw new Error("transaction_reverted");
        return r;
      }
      await new Promise((res) => setTimeout(res, 2500));
    }
    throw new Error("receipt_timeout");
  },
};
const utf8Hex = (s) =>
  "0x" +
  Array.from(new TextEncoder().encode(s), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
export const short = (a) => (a ? a.slice(0, 6) + "\u2026" + a.slice(-4) : "");

// ---- Contract calls used by the game ----
export const chainCalls = {
  pinScore: (att) =>
    wallet.send(
      CONFIG.contracts.board,
      encodeCall(
        "pinScore(bytes32,bytes32,bytes32,uint64,uint32,uint64,bytes)",
        [
          { t: "bytes32", v: att.runId },
          { t: "bytes32", v: att.challengeId },
          { t: "bytes32", v: att.configHash },
          { t: "uint", v: att.score },
          { t: "uint", v: att.deliveries },
          { t: "uint", v: att.deadline },
          { t: "bytes", v: att.signature },
        ],
      ),
    ),
};
