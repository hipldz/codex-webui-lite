import { defaultUrlTransform } from "react-markdown";
import type { FileScope } from "./types";

export const normalizeFilePath = (value: string) => {
  const path = value.replace(/^file:\/\//, "").split(/[?#]/, 1)[0];
  try {
    return decodeURIComponent(path)
      .replaceAll("\\", "/")
      .replace(/:\d+(?::\d+)?$/, "");
  } catch {
    return path.replaceAll("\\", "/").replace(/:\d+(?::\d+)?$/, "");
  }
};

export function workspaceFile(href: string, workspace: string) {
  if (!href || href.startsWith("#") || /^(https?|mailto|tel):/i.test(href)) return null;
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

// react-markdown treats a Windows drive letter as a URL scheme. Preserve only
// drive-absolute link targets; all other URLs keep its normal safety filter.
export const markdownUrlTransform = (url: string, key: string) =>
  key === "href" && /^[A-Za-z]:[\\/]/.test(url) ? url : defaultUrlTransform(url);

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
  return project ? { ...project, scope: "workspace" as const, ownerThreadId: undefined } : null;
}

export const workspaceLinkUrl = (
  relativePath: string,
  prefix: string,
  scope: FileScope = "workspace",
  threadId = "",
) =>
  `${prefix}/?${new URLSearchParams({ file: relativePath, scope, ...(threadId ? { session: threadId } : {}) })}`;
