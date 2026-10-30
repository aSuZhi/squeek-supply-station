import { parentPort } from "node:worker_threads";
import { replay } from "../squeek-drop-frontend/squeek-drop/js/engine.js";
parentPort.on("message", ({ config, inputs, endTick }) => {
  try {
    const r = replay(config, inputs, endTick);
    parentPort.postMessage({
      ok: r.ok,
      reason: r.reason || null,
      summary: r.summary || r.sim?.summary(),
    });
  } catch {
    parentPort.postMessage({ ok: false, reason: "invalid_replay" });
  }
});
