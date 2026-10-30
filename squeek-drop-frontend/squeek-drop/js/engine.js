// Squeek Drop — deterministic simulation core.
// Shared by the browser (live play) and the backend (replay verification).
// Rules: only + - * / Math.sqrt Math.floor Math.abs Math.min Math.max on doubles,
// fixed iteration order, integer RNG and integer scoring. No Date, no Math.random.

import { practiceConfig, DURATION_TICKS } from "./challenge.js";
export const RULES_VERSION = "ss-2.0.0";
export const TICK_HZ = 60;
export const W = 400;
export const H = 640;
export const DROP_Y = 58;
export const DEAD_Y = 112;
export const MAX_TICKS = DURATION_TICKS;
export const BLOCK_UNITS = 1000000000; // same scale as SqueekCore blockProgress

// Level 0 = golden SQK seed (wildcard). Levels 1..11 = Squeek evolution.
export const LEVELS = [
  { r: 15, key: "seed" },
  { r: 15, key: "pip" },
  { r: 20, key: "puff" },
  { r: 27, key: "fuzz" },
  { r: 35, key: "cheeks" },
  { r: 44, key: "jogger" },
  { r: 54, key: "wheelie" },
  { r: 65, key: "hoarder" },
  { r: 77, key: "miner" },
  { r: 90, key: "validator" },
  { r: 104, key: "mega" },
  { r: 118, key: "squeektoshi" },
];
export const MAX_LEVEL = 11;
// Base points for creating level k (triangular numbers), index = new level.
export const MERGE_POINTS = [0, 0, 1, 3, 6, 10, 15, 21, 28, 36, 45, 55];
export const DOUBLE_TOSHI_POINTS = 200;
// Spawn weights for levels 1..5 (sum 100).
export const SPAWN_WEIGHTS = [32, 28, 20, 12, 8];

// Wheel weather — fixed for a run, chosen by the server from the live wheel snapshot.
export const WEATHER = {
  NAP: { multBps: 10000, shakes: 2, preview: 2, cooldown: 30, gravity: 1500 },
  JOG: { multBps: 12000, shakes: 1, preview: 1, cooldown: 26, gravity: 1650 },
  ZOOMIES: {
    multBps: 15000,
    shakes: 1,
    preview: 1,
    cooldown: 22,
    gravity: 1800,
  },
};

export const INPUT = { DROP: 0, SWAP: 1, SHAKE: 2, DELIVER: 3 };

const DT = 1 / TICK_HZ;
const SUB = 2;
const ITER = 4;
const RESTITUTION = 0.12;
const DAMP = 0.996;
const FEVER_TICKS = 600;
const COMBO_WINDOW = 45;
const OVER_TICKS = 120;
const GRACE_TICKS = 70;

export function hashSeed(str) {
  // FNV-1a 32-bit over the UTF-16 code units → uint32, never 0.
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h === 0 ? 0x9e3779b9 : h;
}

export class Rng {
  constructor(seed) {
    this.s = seed >>> 0 || 0x9e3779b9;
  }
  next() {
    let s = this.s;
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    this.s = s;
    return s;
  }
  int(n) {
    return this.next() % n;
  }
}

export class Sim {
  /**
   * @param {object} cfg { seed: string, weather: 'NAP'|'JOG'|'ZOOMIES', blockStart: int 0..1e9-1, captainLevel: int 0..11 }
   */
  constructor(cfg) {
    this.cfg = {
      seed: String(cfg.seed),
      phases: structuredClone(cfg.phases || practiceConfig().phases),
      durationTicks: DURATION_TICKS,
    };
    this.phaseIndex = 0;
    this.phaseDelivered = [0, 0, 0];
    this.deliveries = 0;
    this.deliveryScore = 0;
    this.completedMissions = 0;
    this.cfg.weather = this.cfg.phases[0].weather;
    this.w = WEATHER[this.cfg.weather];
    this.rng = new Rng(hashSeed(RULES_VERSION + "|" + this.cfg.seed));
    this.tick = 0;
    this.balls = [];
    this.nextId = 1;
    this.score = 0;
    this.merges = 0;
    this.maxLevel = 0;
    this.combo = 0;
    this.lastMergeTick = -1000;
    this.fever = 0;
    this.blocks = 0;
    this.blockBar = 0; // Game energy. Never chain progress.
    this.shakes = this.w.shakes;
    this.cooldown = 0;
    this.pouch = -1;
    this.swapLocked = false;
    this.overTimer = 0;
    this.over = false;
    this.queue = [];
    for (let i = 0; i < 4; i++) this.queue.push(this._spawnLevel());
    this.events = []; // transient, consumed by renderer
    this.inputs = []; // recorded log [tick, code, x]
  }

