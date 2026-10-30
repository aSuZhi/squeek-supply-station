// Game rules shared with the backend (keep in sync with TDD §4). Pure functions only.
export const ZOOMIES_RPM = 45;   // ≥ 45 rev/min while online → Zoomies
export const JOG_RPM = 5;        // ≥ 5 rev/min or ACTIVE → Jog
/** Map a wheel snapshot to run weather. Naps are a first-class weather, never a penalty. */
export function weatherFromStatus(s) {
  if (!s || s.freshness !== 'online' || s.coreStatus === 'COUNTER_FAULT') return 'NAP';
  if (s.rpm >= ZOOMIES_RPM) return 'ZOOMIES';
  if (s.coreStatus === 'ACTIVE' || s.rpm >= JOG_RPM) return 'JOG';
  return 'NAP';
}
export const BOARDS = { daily: 1, pot: 2, holder: 3 };
export const utcDay = (d = new Date()) => d.toISOString().slice(0, 10);
/** ISO week id as yyyyww integer, e.g. 202644. */
export function isoWeek(d = new Date()) {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = x.getUTCDay() || 7; x.setUTCDate(x.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(x.getUTCFullYear(), 0, 1));
  return x.getUTCFullYear() * 100 + Math.ceil(((x - y0) / 86400000 + 1) / 7);
}
export const dayId = (d = new Date()) => Number(utcDay(d).replace(/-/g, '')); // 20261030
/** On-chain Cheese Pot week index: weeks since Monday 1970-01-05 00:00 UTC (matches CheesePot.currentWeek()). */
export const potWeek = (ms = Date.now()) => Math.floor((Math.floor(ms / 1000) - 345600) / 604800);
export const potWeekLabel = (d = new Date()) => { const w = isoWeek(d); return `${Math.floor(w / 100)}-W${String(w % 100).padStart(2, '0')}`; };
