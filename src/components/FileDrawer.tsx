import { ArrowLeft, Check, ChevronDown, ChevronRight, Download, FileCode2, FilePlus2, Folder, FolderOpen, PanelRight, Pencil, Save, Search, Trash2, Upload, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { FileEntry } from "../types";

const MAX_UPLOAD_SIZE = 10 * 1024 * 1024;
const MAX_BATCH_SIZE = 25 * 1024 * 1024;
type WorkspaceFile = { path: string; content?: string; revision?: string; size: number; previewable: boolean; kind?: "text" | "image" | "binary"; mime?: string; reason?: string };
const fileSize = (value: number) => value >= 1024 * 1024 ? `${(value / 1024 / 1024).toFixed(1)} MB` : value >= 1024 ? `${(value / 1024).toFixed(1)} KB` : `${value} bytes`;
const asBase64 = (file: File) => new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(",", 2)[1] || ""); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file); });

function Tree({ path, load, openFile, selectDirectory, selectedPath, busy, refresh }: { path: string; load: (path: string) => Promise<FileEntry[]>; openFile: (path: string) => void; selectDirectory: (path: string) => void; selectedPath: string; busy: boolean; refresh: number }) {
  const [entries, setEntries] = useState<FileEntry[]>([]); const [open, setOpen] = useState(path === "");
  useEffect(() => { if (path && selectedPath.startsWith(`${path}/`)) setOpen(true); }, [path, selectedPath]);
  useEffect(() => { let live = true; if (open) load(path).then((value) => live && setEntries(value)).catch(() => live && setEntries([])); return () => { live = false; }; }, [open, path, load, refresh]);
  const toggle = () => { selectDirectory(path); setOpen((value) => !value); };
  if (path && !open) return <button className="tree-row folder" disabled={busy} onClick={toggle}><ChevronRight /><Folder /> <span>{path.split("/").pop()}</span></button>;
  return <div className={path ? "tree-branch" : ""}>{path && <button className="tree-row folder" disabled={busy} onClick={toggle}><ChevronDown /><FolderOpen /> <span>{path.split("/").pop()}</span></button>}{entries.map((entry) => entry.type === "directory" ? <Tree key={entry.path} path={entry.path} load={load} openFile={openFile} selectDirectory={selectDirectory} selectedPath={selectedPath} busy={busy} refresh={refresh} /> : <button className={`tree-row file${entry.path === selectedPath ? " selected" : ""}`} key={entry.path} disabled={busy} aria-current={entry.path === selectedPath ? "true" : undefined} title={entry.path} onClick={() => openFile(entry.path)}><span className="tree-indent" /><FileCode2 /> <span>{entry.name}</span></button>)}</div>;
}

