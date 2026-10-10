import http from "node:http";
import crypto from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config, route } from "./config.js";
import { WorkspaceFs } from "./filesystem.js";
import { CodexClient } from "./codex/client.js";
import { AttachmentStore } from "./attachments.js";
import { EventHub } from "./event-hub.js";
import { CodexController } from "./controller.js";
import { acceptedEncodings, actionRequestError, fileHeaders } from "./http-policy.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
let workspaceFs = new WorkspaceFs(config.workspace, config.workspaceBase, config.workspaceExplicit);
try {
  await workspaceFs.init();
} catch (error) {
  if (!config.workspaceExplicit) throw error;
  console.warn(`Ignoring invalid CODEX_WEB_DEFAULT_WORKSPACE (${config.workspace}):`, error);
  workspaceFs = new WorkspaceFs(process.cwd(), config.workspaceBase);
  await workspaceFs.init();
}
const attachmentStore = new AttachmentStore();
await attachmentStore.init();
const codex = new CodexClient(workspaceFs.path);
const events = new EventHub();
const meta = () => ({ workspace: workspaceFs.path, workspaceBase: workspaceFs.basePath, workspaceSelected: workspaceFs.isSelected, basePath: config.basePath, codexVersion: codex.userAgent });
const controller = new CodexController(codex, workspaceFs, attachmentStore, events, meta);
const vite = config.dev ? await (await import("vite")).createServer({ root, server: { middlewareMode: true }, appType: "spa" }) : null;
const mime: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".bmp": "image/bmp", ".avif": "image/avif", ".ico": "image/x-icon", ".json": "application/json" };
const generatedImagesRoot = path.resolve(process.env.CODEX_HOME || path.join(os.homedir(), ".codex"), "generated_images");
const generatedImage = async (requested: string) => {
  if (!path.isAbsolute(requested)) throw new Error("Expected an absolute image path");
  const [rootPath, targetPath] = await Promise.all([fs.realpath(generatedImagesRoot), fs.realpath(requested)]);
  const relative = path.relative(rootPath, targetPath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Image is outside the generated images directory");
  const stat = await fs.stat(targetPath);
  if (!stat.isFile()) throw new Error("Not a file");
  return { path: targetPath, size: stat.size, name: path.basename(targetPath), mime: mime[path.extname(targetPath).toLowerCase()] || "application/octet-stream" };
};
const expectedAuthorization = config.auth ? `Basic ${Buffer.from(`${config.auth.username}:${config.auth.password}`, "utf8").toString("base64")}` : null;
const authorized = (req: http.IncomingMessage) => {
  if (!expectedAuthorization) return true;
  const received = Buffer.from(req.headers.authorization || "", "utf8"); const expected = Buffer.from(expectedAuthorization, "utf8");
  return received.length === expected.length && crypto.timingSafeEqual(received, expected);
};
const requireAuthorization = (res: http.ServerResponse) => {
  res.writeHead(401, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "WWW-Authenticate": 'Basic realm="Codex Web", charset="UTF-8"' });
  res.end("Authentication required");
};
const sendJson = (res: http.ServerResponse, status: number, body: any) => { const data = Buffer.from(JSON.stringify(body)); res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": data.length, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }); res.end(data); };
const readJson = async (req: http.IncomingMessage) => { const chunks: Buffer[] = []; let size = 0; for await (const chunk of req) { const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); size += data.length; if (size > 16 * 1024 * 1024) throw new Error("Request body exceeds 16 MB"); chunks.push(data); } return JSON.parse(Buffer.concat(chunks).toString("utf8")); };