  _spawnLevel() {
    let r = this.rng.int(100);
    for (let i = 0; i < SPAWN_WEIGHTS.length; i++) {
      if (r < SPAWN_WEIGHTS[i]) return i + 1;
      r -= SPAWN_WEIGHTS[i];
    }
    return 1;
  }

  get current() {
    return this.queue[0];
  }
  get phase() {
    return this.cfg.phases[this.phaseIndex];
  }
  get deliveryCandidate() {
    if (this.over || this.phaseDelivered[this.phaseIndex] >= this.phase.quota)
      return null;
    return (
      this.balls.find(
        (b) => b.lv === this.phase.targetLevel && this.tick - b.born >= 70,
      ) || null
    );
  }
  get multBps() {
    return this.w.multBps;
  }
  canDrop() {
    return !this.over && this.cooldown === 0;
  }

  /** Apply an input at the current tick. Returns true if accepted. Records accepted inputs. */
  apply(code, x) {
    if (this.over) return false;
    let ok = false;
    if (code === INPUT.DROP) ok = this._drop(x);
    else if (code === INPUT.SWAP) ok = this._swap();
    else if (code === INPUT.SHAKE) ok = this._shake();
    else if (code === INPUT.DELIVER) ok = this._deliver();
    if (ok)
      this.inputs.push(
        code === INPUT.DROP ? [this.tick, code, x] : [this.tick, code],
      );
    return ok;
  }

  _drop(xIn) {
    if (!this.canDrop()) return false;
    const x0 = Math.floor(Number(xIn));
    if (!(x0 >= 0 && x0 <= W)) return false;
    const lv = this.queue.shift();
    this.queue.push(this._spawnLevel());
    const r = LEVELS[lv].r;
    const x = Math.max(r + 2, Math.min(W - r - 2, x0));
    this.balls.push({
      id: this.nextId++,
      lv,
      x,
      y: DROP_Y,
      vx: 0,
      vy: 0,
      born: this.tick,
    });
    this.cooldown = this.w.cooldown;
    this.swapLocked = false;
    this.events.push({ t: "drop", x, y: DROP_Y, lv });
    return true;
  }

  _swap() {
    if (this.swapLocked) return false;
    const cur = this.queue[0];
    if (this.pouch === -1) {
      this.pouch = cur;
      this.queue.shift();
      this.queue.push(this._spawnLevel());
    } else {
      this.queue[0] = this.pouch;
      this.pouch = cur;
    }
    this.swapLocked = true;
    this.events.push({ t: "swap" });
    return true;
  }

  _shake() {
    if (this.shakes <= 0 || this.balls.length === 0) return false;
    this.shakes--;
    for (const b of this.balls) {
      b.vy -= 300 + (b.id % 5) * 25;
      b.vx += (((b.id * 37) % 11) - 5) * 14;
    }
    this.events.push({ t: "shake" });
    return true;
  }

  _deliver() {
    const b = this.deliveryCandidate;
    if (!b) return false;
    this.balls = this.balls.filter((ball) => ball.id !== b.id);
    this.phaseDelivered[this.phaseIndex]++;
    this.deliveries++;
    let pts = this.phase.reward;
    if (this.phaseDelivered[this.phaseIndex] === this.phase.quota) {
      pts += 200;
      this.completedMissions++;
    }
    this.score += pts;
    this.deliveryScore += pts;
    this.events.push({ t: "delivery", x: b.x, y: b.y, lv: b.lv, pts });
    return true;
  }

