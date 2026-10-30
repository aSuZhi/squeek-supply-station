// Runtime configuration. Override by defining window.SQUEEK_DROP_CONFIG before app.js loads,
// or via URL params (?api=https://api.example.com&mock=1) for local testing.
const params = new URLSearchParams(location.search);
const override = window.SQUEEK_DROP_CONFIG || {};
export const CONFIG = {
  // Empty apiBase → built-in mock backend (demo mode, everything stays in localStorage).
  apiBase: params.get('api') ?? override.apiBase ?? '',
  squeekApi: override.squeekApi ?? 'https://api.squeekchain.com',
  wheelPollMs: 5000,
  chain: { id: 11155111, hex: '0xaa36a7', name: 'Sepolia', explorer: 'https://sepolia.etherscan.io', rpc: 'https://ethereum-sepolia-rpc.publicnode.com' },
  // Squeekchain Sepolia graph (docs.squeekchain.com/developers)
  squeekchain: {
    sqk: '0x6872bfa5ccc3e9e440c6c16e5ffdabb8dba4cc76',
    nft: '0x0eAF3E0d40A0a8E5a6Ac030b2459E9FB0B7905c6',
    core: '0x74665dAecA35A2303e767E76a2FF1FB6F93e119f',
  },
  // Filled from GET /v1/config at boot when a backend is configured.
  contracts: { board: override.board || '', pot: override.pot || '' },
  streamUrl: 'https://squeekchain.com/',
  forceMock: params.get('mock') === '1',
};
export const isMock = () => CONFIG.forceMock || !CONFIG.apiBase;
