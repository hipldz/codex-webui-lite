import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const project = fileURLToPath(new URL("../", import.meta.url));
const source = path.join(project, "dist");
const destination = path.join(project, "dist-mock");

// Export an existing frontend bundle without rebuilding or touching the real UI.
let html;
try {
  html = await readFile(path.join(source, "index.html"), "utf8");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  throw new Error(
    "Missing dist/index.html. Build the frontend first, then run npm run mock:export.",
  );
}
if (!html.includes("<head>") || !html.includes('<div id="root"></div>'))
  throw new Error("Unrecognized dist/index.html; refusing to export an incomplete mock.");

await mkdir(destination, { recursive: true });
// This directory contains generated output only. Remove stale bundles on re-export.
for (const entry of await readdir(destination))
  await rm(path.join(destination, entry), { recursive: true, force: true });
await cp(source, destination, { recursive: true });
await cp(
  path.join(project, "scripts/mock-bootstrap.js"),
  path.join(destination, "mock-bootstrap.js"),
);

html = html
  .replace("<head>", '<head>\n    <script src="./mock-bootstrap.js"></script>')
  .replace("<title>Codex Web</title>", "<title>Codex Web · Static mock</title>")
  .replace(
    "</head>",
    `    <style>
      .mock-bar { height: 36px; display: flex; align-items: center; justify-content: center; gap: 14px; padding: 0 10px; background: #edf4ee; color: #345840; font: 12px system-ui, sans-serif; }
      .mock-bar a { color: inherit; text-underline-offset: 3px; }
      #root { height: calc(100% - 36px); }
      .app-shell { height: 100%; }
      @media (max-width: 480px) { .mock-bar { gap: 9px; font-size: 11px; } }
    </style>
  </head>`,
  )
  .replace(
    '<div id="root"></div>',
    `<nav class="mock-bar" aria-label="Mock scenarios">
      <strong>Static mock · 无后端</strong>
      <a href="?demo=chat">聊天</a>
      <a href="?demo=questions">提问</a>
      <a href="?demo=plan">计划</a>
    </nav>
    <div id="root"></div>`,
  );
await writeFile(path.join(destination, "index.html"), html);
// The original compressed HTML lacks the bootstrap and must never be served.
await Promise.all(
  ["gz", "br"].map((extension) =>
    rm(path.join(destination, `index.html.${extension}`), { force: true }),
  ),
);
console.log(`Static mock exported to ${destination}`);
console.log("Serve this directory with Nginx. No Node server or Codex process is needed.");