  step() {
    if (this.over) return;
    const g = this.w.gravity;
    const sdt = DT / SUB;
    const balls = this.balls;
    for (let s = 0; s < SUB; s++) {
      for (const b of balls) {
        b.vy += g * sdt;
        b.vx *= DAMP;
        b.vy *= DAMP;
        b.x += b.vx * sdt;
        b.y += b.vy * sdt;
      }
      for (let it = 0; it < ITER; it++) {
        for (let i = 0; i < balls.length; i++) {
          const a = balls[i];
          const ra = LEVELS[a.lv].r;
          for (let j = i + 1; j < balls.length; j++) {
            const b = balls[j];
            const rb = LEVELS[b.lv].r;
            const dx = b.x - a.x,
              dy = b.y - a.y;
            const rr = ra + rb;
            const d2 = dx * dx + dy * dy;
            if (d2 >= rr * rr || d2 === 0) continue;
            const d = Math.sqrt(d2);
            const nx = dx / d,
              ny = dy / d;
            const pen = rr - d;
            const ma = ra * ra,
              mb = rb * rb,
              mt = ma + mb;
            a.x -= nx * pen * (mb / mt);
            a.y -= ny * pen * (mb / mt);
            b.x += nx * pen * (ma / mt);
            b.y += ny * pen * (ma / mt);
            const rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
            if (rv < 0) {
              const jimp = (-(1 + RESTITUTION) * rv) / (1 / ma + 1 / mb);
              a.vx -= (jimp / ma) * nx;
              a.vy -= (jimp / ma) * ny;
              b.vx += (jimp / mb) * nx;
              b.vy += (jimp / mb) * ny;
            }
          }
        }
        for (const b of balls) {
          const r = LEVELS[b.lv].r;
          if (b.x < r) {
            b.x = r;
            if (b.vx < 0) b.vx = -b.vx * 0.3;
          }
          if (b.x > W - r) {
            b.x = W - r;
            if (b.vx > 0) b.vx = -b.vx * 0.3;
          }
          if (b.y > H - r) {
            b.y = H - r;
            if (b.vy > 0) b.vy = -b.vy * 0.2;
            b.vx *= 0.985;
          }
        }
      }
    }
    this._merge();
    this.tick++;
    if (this.cooldown > 0) this.cooldown--;
    if (this.fever > 0) this.fever--;
    if (this.tick - this.lastMergeTick > COMBO_WINDOW) this.combo = 0;
    // Game over: any settled ball poking above the dead line for OVER_TICKS.
    let danger = false;
    for (const b of this.balls) {
      if (this.tick - b.born < GRACE_TICKS) continue;
      if (b.y - LEVELS[b.lv].r < DEAD_Y) {
        danger = true;
        break;
      }
    }
    this.overTimer = danger ? this.overTimer + 1 : 0;
    if (this.overTimer >= OVER_TICKS || this.tick >= MAX_TICKS) {
      this.over = true;
      this.events.push({ t: "over" });
    }
    if (!this.over && this.tick >= this.phase.endTick && this.phaseIndex < 2) {
      this.phaseIndex++;
      this.cfg.weather = this.phase.weather;
      this.w = WEATHER[this.phase.weather];
      this.shakes = this.w.shakes;
      this.events.push({ t: "phase", index: this.phaseIndex });
    }
  }

  _addScore(base, x, y, lv) {
    let bps = this.multBps;
    if (this.fever > 0) bps *= 2;
    const comboBps = 10000 + Math.min(10000, this.combo * 1000);
    const pts = Math.floor((((base * bps) / 10000) * comboBps) / 10000);
    this.score += pts;
    this.events.push({ t: "merge", x, y, lv, pts, combo: this.combo });
  }

  _mineProgress(units) {
    this.blockBar += units;
    while (this.blockBar >= BLOCK_UNITS) {
      this.blockBar -= BLOCK_UNITS;
      this.blocks++;
      this.fever = FEVER_TICKS;
      this.queue.splice(1, 0, 0); // golden SQK seed becomes the next drop
      this.queue.length = 4;
      this.events.push({ t: "block", n: this.blocks });
    }
  }

