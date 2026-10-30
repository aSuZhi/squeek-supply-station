import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exportSite } from "../scripts/export-site.mjs";
test("static release injects explicit API origin and excludes backend, data and secrets", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "squeek-export-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const out = join(root, "site");
  await exportSite({ apiBase: "https://api.example.com", out });
  assert.deepEqual((await readdir(out)).sort(), [
    "css",
    "index.html",
    "js",
    "runtime-config.js",
  ]);
  const html = await readFile(join(out, "index.html"), "utf8");
  assert.ok(html.indexOf("runtime-config.js") < html.indexOf("js/app.js"));
  assert.match(
    await readFile(join(out, "runtime-config.js"), "utf8"),
    /https:\/\/api.example.com/,
  );
  await assert.rejects(
    exportSite({ apiBase: "https://api.example.com", out }),
    /must be empty/,
  );
});
test("static publishing rejects missing API, embedded credentials and insecure endpoints", async () => {
  for (const apiBase of [
    undefined,
    "http://api.example.com",
    "https://key:secret@api.example.com",
    "https://api.example.com/path",
    "https://api.example.com/?key=secret",
  ])
    await assert.rejects(exportSite({ apiBase }));
});
