import test from "node:test";
import assert from "node:assert/strict";
globalThis.window = {};
globalThis.location = { origin: "http://localhost:8080" };
const session = new Map();
globalThis.sessionStorage = {
  getItem: (k) => session.get(k) || null,
  setItem: (k, v) => session.set(k, v),
  removeItem: (k) => session.delete(k),
};
const { api } = await import("../squeek-drop-frontend/squeek-drop/js/api.js");
test("browser empty POST sends valid JSON for attestation endpoint", async (t) => {
  let sent;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    sent = options;
    return new Response("{}", { status: 200 });
  });
  await api.request("/v1/runs/run/attestation", { method: "POST" });
  assert.equal(sent.body, "{}");
});
test("browser anonymous submission omits wallet JWT and preserves run ownership token", async (t) => {
  let sent;
  api.token = "private-session";
  t.mock.method(globalThis, "fetch", async (url, options) => {
    sent = options;
    return new Response("{}", { status: 200 });
  });
  await api.request("/v1/runs/run/finish", {
    method: "POST",
    body: { inputs: [] },
    runToken: "run-secret",
    publicRead: true,
  });
  assert.equal(sent.headers.authorization, undefined);
  assert.equal(sent.headers["x-run-token"], "run-secret");
});
