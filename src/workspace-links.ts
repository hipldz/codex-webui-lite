import { defaultUrlTransform } from "react-markdown";
import type { FileScope } from "./types";

export const normalizeFilePath = (value: string) => {
  let path = value.split(/[?#]/, 1)[0];
  if (/^file:/i.test(value)) {
    try {
      const url = new URL(value);
      path = `${url.hostname && url.hostname.toLowerCase() !== "localhost" ? `//${url.hostname}` : ""}${url.pathname}`;
    } catch {
      path = path.replace(/^file:\/\//i, "");
    }
  }
  try {
    path = decodeURIComponent(path);
  } catch {
    /* Keep literal percent signs in local filenames. */
  }
  return path
    .replaceAll("\\", "/")
    .replace(/^\/([a-z]:\/)/i, "$1")
    .replace(/:\d+(?::\d+)?$/, "");
};

const absoluteFilePath = (value: string) => value.startsWith("/") || /^[a-z]:\//i.test(value);

export function workspaceFile(href: string, workspace: string) {
  if (!href || href.startsWith("#") || href.startsWith("//") || /^(https?|mailto|tel):/i.test(href))
    return null;
  let candidate = normalizeFilePath(href);
  const normalizedRoot = workspace.replaceAll("\\", "/");
  const root = normalizedRoot === "/" ? "/" : normalizedRoot.replace(/\/$/, "");
  const absolute = candidate.startsWith("/") || /^[a-z]:\//i.test(candidate);
  if (absolute) {
    const compareCandidate = /^[a-z]:/i.test(candidate) ? candidate.toLowerCase() : candidate;
    const compareRoot = /^[a-z]:/i.test(root) ? root.toLowerCase() : root;
    if (
      !compareRoot ||
      !(compareRoot === "/"
        ? compareCandidate.startsWith("/")
        : compareCandidate.startsWith(`${compareRoot}/`))
    )
      return { unavailable: true as const, path: "" };
    candidate = candidate.slice(root === "/" ? 1 : root.length + 1);
  } else {
    candidate = candidate.replace(/^\.\//, "");
    const rootName = root.split("/").pop();
    if (rootName && candidate.startsWith(`${rootName}/`))
      candidate = candidate.slice(rootName.length + 1);
  }
  const parts = candidate.split("/").filter((part) => part && part !== ".");
  if (!parts.length || parts.some((part) => part === ".."))
    return { unavailable: true as const, path: "" };
  return { unavailable: false as const, path: parts.join("/") };
}

// Local paths are sent through the file API rather than opened by the browser.
export const markdownUrlTransform = (url: string, key: string) =>
  ["href", "src"].includes(key) &&
  (/^[A-Za-z]:[\\/]/.test(url) || (/^file:/i.test(url) && absoluteFilePath(normalizeFilePath(url))))
    ? url
    : defaultUrlTransform(url);

export function conversationFile(
  href: string,
  workspace: string,
  sessionDirectory: string,
  inheritedDirectories: string[] = [],
) {
  const normalized = normalizeFilePath(href);
  if (normalized.startsWith("/") || /^[a-z]:\//i.test(normalized)) {
    for (const directory of [sessionDirectory, ...inheritedDirectories].filter(Boolean)) {
      const session = workspaceFile(href, directory);
      if (session && !session.unavailable)
        return {
          ...session,
          scope: "thread" as const,
          ownerThreadId: directory.replaceAll("\\", "/").split("/").pop()!,
        };
    }
  }
  const project = workspaceFile(href, workspace);
  if (project?.unavailable) {
    const root = workspace.replaceAll("\\", "/");
    const local = absoluteFilePath(normalized)
      ? normalized
      : normalized.split("/").includes("..") && absoluteFilePath(root)
        ? `${root.replace(/\/$/, "")}/${normalized}`
        : "";
    if (local)
      return {
        unavailable: false as const,
        path: local,
        scope: "local" as const,
        ownerThreadId: undefined,
      };
  }
  return project ? { ...project, scope: "workspace" as const, ownerThreadId: undefined } : null;
}

export const workspaceLinkUrl = (
  relativePath: string,
  prefix: string,
  scope: FileScope = "workspace",
  threadId = "",
) =>
  `${prefix}/?${new URLSearchParams({ file: relativePath, scope, ...(threadId ? { session: threadId } : {}) })}`;
