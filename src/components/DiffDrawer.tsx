import { FileCode2, FileDiff, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

const stats = (diff: string) => diff.split("\n").reduce((value, line) => ({ additions: value.additions + (line.startsWith("+") && !line.startsWith("+++") ? 1 : 0), deletions: value.deletions + (line.startsWith("-") && !line.startsWith("---") ? 1 : 0) }), { additions: 0, deletions: 0 });
type DiffFile = { path: string; diff: string; additions: number; deletions: number };

function splitDiff(diff: string): DiffFile[] {
  const files: Array<{ path: string; lines: string[] }> = []; let current: { path: string; lines: string[] } | null = null;
  const finish = () => { if (current?.lines.length) files.push(current); current = null; };
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) { finish(); const match = line.match(/ b\/(.+)$/); current = { path: match?.[1] || "Changed file", lines: [line] }; continue; }
    if (line.startsWith("--- ") && current?.lines.some((item) => item.startsWith("+++ "))) finish();
    if (!current) current = { path: "Changed file", lines: [] };
    if (line.startsWith("+++ ")) current.path = line.replace(/^\+\+\+\s+(?:b\/)?/, "") || current.path;
    current.lines.push(line);
  }
  finish();
  const grouped = new Map<string, string[]>();
  files.forEach((file, index) => { const name = file.path === "/dev/null" ? `Deleted file ${index + 1}` : file.path; grouped.set(name, [...(grouped.get(name) || []), ...file.lines]); });
  return Array.from(grouped, ([path, lines]) => { const content = lines.join("\n"); const value = stats(content); return { path, diff: content, additions: value.additions, deletions: value.deletions }; });
}

export function DiffDrawer({ diff, close }: { diff: string; close: () => void }) {
  const files = useMemo(() => splitDiff(diff), [diff]); const total = stats(diff);
  const [selected, setSelected] = useState(files[0]?.path || "");
  useEffect(() => { if (!files.some((file) => file.path === selected)) setSelected(files[0]?.path || ""); }, [files, selected]);
  const file = files.find((item) => item.path === selected) || files[0];
  return <div className="drawer-layer" onMouseDown={(event) => event.target === event.currentTarget && close()}><section className="diff-drawer">
    <header><div><span>Working tree</span><b>Changes · {files.length} {files.length === 1 ? "file" : "files"}</b></div><div className="diff-count"><strong>+{total.additions}</strong><em>-{total.deletions}</em></div><button className="icon-button" aria-label="Close changes" onClick={close}><X /></button></header>
    <div className="diff-drawer-body">{files.length ? <><aside className="changed-files">{files.map((item) => <button className={item.path === file?.path ? "active" : ""} key={item.path} onClick={() => setSelected(item.path)}><FileCode2 /><span><b>{item.path.split("/").pop()}</b><small>{item.path}</small></span><em><i>+{item.additions}</i> −{item.deletions}</em></button>)}</aside><section className="file-diff-view"><div className="file-diff-head"><FileDiff /><span>{file.path}</span><div><b>+{file.additions}</b><i>−{file.deletions}</i></div></div><pre>{file.diff.split("\n").map((line, index) => <span key={index} className={line.startsWith("+") && !line.startsWith("+++") ? "added" : line.startsWith("-") && !line.startsWith("---") ? "removed" : line.startsWith("@@") ? "hunk" : ""}>{line || " "}</span>)}</pre></section></> : <div className="preview-empty"><FileDiff /><b>No changes yet</b><p>Edits from the current thread appear here.</p></div>}</div>
  </section></div>;
}
