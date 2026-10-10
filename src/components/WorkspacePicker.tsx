import { ArrowLeft, Check, Folder, FolderOpen, Home, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { FileEntry } from "../types";

export function WorkspacePicker({ close, load, select, current, base }: { close: () => void; load: (path: string) => Promise<FileEntry[]>; select: (path: string) => void; current: string; base: string }) {
  const [path, setPath] = useState("");
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => { let live = true; setLoading(true); setError(""); load(path).then((items) => { if (live) setEntries(items); }).catch((error) => { if (live) { setError(String(error)); setEntries([]); } }).finally(() => { if (live) setLoading(false); }); return () => { live = false; }; }, [path, load]);
  const crumbs = useMemo(() => path.split("/").filter(Boolean), [path]);
  const absolute = path ? `${base.replace(/\/$/, "")}/${path}` : base;
  return <div className="modal-layer" onMouseDown={(event) => event.target === event.currentTarget && close()}><section className="workspace-picker">
    <header><div><span>Open folder</span><b>Choose workspace</b></div><button className="icon-button" aria-label="Close workspace picker" onClick={close}><X /></button></header>
    <div className="workspace-breadcrumb"><button aria-label="Workspace root" onClick={() => setPath("")}><Home /></button>{crumbs.map((crumb, index) => <button key={`${crumb}-${index}`} onClick={() => setPath(crumbs.slice(0, index + 1).join("/"))}>{crumb}</button>)}</div>
    <div className="workspace-current"><FolderOpen /><span><small>Selected folder</small><b>{absolute}</b></span>{absolute === current && <em><Check /> Current</em>}</div>
    <div className="workspace-folders">{path && <button onClick={() => setPath(crumbs.slice(0, -1).join("/"))}><ArrowLeft /><span><b>Parent folder</b><small>Go up one level</small></span></button>}{loading ? <p>Loading folders…</p> : entries.map((entry) => <button key={entry.path} onClick={() => setPath(entry.path)}><Folder /><span><b>{entry.name}</b><small>{entry.path}</small></span></button>)}{error && <p role="alert">{error}</p>}{!loading && !error && !entries.length && <p>This folder has no subfolders.</p>}</div>
    <footer><span>Sessions are scoped to the selected workspace.</span><button onClick={() => select(path)}>Use this folder</button></footer>
  </section></div>;
}
