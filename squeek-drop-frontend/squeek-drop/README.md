# Squeek Drop · 仓鼠大合成

A merge-drop game played with Squeektoshi, Squeekchain's hamster. Built for the Squeekchain Genesis code lane.

- **Live wheel → run weather** (Nap / Jog / Zoomies) from `api.squeekchain.com/v1/status`
- **Block bar** starts at SqueekCore's real `blockProgress`. Merges mine blocks → Fever ×2 + golden SQK seed
- **Verified scores**: the backend replays the input log with the same `js/engine.js` and signs an EIP-712 attestation, then the player pins it on Sepolia
- **Cheese Pot**: weekly SQK (Sepolia) tournament. `approve` on SqueekToken + `enter` on CheesePot
- **Holder Cup**: Squeek NFT holders pick a captain Squeek (score boost + separate board)

## Run locally
```
npm test              # engine determinism / replay tests
npm run dev           # static server on :5173 → http://localhost:5173
```
Without a backend the app runs in **demo mode** (mock API in `js/api.js`, localStorage). To point it at a backend:
`http://localhost:5173/?api=https://api.squeekdrop.xyz` or define `window.SQUEEK_DROP_CONFIG = { apiBase: '…' }` before `js/app.js`.

## Files
| Path | Role |
|---|---|
| `js/engine.js` | Deterministic simulation + `replay()`. **Shared with the backend verifier. Do not fork.** |
| `js/rules.js` | Weather mapping, board ids, season ids (shared) |
| `js/render.js` | Canvas renderer (hamster balls, particles) |
| `js/app.js` | UI controller, game loop, input, flows |
| `js/api.js` | HTTP client (TDD §6) + `MockApi` |
| `js/wallet.js` | EIP-1193 wallet, keccak256, ABI encoding, contract calls |
| `js/wheel.js` | Live Squeekchain status poller with simulation fallback |
| `js/i18n.js` | EN / 中文 strings |

No build step, no runtime dependencies: deploy the folder as a static site (IPFS / ENS via IMD).
