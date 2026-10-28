import { ArrowLeft, Check, Folder, FolderOpen, HardDrive, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { FileEntry } from "../types";

export function WorkspacePicker({
  close,
  load,
  resolve,
  select,
  current,
  base,
  start,
  active,
  onSelectingChange,
  notice = "",
}: {
  close: () => void;
  load: (path: string, showHidden: boolean) => Promise<FileEntry[]>;
  resolve: (path: string) => Promise<{ path: string; absolute: string; base: string }>;
  select: (path: string) => Promise<void>;
  current: string;
  base: string;
  start: string;
  active: boolean;
  onSelectingChange: (selecting: boolean) => void;
  notice?: string;
}) {
  const [browseBase, setBrowseBase] = useState(base);
  const [path, setPath] = useState(() => {
    const normalizedBase = base.replaceAll("\\", "/").replace(/\/$/, "");
    const normalizedCurrent = (current || start).replaceAll("\\", "/");
    const prefix = `${normalizedBase}/`;
    const matches = /^[a-z]:/i.test(prefix)
      ? normalizedCurrent.toLowerCase().startsWith(prefix.toLowerCase())
      : normalizedCurrent.startsWith(prefix);
    return matches ? normalizedCurrent.slice(prefix.length) : "";
  });
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [error, setError] = useState("");
  const [listError, setListError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [showHidden, setShowHidden] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [input, setInput] = useState("");
  const absolute = path
    ? `${browseBase.replaceAll("\\", "/").replace(/\/$/, "")}/${path}`
    : browseBase;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !selecting) close();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [close, selecting]);
  useEffect(() => {
    let live = true;
    setLoading(true);
    setError("");
    setListError("");
    load(absolute, showHidden)
      .then((items) => {
        if (live) setEntries(items);
      })
      .catch((error) => {
        if (live) {
          setListError(error instanceof Error ? error.message : String(error));
          setEntries([]);
        }
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [absolute, showHidden, load, refresh]);
  const crumbs = useMemo(() => path.split("/").filter(Boolean), [path]);
  useEffect(() => setInput(absolute), [absolute]);
  const comparable = (value: string) => {
    const normalized = value.replaceAll("\\", "/").replace(/\/$/, "") || "/";
    return /^[a-z]:/i.test(normalized) ? normalized.toLowerCase() : normalized;
  };
  const isCurrent = Boolean(current) && comparable(absolute) === comparable(current);
  const navigate = async (target = input) => {
    if (resolving || selecting) return;
    setResolving(true);
    setError("");
    try {
      const result = await resolve(target);
      if (result.path === path && result.base === browseBase) setRefresh((value) => value + 1);
      setBrowseBase(result.base);
      setPath(result.path);
      setInput(result.absolute);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setResolving(false);
    }
  };
  const confirm = async () => {
    if (loading || resolving || selecting || listError) return;
    setSelecting(true);
    onSelectingChange(true);
    setError("");
    try {
      const target = await resolve(input);
      setBrowseBase(target.base);
      setPath(target.path);
      setInput(target.absolute);
      if (active && current && comparable(target.absolute) === comparable(current)) close();
      else await select(target.absolute);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSelecting(false);
      onSelectingChange(false);
    }
  };
  return (
    <div
      className="modal-layer"
      onMouseDown={(event) => event.target === event.currentTarget && !selecting && close()}
    >
      <section
        className="workspace-picker"
        role="dialog"
        aria-modal="true"
        aria-label="Choose workspace"
      >
        <header>
          <div>
            <span>Open folder</span>
            <b>Choose workspace</b>
          </div>
          <button
            className="icon-button"
            aria-label="Close workspace picker"
            disabled={selecting}
            onClick={close}
          >
            <X />
          </button>
        </header>
        <div className="workspace-breadcrumb">
          <button
            aria-label="Filesystem root"
            title={browseBase}
            disabled={selecting || resolving}
            onClick={() => setPath("")}
          >
            <HardDrive />
          </button>
          {crumbs.map((crumb, index) => (
            <button
              key={`${crumb}-${index}`}
              disabled={selecting || resolving}
              onClick={() => setPath(crumbs.slice(0, index + 1).join("/"))}
            >
              {crumb}
            </button>
          ))}
        </div>
        {notice && (
          <p className="workspace-notice" role="status">
            {notice}
          </p>
        )}
        <form
          className="workspace-path-entry"
          onSubmit={(event) => {
            event.preventDefault();
            void navigate();
          }}
        >
          <label htmlFor="workspace-path">Folder path</label>
          <div>
            <input
              id="workspace-path"
              autoFocus
              value={input}
              onChange={(event) => {
                setInput(event.target.value);
                setError("");
              }}
              disabled={selecting || resolving}
              spellCheck={false}
            />
            <button type="submit" disabled={selecting || resolving || !input.trim()}>
              {resolving ? "Opening…" : "Go"}
            </button>
          </div>
        </form>
        <div className="workspace-browse-options">
          <label>
            <input
              type="checkbox"
              checked={showHidden}
              disabled={selecting || resolving}
              onChange={(event) => setShowHidden(event.target.checked)}
            />{" "}
            Show hidden folders
          </label>
          <span title={browseBase}>Filesystem root: {browseBase}</span>
        </div>
        <div className="workspace-current">
          <FolderOpen />
          <span>
            <small>Selected folder</small>
            <b title={absolute}>{absolute}</b>
          </span>
          {isCurrent && (
            <em>
              <Check /> Current
            </em>
          )}
        </div>
        <div className="workspace-folders">
          {path && (
            <button
              disabled={selecting || resolving}
              onClick={() => setPath(crumbs.slice(0, -1).join("/"))}
            >
              <ArrowLeft />
              <span>
                <b>Parent folder</b>
                <small>Go up one level</small>
              </span>
            </button>
          )}
          {loading ? (
            <p>Loading folders…</p>
          ) : (
            entries.map((entry) => (
              <button
                key={entry.path}
                disabled={selecting || resolving}
                onClick={() => void navigate(entry.path)}
              >
                <Folder />
                <span>
                  <b>{entry.name}</b>
                  <small>{entry.path}</small>
                </span>
              </button>
            ))
          )}
          {!loading && !listError && !entries.length && <p>This folder has no subfolders.</p>}
        </div>
        {(error || listError) && (
          <p className="workspace-error" role="alert">
            {error || listError}
          </p>
        )}
        <footer>
          <span>
            {active
              ? "Changing folders starts a new conversation."
              : "Choose the working folder for this conversation."}
          </span>
          <button
            disabled={loading || resolving || selecting || Boolean(listError)}
            onClick={() => void confirm()}
          >
            {selecting
              ? "Opening…"
              : active && isCurrent
                ? "Keep current workspace"
                : active
                  ? "Start new conversation"
                  : "Use this folder"}
          </button>
        </footer>
      </section>
    </div>
  );
}