let largeActions = 0;
let actionCount = 0;
const server = http.createServer(async (req, res) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  if (!authorized(req)) return requireAuthorization(res);
  let url: URL;
  try { url = new URL(req.url || "/", "http://localhost"); } catch { res.writeHead(400); return res.end("Invalid URL"); }
  const prefix = config.basePath === "/" ? "" : config.basePath;
  if (prefix && url.pathname === prefix) { res.writeHead(308, { Location: `${prefix}/${url.search}` }); return res.end(); }
  if (prefix && !url.pathname.startsWith(`${prefix}/`)) { res.writeHead(404); return res.end("Not found"); }
  const localPath = url.pathname.slice(prefix.length) || "/";
  if (localPath === "/api/bootstrap" && req.method === "GET") { try { return sendJson(res, 200, await controller.bootstrap()); } catch (error) { return sendJson(res, 503, { ready: false, stage: "error", runtime: controller.runtime(), error: error instanceof Error ? error.message : String(error), meta: { ...meta(), codexStatus: codex.status } }); } }
  if (localPath === "/api/events" && req.method === "GET") return sendJson(res, 200, events.read(Number(url.searchParams.get("cursor") || 0), url.searchParams.get("instance") || undefined));
  if (localPath === "/api/runtime" && req.method === "GET") return sendJson(res, 200, controller.runtime());
  if (localPath === "/api/actions" && req.method === "POST") {
    const invalid = actionRequestError(req); if (invalid) return sendJson(res, invalid.status, { error: invalid.error });
    const length = Number(req.headers["content-length"]);
    if (length > 16 * 1024 * 1024) return sendJson(res, 413, { error: "Request body exceeds 16 MB" });
    const large = !Number.isFinite(length) || length > 512 * 1024;
    if (actionCount >= 16 || (large && largeActions >= 1)) { res.setHeader("Retry-After", "2"); return sendJson(res, 429, { error: "Server is busy handling uploads; retry shortly" }); }
    actionCount++; if (large) largeActions++;
    try { return sendJson(res, 200, { messages: await controller.handle(await readJson(req)) }); }
    catch (error) { return sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) }); }
    finally { actionCount--; if (large) largeActions--; }
  }
  const attachmentMatch = localPath.match(/^\/attachments\/([^/]+)\/([^/]+)\/([^/]+)$/);
  if (attachmentMatch) {
    let parts: string[];
    try { parts = attachmentMatch.slice(1).map((part) => decodeURIComponent(part)); } catch { res.writeHead(404); return res.end("Not found"); }
    let download;
    try { download = await attachmentStore.resolveDownload(parts[0], parts[1], parts[2]); } catch { download = null; }
    if (!download) { res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" }); return res.end("Not found"); }
    res.writeHead(200, fileHeaders(download, url.searchParams.get("inline") === "1"));
    createReadStream(download.path).on("error", () => { if (!res.headersSent) res.writeHead(404); res.end(); }).pipe(res);
    return;
  }
  if ((localPath === "/api/files/raw" || localPath === "/api/files/download") && req.method === "GET") {
    const relative = url.searchParams.get("path") || "";
    try {
      const scope = await controller.workspaceFor({ threadId: url.searchParams.get("threadId") || undefined, workspace: url.searchParams.get("workspace") || undefined });
      const download = await scope.download(relative);
      res.writeHead(200, fileHeaders(download, localPath.endsWith("/raw")));
      createReadStream(download.path).on("error", () => res.end()).pipe(res);
    } catch { res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" }); res.end("Not found"); }
    return;
  }
  if (localPath === "/api/generated-images/raw" && req.method === "GET") {
    try {
      const image = await generatedImage(url.searchParams.get("path") || "");
      res.writeHead(200, fileHeaders(image, true));
      createReadStream(image.path).on("error", () => res.end()).pipe(res);
    } catch { res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" }); res.end("Not found"); }
    return;
  }
  if (vite) {
    req.url = `${localPath}${url.search}`;
    return vite.middlewares(req, res, () => { res.writeHead(404); res.end(); });
  }
  try {
    const relative = localPath === "/" ? "index.html" : localPath.replace(/^\//, "");
    const target = path.resolve(root, "dist", relative);
    if (!target.startsWith(path.resolve(root, "dist") + path.sep)) throw new Error("Invalid asset path");
    let asset = target; let encoding = "";
    for (const candidate of acceptedEncodings(req.headers["accept-encoding"])) {
      const compressed = `${target}.${candidate === "gzip" ? "gz" : "br"}`;
      try { if ((await fs.stat(compressed)).isFile()) { asset = compressed; encoding = candidate; break; } } catch { /* Older builds may not have compressed assets. */ }
    }
    const stat = await fs.stat(asset); if (!stat.isFile()) throw new Error("Not a file");
    res.setHeader("Vary", "Accept-Encoding"); if (encoding) res.setHeader("Content-Encoding", encoding);
    res.writeHead(200, { "Content-Type": mime[path.extname(target)] || "application/octet-stream", "Cache-Control": relative === "index.html" ? "no-cache" : "public, max-age=31536000, immutable", "Content-Length": stat.size });
    const stream = createReadStream(asset); res.on("close", () => stream.destroy()); stream.on("error", () => res.destroy()).pipe(res);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
    res.end("Not found");
  }
});
server.listen(config.port, config.host, async () => {
  console.log(`Codex Web: http://${config.host}:${config.port}${route()}`);
  console.log(`Workspace: ${workspaceFs.path}`);
  console.log(`HTTP Basic Auth: ${config.auth ? "enabled" : "disabled"}`);
  try { await controller.start(); } catch (error) { console.error("Codex app-server failed:", error); }
});
server.requestTimeout = 120_000;
server.headersTimeout = 15_000;
let shuttingDown = false;
const shutdown = async () => { if (shuttingDown) return; shuttingDown = true; server.close(); await controller.handle({ type: "runtime.stop" }); await vite?.close(); };
process.on("SIGTERM", () => { void shutdown(); });
process.on("SIGINT", () => { void shutdown(); });
