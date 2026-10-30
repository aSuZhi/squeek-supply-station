import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export function openStore(path) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS challenges (day TEXT PRIMARY KEY, id TEXT UNIQUE NOT NULL, json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS nonces (message TEXT PRIMARY KEY, address TEXT NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY, challenge_id TEXT NOT NULL REFERENCES challenges(id), address TEXT,
      owner_hash TEXT NOT NULL, rate_key TEXT NOT NULL, started INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'started', payload_hash TEXT, payload TEXT, result TEXT,
      score INTEGER, deliveries INTEGER, finished INTEGER, pin_hash TEXT, pin_status TEXT DEFAULT 'none'
    );
    CREATE INDEX IF NOT EXISTS runs_board ON runs(challenge_id,status,address,score DESC);
    CREATE INDEX IF NOT EXISTS runs_rate ON runs(rate_key,started);
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
  // A process crash can interrupt a replay; clients can safely resubmit the saved log.
  db.prepare("UPDATE runs SET status='started' WHERE status='verifying'").run();
  return db;
}
export function transaction(db, fn) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
export function standings(db, challengeId) {
  return db
    .prepare(
      `SELECT * FROM (
    SELECT id AS runId,address,score,deliveries,finished,pin_status AS pinStatus,pin_hash AS txHash,
    ROW_NUMBER() OVER (PARTITION BY address ORDER BY score DESC, finished ASC, id ASC) AS personal
    FROM runs WHERE challenge_id=? AND status='verified' AND address IS NOT NULL
  ) WHERE personal=1 ORDER BY score DESC,finished ASC,runId ASC`,
    )
    .all(challengeId)
    .map((r, i) => ({
      ...r,
      rank: i + 1,
      pinned: r.pinStatus === "confirmed",
    }));
}