export function FileDrawer({ close, load, search, read, write, upload, create, remove, basePath = "/", workspace = "", threadId, initialPath = "", onSaved }: { close: () => void; load: (path: string) => Promise<FileEntry[]>; read: (path: string) => Promise<WorkspaceFile>; write: (path: string, content: string, revision?: string) => Promise<WorkspaceFile>; upload: (directory: string, name: string, data: string) => Promise<{ path: string; size: number }>; create: (directory: string, name: string) => Promise<WorkspaceFile>; remove: (path: string) => Promise<{ path: string }>; basePath?: string; workspace?: string; threadId?: string; search: (query: string) => Promise<{ entries: FileEntry[]; truncated: boolean }>; initialPath?: string; onSaved?: (path: string, before: string, after: string) => void }) {
  const [file, setFile] = useState<WorkspaceFile | null>(null); const [fileError, setFileError] = useState(""); const [query, setQuery] = useState(""); const [directory, setDirectory] = useState(""); const [refresh, setRefresh] = useState(0);
  const [selectedPath, setSelectedPath] = useState(""); const [loadingPath, setLoadingPath] = useState(""); const openingRef = useRef(false); const openRequestRef = useRef(0); const initialOpenedRef = useRef("");
  const [editing, setEditing] = useState(false); const [draft, setDraft] = useState(""); const [saving, setSaving] = useState(false); const [saved, setSaved] = useState(false);
  const [uploading, setUploading] = useState(false); const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null); const uploadInput = useRef<HTMLInputElement>(null);
  const [creating, setCreating] = useState(false); const [newName, setNewName] = useState(""); const [creatingFile, setCreatingFile] = useState(false);
  const [searchResult, setSearchResult] = useState<{ entries: FileEntry[]; truncated: boolean } | null>(null); const [searchError, setSearchError] = useState(""); const [searching, setSearching] = useState(false);
  const dirty = editing && draft !== file?.content;
  const dirtyRef = useRef(dirty); dirtyRef.current = dirty;
  const busyRef = useRef(false); busyRef.current = saving || uploading || creatingFile;
  const mayDiscard = useCallback(() => !busyRef.current && (!dirtyRef.current || window.confirm("Discard unsaved changes?")), []);
  const requestClose = () => { if (mayDiscard()) close(); };
  const fileScope = `&${new URLSearchParams(threadId ? { threadId } : { workspace })}`;
  useEffect(() => { const handler = (event: BeforeUnloadEvent) => { if (dirtyRef.current) { event.preventDefault(); event.returnValue = ""; } }; window.addEventListener("beforeunload", handler); return () => window.removeEventListener("beforeunload", handler); }, []);
  useEffect(() => { let live = true; if (!query.trim()) { setSearchResult(null); setSearching(false); return; } setSearching(true); setSearchError(""); const timer = window.setTimeout(() => { void search(query).then((result) => { if (live) setSearchResult(result); }).catch((error) => { if (live) setSearchError(String(error)); }).finally(() => { if (live) setSearching(false); }); }, 300); return () => { live = false; window.clearTimeout(timer); }; }, [query, search, refresh]);
  const [confirmDelete, setConfirmDelete] = useState(false); const [deleting, setDeleting] = useState(false);
  const openFile = useCallback(async (path: string, force = false) => {
    if (!mayDiscard() || (openingRef.current && !force)) return;
    const requestId = ++openRequestRef.current;
    openingRef.current = true; setSelectedPath(path); setLoadingPath(path); setFileError(""); setConfirmDelete(false);
    try {
      const next = await read(path);
      if (requestId !== openRequestRef.current) return;
      setFile(next); setDraft(next.content || ""); setEditing(false); setSaved(false);
    } catch (error) {
      if (requestId !== openRequestRef.current) return;
      setFile(null); setFileError(error instanceof Error ? error.message : String(error));
    } finally {
      if (requestId === openRequestRef.current) { openingRef.current = false; setLoadingPath(""); }
    }
  }, [read, mayDiscard]);
  useEffect(() => { if (!initialPath) { initialOpenedRef.current = ""; return; } if (initialPath !== initialOpenedRef.current) { initialOpenedRef.current = initialPath; void openFile(initialPath, true); } }, [initialPath, openFile]);
  const save = async () => { if (!file?.previewable) return; setSaving(true); setFileError(""); try { const before = file.content || ""; const next = await write(file.path, draft, file.revision); setFile(next); setEditing(false); setSaved(true); onSaved?.(file.path, before, next.content || ""); window.setTimeout(() => setSaved(false), 1400); } catch (error) { setFileError(error instanceof Error ? error.message : String(error)); } finally { setSaving(false); } };
  const uploadFiles = async (selected: FileList | null) => {
    if (!selected?.length) return; const files = Array.from(selected).slice(0, 10); if (uploadInput.current) uploadInput.current.value = "";
    if (files.reduce((sum, next) => sum + next.size, 0) > MAX_BATCH_SIZE) { setNotice({ text: "Upload batch exceeds 25 MB", error: true }); return; }
    setUploading(true); setNotice(null); let completed = 0; const errors: string[] = [];
    for (const next of files) {
      if (next.size > MAX_UPLOAD_SIZE) { errors.push(`${next.name}: exceeds 10 MB`); continue; }
      try { await upload(directory, next.name, await asBase64(next)); completed++; } catch (error) { errors.push(`${next.name}: ${error instanceof Error ? error.message : String(error)}`); }
    }
    setUploading(false); if (completed) setRefresh((value) => value + 1);
    setNotice({ text: errors.length ? `${completed} uploaded · ${errors.join("; ")}` : `${completed} ${completed === 1 ? "file" : "files"} uploaded`, error: errors.length > 0 });
    if (!errors.length) window.setTimeout(() => setNotice(null), 2200);
  };
  const createNewFile = async () => {
    const name = newName.trim(); if (!name || !mayDiscard()) return;
    setCreatingFile(true); setNotice(null); setFileError("");
    try { const next = await create(directory, name); setRefresh((value) => value + 1); setCreating(false); setNewName(""); setFile(next); setSelectedPath(next.path); setDraft(next.content || ""); setEditing(false); setConfirmDelete(false); setNotice({ text: `${next.path} created`, error: false }); window.setTimeout(() => setNotice(null), 2200); }
    catch (error) { setNotice({ text: error instanceof Error ? error.message : String(error), error: true }); }
    finally { setCreatingFile(false); }
  };
  const deleteCurrentFile = async () => {
    if (!file) return; const removedPath = file.path;
    setDeleting(true); setFileError("");
    try { await remove(removedPath); setFile(null); setSelectedPath(""); setEditing(false); setConfirmDelete(false); setRefresh((value) => value + 1); setNotice({ text: `${removedPath} deleted`, error: false }); window.setTimeout(() => setNotice(null), 2200); }
    catch (error) { setFileError(error instanceof Error ? error.message : String(error)); }
    finally { setDeleting(false); }
  };
  return <div className="drawer-layer" onMouseDown={(event) => event.target === event.currentTarget && requestClose()}><section className={`file-drawer ${file || fileError || loadingPath ? "previewing" : ""}`}>
    <header><button className="mobile-back icon-button" aria-label="Back" onClick={() => { if (!mayDiscard()) return; if (file || fileError) { setFile(null); setFileError(""); setSelectedPath(""); } else close(); }}><ArrowLeft /></button><div><span>Workspace</span><b>{file ? file.path.split("/").pop() : "Files"}</b></div><button className="icon-button" aria-label="Close files" onClick={requestClose}><X /></button></header>
    <div className="files-body" aria-busy={Boolean(loadingPath)}><div className="tree-pane"><div className="file-controls"><label className="search"><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search files" /></label></div><div className="file-location-bar"><button className="workspace-name" title={directory || "workspace"} onClick={() => setDirectory("")}><FolderOpen /><span>{directory ? `workspace / ${directory}` : "workspace"}</span></button><div className="file-tree-actions"><button aria-label="New file" onClick={() => setCreating((value) => !value)}><FilePlus2 /><span>New</span></button><input ref={uploadInput} className="attachment-input" type="file" multiple onChange={(event) => void uploadFiles(event.target.files)} /><button className="upload-button" disabled={uploading} aria-label={`Upload files to ${directory || "workspace"}`} onClick={() => uploadInput.current?.click()}><Upload /><span>{uploading ? "Uploading…" : "Upload"}</span></button></div></div>{creating && <form className="new-file-form" onSubmit={(event) => { event.preventDefault(); void createNewFile(); }}><FilePlus2 /><input autoFocus value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="filename.ext" /><button type="button" aria-label="Cancel new file" onClick={() => { setCreating(false); setNewName(""); }}><X /></button><button className="primary" type="submit" disabled={creatingFile || !newName.trim()}>{creatingFile ? "Creating…" : "Create"}</button></form>}{notice && <div className={`upload-notice ${notice.error ? "error" : ""}`}>{notice.text}</div>}{query.trim() ? <div className="file-search-results">{searching ? <p>Searching…</p> : searchError ? <p role="alert">{searchError}</p> : <>{searchResult?.entries.map((entry) => <button className="tree-row file" key={entry.path} title={entry.path} onClick={() => void openFile(entry.path)}><FileCode2 /><span>{entry.path}</span></button>)}{!searchResult?.entries.length && <p>No matching files</p>}{searchResult?.truncated && <p>Search limit reached. Use a more specific filename or browse the folder.</p>}</>}</div> : <Tree path="" load={load} openFile={openFile} selectDirectory={setDirectory} selectedPath={selectedPath} busy={Boolean(loadingPath) || saving} refresh={refresh} />}</div>
    <div className="preview-pane">{file ? <><div className="preview-head"><span><FileCode2 />{file.path}</span><div className="preview-actions"><a className="download-file" href={`${basePath === "/" ? "" : basePath}/api/files/download?path=${encodeURIComponent(file.path)}${fileScope}`} download={file.path.split("/").pop()} aria-label="Download file"><Download /><span>Download</span></a>{file.kind === "text" && (editing ? <><button onClick={() => { setEditing(false); setDraft(file.content || ""); }}>Cancel</button><button className="primary" disabled={saving || draft === file.content} onClick={save}><Save />{saving ? "Saving…" : "Save"}</button></> : <button onClick={() => setEditing(true)}>{saved ? <Check /> : <Pencil />}{saved ? "Saved" : "Edit"}</button>)}<button className="danger" aria-label="Delete file" onClick={() => setConfirmDelete(true)}><Trash2 /><span>Delete</span></button></div></div>{confirmDelete && <div className="delete-confirm"><span>Delete <b>{file.path.split("/").pop()}</b>? This cannot be undone.</span><div><button onClick={() => setConfirmDelete(false)}>Cancel</button><button className="danger" disabled={deleting} onClick={() => void deleteCurrentFile()}>{deleting ? "Deleting…" : "Delete"}</button></div></div>}{fileError && <div className="file-preview-error">{fileError}</div>}{file.kind === "image" ? <div className="workspace-image-preview"><a href={`${basePath === "/" ? "" : basePath}/api/files/raw?path=${encodeURIComponent(file.path)}${fileScope}`} target="_blank" rel="noreferrer"><img src={`${basePath === "/" ? "" : basePath}/api/files/raw?path=${encodeURIComponent(file.path)}${fileScope}`} alt={file.path.split("/").pop()} /></a><small>{file.mime} · {fileSize(file.size)}</small></div> : file.previewable ? editing ? <textarea className="file-editor" value={draft} onChange={(event) => setDraft(event.target.value)} spellCheck={false} /> : file.size > 1024 * 1024 ? <pre className="large-text-preview">{file.content}</pre> : <pre>{(file.content || "").split("\n").map((line, index) => <span key={index}><i>{index + 1}</i>{line}{"\n"}</span>)}</pre> : <div className="preview-unavailable"><FileCode2 /><b>Preview unavailable</b><p>{file.reason}</p><a className="preview-download" href={`${basePath === "/" ? "" : basePath}/api/files/download?path=${encodeURIComponent(file.path)}${fileScope}`} download={file.path.split("/").pop()} aria-label="Download file"><Download /><span>Download file</span></a><small>{fileSize(file.size)} · The file remains available in the workspace.</small></div>}</> : fileError ? <div className="preview-unavailable error"><FileCode2 /><b>Could not open file</b><p>{fileError}</p></div> : <div className="preview-empty"><PanelRight /><b>Preview a file</b><p>Select a file from the workspace.</p></div>}</div>{loadingPath && <div className="file-open-overlay" role="status" aria-live="polite"><div className="file-open-card"><span className="file-open-spinner" aria-hidden="true" /><div><b>Opening file…</b><small title={loadingPath}>{loadingPath}</small></div></div></div>}</div>
  </section></div>;
}