  _merge() {
    const balls = this.balls;
    const dead = new Set();
    const born = [];
    for (let i = 0; i < balls.length; i++) {
      const a = balls[i];
      if (dead.has(a.id)) continue;
      const ra = LEVELS[a.lv].r;
      for (let j = i + 1; j < balls.length; j++) {
        const b = balls[j];
        if (dead.has(b.id)) continue;
        const wild = a.lv === 0 || b.lv === 0;
        if (!wild && a.lv !== b.lv) continue;
        if (a.lv === 0 && b.lv === 0) continue;
        const rb = LEVELS[b.lv].r;
        const dx = b.x - a.x,
          dy = b.y - a.y;
        const lim = ra + rb + 1.5;
        if (dx * dx + dy * dy > lim * lim) continue;
        dead.add(a.id);
        dead.add(b.id);
        const mx = (a.x + b.x) / 2,
          my = (a.y + b.y) / 2;
        if (this.tick - this.lastMergeTick <= COMBO_WINDOW) this.combo++;
        else this.combo = 0;
        this.lastMergeTick = this.tick;
        this.merges++;
        if (wild) {
          const host = a.lv === 0 ? b : a;
          const nl = Math.min(MAX_LEVEL, host.lv + 1);
          born.push({
            id: this.nextId++,
            lv: nl,
            x: host.x,
            y: host.y,
            vx: host.vx * 0.5,
            vy: host.vy * 0.5 - 40,
            born: this.tick,
          });
          this.maxLevel = Math.max(this.maxLevel, nl);
          this._addScore(MERGE_POINTS[nl] + 5, host.x, host.y, nl);
          this._mineProgress(nl * 6000000);
        } else if (a.lv === MAX_LEVEL) {
          this._addScore(DOUBLE_TOSHI_POINTS, mx, my, MAX_LEVEL);
          this.events.push({ t: "toshi", x: mx, y: my });
          this._mineProgress(BLOCK_UNITS);
        } else {
          const nl = a.lv + 1;
          born.push({
            id: this.nextId++,
            lv: nl,
            x: mx,
            y: my,
            vx: (a.vx + b.vx) / 2,
            vy: (a.vy + b.vy) / 2 - 60,
            born: this.tick,
          });
          this.maxLevel = Math.max(this.maxLevel, nl);
          this._addScore(MERGE_POINTS[nl], mx, my, nl);
          this._mineProgress(nl * 6000000);
        }
        break;
      }
    }
    if (dead.size) {
      this.balls = balls.filter((b) => !dead.has(b.id));
      for (const b of born) this.balls.push(b);
    }
  }

  /** Compact digest of the final state, used to cross-check client vs server replay. */
  digest() {
    let h = 0x811c9dc5;
    const mix = (n) => {
      h ^= n >>> 0;
      h = Math.imul(h, 0x01000193) >>> 0;
    };
    mix(this.tick);
    mix(this.score);
    mix(this.merges);
    mix(this.blocks);
    mix(this.balls.length);
    mix(this.deliveries);
    mix(this.deliveryScore);
    mix(this.completedMissions);
    mix(this.phaseIndex);
    for (const n of this.phaseDelivered) mix(n);
    mix(this.rng.s);
    mix(this.cooldown);
    mix(this.pouch);
    mix(this.fever);
    mix(this.blockBar);
    for (const lv of this.queue) mix(lv);
    for (const b of this.balls) {
      mix(b.id);
      mix(b.lv);
      mix(Math.floor(b.x * 100));
      mix(Math.floor(b.y * 100));
    }
    return h.toString(16).padStart(8, "0");
  }

  summary() {
    return {
      rulesVersion: RULES_VERSION,
      score: this.score,
      ticks: this.tick,
      merges: this.merges,
      maxLevel: this.maxLevel,
      blocks: this.blocks,
      over: this.over,
      digest: this.digest(),
      deliveries: this.deliveries,
      deliveryScore: this.deliveryScore,
      completedMissions: this.completedMissions,
      phaseDelivered: [...this.phaseDelivered],
    };
  }
}

/**
 * Replay an input log. Used by the backend verifier and by client self-checks.
 * inputs: [[tick, code, x?], ...] sorted by tick (several inputs may share a tick).
 * endTick: tick at which the run ended (game over or forfeit).
 */
export function replay(cfg, inputs, endTick) {
  const sim = new Sim(cfg);
  let k = 0;
  const limit = Math.min(MAX_TICKS, endTick == null ? MAX_TICKS : endTick);
  while (!sim.over && sim.tick < limit) {
    while (k < inputs.length && inputs[k][0] === sim.tick) {
      const [, code, x] = inputs[k++];
      if (!sim.apply(code, x))
        return { ok: false, reason: "input_rejected", at: k - 1, sim };
    }
    if (k < inputs.length && inputs[k][0] < sim.tick)
      return { ok: false, reason: "input_out_of_order", at: k, sim };
    sim.step();
    sim.events.length = 0;
  }
  if (k < inputs.length)
    return { ok: false, reason: "inputs_after_end", at: k, sim };
  return { ok: true, sim, summary: sim.summary() };
}
