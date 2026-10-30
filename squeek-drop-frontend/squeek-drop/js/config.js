const override = window.SQUEEK_DROP_CONFIG || {};
export const CONFIG = {
  apiBase: (override.apiBase || location.origin).replace(/\/$/, ""),
  chain: {
    id: 11155111,
    hex: "0xaa36a7",
    name: "Sepolia",
    explorer: "https://sepolia.etherscan.io",
    rpc: "https://ethereum-sepolia-rpc.publicnode.com",
  },
  contracts: { board: "" },
  attestationConfigured: false,
};
