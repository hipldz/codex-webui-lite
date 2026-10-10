import { Archive, ArchiveRestore, Check, ChevronsUpDown, FolderKanban, ListChecks, LoaderCircle, MoreHorizontal, PanelLeftClose, Plus, Search, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { Thread } from "../types";
import { threadIsRunning } from "../thread-status";
import { CodexLogo } from "./CodexLogo";

function when(time: number) {
  const days = Math.floor((Date.now() / 1000 - time) / 86400);
  return days <= 0 ? "Today" : days === 1 ? "Yesterday" : new Date(time * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

type Props = {
  threads: Thread[];
  archivedThreads: Thread[];
  active?: string;
  select: (id: string) => void;
  create: () => void;
  archive: (id: string) => void;
  unarchive: (id: string) => void;
  remove: (id: string) => void;
  chooseWorkspace: () => void;
  onCollapse?: () => void;
  onDismiss?: () => void;
  workspace?: string;
  moreRecent?: boolean;
  moreArchived?: boolean;
  loadMore?: (view: "recent" | "archived") => void;
};

export function Sidebar({ threads, archivedThreads, active, select, create, archive, unarchive, remove, chooseWorkspace, onCollapse, onDismiss, workspace, moreRecent, moreArchived, loadMore }: Props) {
  const workspaceName = workspace?.split("/").filter(Boolean).pop() || "Choose workspace";
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"recent" | "archived">("recent");
  const [menu, setMenu] = useState<string>();
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const source = view === "recent" ? threads : archivedThreads;
  const visibleThreads = source.filter((thread) => (thread.name || thread.preview || "New thread").toLowerCase().includes(query.toLowerCase()));
  useEffect(() => { setSelected(new Set()); setSelecting(false); setMenu(undefined); }, [view]);
  useEffect(() => { if (view === "archived" && !archivedThreads.length) loadMore?.("archived"); }, [view, archivedThreads.length]);
  const toggle = (id: string) => setSelected((old) => { const next = new Set(old); next.has(id) ? next.delete(id) : next.add(id); return next; });
  const finishSelection = () => { setSelected(new Set()); setSelecting(false); };
  const batchMove = () => { selected.forEach((id) => view === "recent" ? archive(id) : unarchive(id)); finishSelection(); };
  const batchDelete = () => { if (selected.size && window.confirm(`Delete ${selected.size} selected ${selected.size === 1 ? "thread" : "threads"} permanently?`)) selected.forEach(remove); finishSelection(); };
  const deleteThread = (id: string) => { if (window.confirm("Delete this thread permanently?")) remove(id); setMenu(undefined); };

  return <aside className="sidebar">
    <div className="sidebar-brand"><div><span className="brand-icon"><CodexLogo /></span><b>Codex</b></div><button className="sidebar-collapse" aria-label={onDismiss ? "Close threads" : "Collapse threads"} onClick={onDismiss || onCollapse}><PanelLeftClose /></button></div>
    <button className="workspace-switcher" onClick={chooseWorkspace}><FolderKanban /><span><small>Workspace</small><b>{workspaceName}</b></span><ChevronsUpDown /></button>
    <button className="new-thread" onClick={create}><Plus /><span>New thread</span><kbd>⌘ N</kbd></button>
    <label className="search-threads"><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search threads" /></label>
    <div className="thread-tab-row"><div className="thread-tabs"><button className={view === "recent" ? "active" : ""} onClick={() => setView("recent")}>Recent <small>{threads.length}</small></button><button className={view === "archived" ? "active" : ""} onClick={() => setView("archived")}>Archived <small>{archivedThreads.length}</small></button></div><button className={`select-threads ${selecting ? "active" : ""}`} aria-label={selecting ? "Cancel selection" : "Select threads"} onClick={() => { setSelecting(!selecting); setSelected(new Set()); }}><ListChecks /></button></div>
    {selecting && <div className="bulk-actions"><button className="bulk-select-all" onClick={() => setSelected(selected.size === visibleThreads.length ? new Set() : new Set(visibleThreads.map((thread) => thread.id)))}><span className={`thread-check ${selected.size === visibleThreads.length && visibleThreads.length ? "checked" : ""}`}>{selected.size === visibleThreads.length && visibleThreads.length ? <Check /> : null}</span>{selected.size} selected</button><button aria-label={view === "recent" ? "Archive selected" : "Restore selected"} disabled={!selected.size} onClick={batchMove}>{view === "recent" ? <Archive /> : <ArchiveRestore />}</button><button className="danger" aria-label="Delete selected" disabled={!selected.size} onClick={batchDelete}><Trash2 /></button><button aria-label="Cancel selection" onClick={finishSelection}><X /></button></div>}
    <div className="thread-list">{visibleThreads.length ? <>{visibleThreads.map((thread) => <div className={`thread ${active === thread.id ? "active" : ""} ${selecting ? "selecting" : ""}`} key={thread.id}>
      <button className="thread-main" onClick={() => { if (selecting) toggle(thread.id); else { select(thread.id); onDismiss?.(); } }}>{selecting && <span className={`thread-check ${selected.has(thread.id) ? "checked" : ""}`}>{selected.has(thread.id) && <Check />}</span>}<span><span className="thread-title"><b>{thread.name || thread.preview || "New thread"}</b>{threadIsRunning(thread) && <span className="thread-running" aria-label="Running" title="Codex is working"><LoaderCircle />Running</span>}</span><small>{thread.cwd ? `${thread.cwd.split("/").filter(Boolean).pop()} · ` : ""}{when(thread.updatedAt)}</small></span></button>
      {!selecting && <button className="thread-more" aria-label="Thread actions" onClick={() => setMenu(menu === thread.id ? undefined : thread.id)}><MoreHorizontal /></button>}
      {menu === thread.id && <div className="thread-menu">{view === "recent" ? <button onClick={() => { archive(thread.id); setMenu(undefined); }}><Archive />Archive</button> : <button onClick={() => { unarchive(thread.id); setMenu(undefined); }}><ArchiveRestore />Restore</button>}<button className="danger" onClick={() => deleteThread(thread.id)}><Trash2 />Delete</button></div>}
    </div>)}{(view === "recent" ? moreRecent : moreArchived) && !query && <button className="load-more-threads" onClick={() => loadMore?.(view)}>Load more</button>}</> : <div className="thread-empty">{query ? "No matching threads" : view === "archived" ? "No archived threads" : "No recent threads"}</div>}</div>
  </aside>;
}
