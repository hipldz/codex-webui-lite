import { defaultUrlTransform } from "react-markdown";

export const normalizeFilePath = (value: string) => { try { return decodeURIComponent(value).replace(/^file:\/\//, "").replaceAll("\\", "/").split(/[?#]/, 1)[0].replace(/:\d+(?::\d+)?$/, ""); } catch { return value.replaceAll("\\", "/").split(/[?#]/, 1)[0].replace(/:\d+(?::\d+)?$/, ""); } };

export function workspaceFile(href: string, workspace: string) {
  if (!href || href.startsWith("#") || /^(https?|mailto|tel):/i.test(href)) return null;
  let candidate = normalizeFilePath(href); const root = workspace.replaceAll("\\", "/").replace(/\/$/, "");
  const absolute = candidate.startsWith("/") || /^[a-z]:\//i.test(candidate);
  if (absolute) {
    const compareCandidate = /^[a-z]:/i.test(candidate) ? candidate.toLowerCase() : candidate; const compareRoot = /^[a-z]:/i.test(root) ? root.toLowerCase() : root;
    if (!compareRoot || !compareCandidate.startsWith(`${compareRoot}/`)) return { unavailable: true as const, path: "" };
    candidate = candidate.slice(root.length + 1);
  } else {
    candidate = candidate.replace(/^\.\//, ""); const rootName = root.split("/").pop();
    if (rootName && candidate.startsWith(`${rootName}/`)) candidate = candidate.slice(rootName.length + 1);
  }
  const parts = candidate.split("/").filter((part) => part && part !== ".");
  if (!parts.length || parts.some((part) => part === "..")) return { unavailable: true as const, path: "" };
  return { unavailable: false as const, path: parts.join("/") };
}

// react-markdown treats a Windows drive letter as a URL scheme. Preserve only
// drive-absolute link targets; all other URLs keep its normal safety filter.
export const markdownUrlTransform = (url: string, key: string) => key === "href" && /^[A-Za-z]:[\\/]/.test(url) ? url : defaultUrlTransform(url);

export const workspaceLinkUrl = (relativePath: string, prefix: string) => `${prefix}/?file=${encodeURIComponent(relativePath)}`;
