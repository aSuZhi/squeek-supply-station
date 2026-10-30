// Live Squeektoshi wheel feed from the public Squeekchain API, with a graceful simulation fallback.
import { CONFIG } from './config.js';
import { weatherFromStatus } from './rules.js';

const subs = new Set();
let etag = null, last = null, timer = null, failures = 0;

export const wheel = {
  get state() { return last; },
  subscribe(fn) { subs.add(fn); if (last) fn(last); return () => subs.delete(fn); },
  ready(ms = 3000) { return last ? Promise.resolve(last) : new Promise(res => { const t0 = setTimeout(() => res(last), ms); const u = wheel.subscribe(s => { clearTimeout(t0); u(); res(s); }); }); },
  start() { if (!timer) { poll(); timer = setInterval(poll, CONFIG.wheelPollMs); } },
};

async function poll() {
  try {
    const res = await fetch(CONFIG.squeekApi + '/v1/status', { headers: etag ? { 'If-None-Match': etag } : {}, cache: 'no-cache' });
    if (res.status === 304 && last) { publish({ ...last, fetchedAt: Date.now() }); return; }
    if (!res.ok) throw new Error('http_' + res.status);
    etag = res.headers.get('ETag');
    const j = await res.json();
    if (j.schemaVersion !== 1) throw new Error('schema');
    failures = 0;
    publish(parse(j, false));
  } catch (e) {
    failures++;
    if (!last || last.simulated || failures > 2) publish(simulate());
  }
}

function parse(j, simulated) {
  const m = j.measurement || {};
  const anchor = j.builder?.status === 'available' ? j.builder.anchor : null;
  const proj = j.builder?.status === 'available' ? j.builder.projected : null;
  const s = {
    simulated,
    freshness: m.freshness || 'stale',
    coreStatus: m.coreStatus || 'IDLE',
    rpm: (m.rpmMilli || 0) / 1000,
    speed: (m.speedMmPerSecond || 0) / 1000,
    distanceM: (m.distanceMm || 0) / 1000,
    blockHeight: proj?.blockHeight ?? anchor?.blockHeight ?? null,
    blockProgress: Number(proj?.blockProgress ?? anchor?.blockProgress ?? 0),
    settledRound: anchor?.settledThroughRound ?? null,
    txHash: anchor?.transactionHash ?? null,
    fetchedAt: Date.now(),
  };
  s.weather = weatherFromStatus(s);
  return s;
}

// Deterministic-looking simulation so the UI is never blank when offline.
function simulate() {
  const t = Date.now() / 1000;
  const phase = Math.floor(t / 90) % 3;              // rotate weather every 90 s
  const rpm = phase === 0 ? 0 : phase === 1 ? 22 + 6 * Math.sin(t / 7) : 58 + 8 * Math.sin(t / 5);
  const progress = Math.floor(((t * 3.1e6) % 1e9));
  return parse({
    measurement: { freshness: 'online', coreStatus: phase ? 'ACTIVE' : 'IDLE', rpmMilli: Math.round(rpm * 1000), speedMmPerSecond: Math.round(rpm * 14.6), distanceMm: Math.round(t % 86400 * 210) },
    builder: { status: 'available', anchor: { blockHeight: String(2400 + Math.floor(t / 600) % 900), blockProgress: String(progress), settledThroughRound: String(Math.floor((t - 1791847800) / 600)) }, projected: null },
  }, true);
}
function publish(s) { last = s; subs.forEach(fn => fn(s)); }
