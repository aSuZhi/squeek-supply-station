import {
  mkdir,
  readdir,
  readFile,
  writeFile,
  copyFile,
} from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
export async function exportSite({
  apiBase,
  out = resolve(root, "dist"),
} = {}) {
  if (!apiBase)
    throw new Error(
      "SITE_API_BASE is required; do not publish a frontend pointing to its own static host.",
    );
  const url = new URL(apiBase);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  ) {
    throw new Error(
      "SITE_API_BASE must be an HTTPS origin without credentials, path, query or fragment.",
    );
  }
  const entries = await readdir(out).catch((e) => {
    if (e.code === "ENOENT") return [];
    throw e;
  });
  if (entries.length)
    throw new Error(
      "Output directory must be empty. Use --out with a new directory to avoid mixing releases.",
    );
  const source = resolve(root, "squeek-drop-frontend/squeek-drop");
  await mkdir(out, { recursive: true });
  for (const folder of ["js", "css"]) {
    await mkdir(join(out, folder), { recursive: true });
    for (const entry of await readdir(join(source, folder), {
      withFileTypes: true,
    })) {
      if (
        entry.isFile() &&
        entry.name.endsWith(folder === "js" ? ".js" : ".css")
      )
        await copyFile(
          join(source, folder, entry.name),
          join(out, folder, entry.name),
        );
    }
  }
  const html = await readFile(join(source, "index.html"), "utf8");
  const marker = '<script type="module" src="js/app.js"></script>';
  if (!html.includes(marker))
    throw new Error("Frontend entrypoint changed; update exporter.");
  await writeFile(
    join(out, "index.html"),
    html.replace(
      marker,
      '<script src="runtime-config.js"></script>\n    ' + marker,
    ),
  );
  await writeFile(
    join(out, "runtime-config.js"),
    "window.SQUEEK_DROP_CONFIG = " +
      JSON.stringify({ apiBase: url.origin }) +
      ";\n",
  );
  return { out, apiBase: url.origin };
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  if (process.argv.includes("--help"))
    console.log(
      "SITE_API_BASE=https://api.example.com npm run build:site\nOptional: --out <empty-directory>. Generates static files only; never uploads or pays.",
    );
  else {
    const index = process.argv.indexOf("--out");
    const result = await exportSite({
      apiBase: process.env.SITE_API_BASE,
      out: index >= 0 ? resolve(process.argv[index + 1]) : undefined,
    });
    console.log("Static release:", result.out, "API:", result.apiBase);
  }
}
