import { Worker } from "node:worker_threads";
import { fail } from "./util.js";
export class ReplayPool {
  constructor(size = 2) {
    this.queue = [];
    this.closed = false;
    this.slots = Array.from({ length: size }, () => this.spawn());
  }
  spawn() {
    const slot = {
      worker: new Worker(new URL("./replay-worker.js", import.meta.url)),
      job: null,
    };
    slot.worker.on("message", (result) => {
      if (!slot.job) return;
      clearTimeout(slot.job.timer);
      slot.job.resolve(result);
      slot.job = null;
      this.drain();
    });
    slot.worker.on("error", () => this.broken(slot));
    slot.worker.on("exit", (code) => {
      if (code && !this.closed) this.broken(slot);
    });
    return slot;
  }
  broken(slot) {
    const index = this.slots.indexOf(slot);
    if (index < 0 || this.closed) return;
    if (slot.job) {
      clearTimeout(slot.job.timer);
      slot.job.reject(fail("replay_unavailable", 503));
    }
    this.slots[index] = this.spawn();
    slot.worker.terminate();
    this.drain();
  }
  run(payload) {
    if (this.closed || this.queue.length >= 16)
      return Promise.reject(fail("replay_busy", 503));
    return new Promise((resolve, reject) => {
      this.queue.push({ payload, resolve, reject });
      this.drain();
    });
  }
  drain() {
    for (const slot of this.slots) {
      if (slot.job || !this.queue.length) continue;
      const job = this.queue.shift();
      slot.job = job;
      job.timer = setTimeout(() => this.broken(slot), 15000);
      slot.worker.postMessage(job.payload);
    }
  }
  async close() {
    this.closed = true;
    for (const j of this.queue.splice(0)) j.reject(fail("server_closing", 503));
    for (const s of this.slots)
      if (s.job) {
        clearTimeout(s.job.timer);
        s.job.reject(fail("server_closing", 503));
      }
    await Promise.all(this.slots.map((s) => s.worker.terminate()));
  }
}
