import os from "node:os";

const defaultWorkspace = process.env.CODEX_WEB_DEFAULT_WORKSPACE;

function flag(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

export function normalizeBasePath(value = "/") {
  const clean = `/${value}`.replace(/\/+/g, "/").replace(/\/$/, "");
  return clean === "" ? "/" : clean;
}

function basicAuth(value = process.env.CODEX_WEB_AUTH) {
  if (!value) return null;
  const separator = value.indexOf(":");
  if (separator < 1 || separator === value.length - 1) throw new Error("CODEX_WEB_AUTH must use the format username:password");
  return { username: value.slice(0, separator), password: value.slice(separator + 1) };
}

export const config = {
  host: process.env.CODEX_WEB_HOST || "127.0.0.1",
  port: Number(process.env.CODEX_WEB_PORT || flag("--port") || 8765),
  basePath: normalizeBasePath(process.env.CODEX_WEB_BASE_PATH || flag("--base-path") || "/"),
  workspace: defaultWorkspace?.trim() ? defaultWorkspace : process.cwd(),
  workspaceBase: os.homedir(),
  workspaceExplicit: Boolean(defaultWorkspace?.trim()),
  auth: basicAuth(),
  dev: process.argv.includes("--dev"),
};

export const route = (suffix = "") =>
  `${config.basePath === "/" ? "" : config.basePath}${suffix || "/"}`;
