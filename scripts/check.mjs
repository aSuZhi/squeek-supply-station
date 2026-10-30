import { readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
const roots = [
  "server",
  "scripts",
  "tests",
  "squeek-drop-frontend/squeek-drop/js",
];
let count = 0;
for (const root of roots)
  for (const name of readdirSync(root))
    if (/\.(mjs|js)$/.test(name)) {
      const p = spawnSync(process.execPath, ["--check", join(root, name)], {
        encoding: "utf8",
        windowsHide: true,
      });
      if (p.status !== 0) {
        console.error(p.stderr);
        process.exit(1);
      }
      count++;
    }
console.log(`Syntax OK: ${count} JavaScript files`);
