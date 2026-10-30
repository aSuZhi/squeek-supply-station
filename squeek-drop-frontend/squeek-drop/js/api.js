// Backend client. Same interface for the real HTTP API (TDD §6) and the in-browser mock.
import { CONFIG, isMock } from './config.js';
import { replay, RULES_VERSION } from './engine.js';
import { weatherFromStatus, BOARDS, utcDay, dayId, potWeek, potWeekLabel } from './rules.js';
import { wheel } from './wheel.js';

class ApiError extends Error { constructor(code, status, detail) { super(code); this.code = code; this.status = status; this.detail = detail; } }

class HttpApi {
  constructor(base) { this.base = base.replace(/\/$/, ''); this.token = sessionStorage.getItem('sd.jwt'); }
  async _req(method, path, body, auth = true) {
    const headers = { 'content-type': 'application/json', 'x-request-id': 'sd-' + Math.random().toString(36).slice(2, 12) };
    if (auth && this.token) headers.authorization = 'Bearer ' + this.token;
    const res = await fetch(this.base + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(j.error || 'http_' + res.status, res.status, j);
    return j;
  }
  config() { return this._req('GET', '/v1/config', null, false); }
  async login(address, signFn) {
    const { message } = await this._req('POST', '/v1/auth/nonce', { address }, false);
    const signature = await signFn(message);
    const r = await this._req('POST', '/v1/auth/verify', { address, message, signature }, false);
    this.token = r.token; sessionStorage.setItem('sd.jwt', r.token);
    return r;
  }
  logout() { this.token = null; sessionStorage.removeItem('sd.jwt'); }
  startRun(mode, opts = {}) { return this._req('POST', '/v1/runs', { mode, captainTokenId: opts.captainTokenId ?? null, clientRulesVersion: RULES_VERSION }); }
  finishRun(runId, payload) { return this._req('POST', `/v1/runs/${runId}/finish`, payload); }
  reportPin(runId, txHash) { return this._req('POST', `/v1/runs/${runId}/pin`, { txHash }); }
  leaderboard(board, season) { return this._req('GET', `/v1/leaderboards/${board}${season ? '?season=' + season : ''}`, null, true); }
  me() { return this._req('GET', '/v1/me'); }
  holderSqueeks() { return this._req('GET', '/v1/holder/squeeks'); }
  pot() { return this._req('GET', '/v1/pot/current'); }
}

// ---------- Mock backend: lets the frontend run with zero infrastructure ----------
const LS = 'sd.mock.v1';
const DEMO_NAMES = ['wheelwatcher.eth', 'cheekyminer', 'squeek_maxi', '0xNibbles', 'seedhoarder', 'hamsterdao', 'zoomies420', 'naptime.eth', 'validatoor', 'pouchpro', 'toshi_fan', 'gm_squeek'];
function load() { try { return JSON.parse(localStorage.getItem(LS)) || {}; } catch { return {}; } }
function save(db) { localStorage.setItem(LS, JSON.stringify(db)); }
function rid() { return '0x' + Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join(''); }
function demoBoard(seasonKey, n = 12) {
  let h = 0; for (const c of seasonKey) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const rnd = () => (h = (h * 1103515245 + 12345) >>> 0) / 4294967296;
  return DEMO_NAMES.slice(0, n).map((name, i) => ({
    address: '0x' + (Math.floor(rnd() * 1e16)).toString(16).padStart(14, '0') + 'demo' + String(i).padStart(2, '0') + 'a'.repeat(20),
    name, score: Math.floor(900 + rnd() * 6200), maxLevel: 7 + Math.floor(rnd() * 4), weather: ['NAP', 'JOG', 'ZOOMIES'][Math.floor(rnd() * 3)], pinned: rnd() > 0.6, demo: true,
  }));
}
class MockApi {
  constructor() { this.address = null; }
  async config() {
    return { chainId: 11155111, rulesVersion: RULES_VERSION, contracts: { board: '', pot: '', sqk: CONFIG.squeekchain.sqk, nft: CONFIG.squeekchain.nft }, entryFeeBaseUnits: '10000000000000000000', mock: true };
  }
  async login(address, signFn) { await signFn(`Squeek Drop wants you to sign in with ${address}\n\n(demo mode — no backend)`); this.address = address.toLowerCase(); return { token: 'mock', address }; }
  logout() { this.address = null; }
  async startRun(mode, opts = {}) {
    if ((mode === 'pot' || mode === 'holder') && !this.address) throw new ApiError('auth_required', 401);
    const s = await wheel.ready();
    const weather = weatherFromStatus(s);
    const day = utcDay();
    const seed = mode === 'daily' || mode === 'holder' ? `daily:${day}` : mode === 'pot' ? `pot:${potWeek()}` : `free:${rid().slice(2, 18)}`;
    const run = { runId: rid(), mode, board: BOARDS[mode] || 0, seasonId: mode === 'pot' ? potWeek() : dayId(), seed, weather,
      blockStart: Math.max(0, Math.min(999999999, Math.floor(s?.blockProgress || 0))), captainLevel: mode === 'holder' ? (opts.captainLevel || 0) : 0,
      rulesVersion: RULES_VERSION, startedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 40 * 60000).toISOString(),
      wheelSnapshot: s ? { rpm: s.rpm, coreStatus: s.coreStatus, blockHeight: s.blockHeight, blockProgress: s.blockProgress, simulated: s.simulated } : null };
    const db = load(); db.runs = db.runs || {}; db.runs[run.runId] = { ...run, status: 'started' }; save(db);
    return run;
  }
  async finishRun(runId, { inputs, endTick, clientSummary }) {
    await new Promise(r => setTimeout(r, 450));
    const db = load(); const run = db.runs?.[runId];
    if (!run) throw new ApiError('run_not_found', 404);
    if (run.status !== 'started') throw new ApiError('run_already_finished', 409);
    const rep = replay({ seed: run.seed, weather: run.weather, blockStart: run.blockStart, captainLevel: run.captainLevel }, inputs, endTick);
    const ok = rep.ok && rep.summary.digest === clientSummary.digest && rep.summary.score === clientSummary.score;
    run.status = ok ? 'verified' : 'rejected';
    const res = { runId, status: run.status, reason: ok ? null : (rep.reason || 'digest_mismatch'), score: ok ? rep.summary.score : 0, summary: rep.summary };
    if (ok && run.board) {
      const key = `${run.board}:${run.seasonId}`;
      db.best = db.best || {};
      const prev = db.best[key]?.score || 0;
      res.isNewBest = res.score > prev;
      if (res.isNewBest) db.best[key] = { score: res.score, maxLevel: rep.summary.maxLevel, weather: run.weather, runId, at: Date.now() };
      res.personalBest = Math.max(prev, res.score);
      const board = demoBoard(key).map(e => e.score).sort((a, b) => b - a);
      res.rank = board.filter(s => s > res.personalBest).length + 1;
      res.attestation = { runId, board: run.board, season: run.seasonId, score: res.score, maxLevel: rep.summary.maxLevel, deadline: Math.floor(Date.now() / 1000) + 86400, signature: '0x' + '00'.repeat(65), mock: true };
    }
    const allKey = 'all';
    db.best = db.best || {};
    if (ok && res.score > (db.best[allKey]?.score || 0)) db.best[allKey] = { score: res.score, maxLevel: rep.summary.maxLevel, weather: run.weather, runId, at: Date.now() };
    save(db);
    return res;
  }
  async reportPin(runId, txHash) { const db = load(); db.pins = db.pins || {}; db.pins[runId] = txHash; save(db); return { ok: true }; }
  async leaderboard(board) {
    const db = load();
    const season = board === 'pot' ? potWeek() : dayId();
    const key = board === 'all' ? 'all' : `${BOARDS[board]}:${season}`;
    const entries = demoBoard(key);
    const mine = db.best?.[key];
    if (mine) entries.push({ address: this.address || '0xyou', name: null, you: true, score: mine.score, maxLevel: mine.maxLevel, weather: mine.weather, pinned: !!db.pins?.[mine.runId] });
    entries.sort((a, b) => b.score - a.score);
    entries.forEach((e, i) => e.rank = i + 1);
    return { board, season, entries: entries.slice(0, 50), me: entries.find(e => e.you) || null, mock: true };
  }
  async me() { const db = load(); return { address: this.address, bests: db.best || {} }; }
  async holderSqueeks() {
    if (!this.address) throw new ApiError('auth_required', 401);
    return { items: [ { tokenId: '17', level: 3, power: '1210' }, { tokenId: '204', level: 1, power: '1000' } ], mock: true };
  }
  async pot() {
    const end = new Date(); end.setUTCDate(end.getUTCDate() + ((7 - (end.getUTCDay() || 7)) + 1)); end.setUTCHours(0, 0, 0, 0);
    const db = load();
    return { week: potWeek(), weekLabel: potWeekLabel(), entryFeeBaseUnits: '10000000000000000000', potBaseUnits: String(BigInt(37 + (db.potEntered ? 1 : 0)) * 10n ** 19n), entrants: 37 + (db.potEntered ? 1 : 0), endsAt: end.toISOString(), entered: !!db.potEntered, payoutBps: [5000, 3000, 2000], mock: true };
  }
  async mockEnterPot() { const db = load(); db.potEntered = potWeek(); save(db); }
}

export const api = isMock() ? new MockApi() : new HttpApi(CONFIG.apiBase);
export { ApiError };
