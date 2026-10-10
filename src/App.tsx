import { useCallback, useEffect, useRef, useState } from "react";
import { FolderOpen, GitCompareArrows, Menu, PanelLeftOpen, Settings2 } from "lucide-react";
import { Composer, type ComposerAttachment, type PermissionPreset } from "./components/Composer";
import { Conversation } from "./components/Conversation";
import { DiffDrawer } from "./components/DiffDrawer";
import { FileDrawer } from "./components/FileDrawer";
import { Sidebar } from "./components/Sidebar";
import { SettingsDrawer, type CompactionStatus, type ResourceUsage, type ThreadUsage } from "./components/SettingsDrawer";
import { WorkspacePicker } from "./components/WorkspacePicker";
import { demoItems, demoThreads } from "./demo";
import { useApiTransport } from "./hooks/useApiTransport";
import { threadIsRunning } from "./thread-status";
import type { FileEntry, ModelOption, Thread, UiItem } from "./types";

const demo = new URLSearchParams(location.search).has("demo");
const initialFile = new URLSearchParams(location.search).get("file") || "";
const initialSession = new URLSearchParams(location.search).get("session") || "";
const browserBasePath = location.pathname.replace(/\/$/, "") || "/";
const updateSessionUrl = (id?: string) => { const url = new URL(location.href); if (id) url.searchParams.set("session", id); else url.searchParams.delete("session"); history.replaceState(null, "", url); };
const demoModels: ModelOption[] = [
  { id: "gpt-5.6-sol", model: "gpt-5.6-sol", displayName: "GPT-5.6-Sol", description: "Frontier coding model for complex, long-running work", isDefault: true, defaultReasoningEffort: "medium", supportedReasoningEfforts: ["low", "medium", "high", "xhigh"].map((reasoningEffort) => ({ reasoningEffort, description: `${reasoningEffort} reasoning` })) },
  { id: "gpt-5.6-terra", model: "gpt-5.6-terra", displayName: "GPT-5.6-Terra", description: "Fast, balanced model for everyday coding", isDefault: false, defaultReasoningEffort: "medium", supportedReasoningEfforts: ["low", "medium", "high"].map((reasoningEffort) => ({ reasoningEffort, description: `${reasoningEffort} reasoning` })) },
];
const mergeItems = (current: UiItem[], incoming: UiItem[]) => {
  const next = [...current];
  const positions = new Map(next.map((item, index) => [item.id, index]));
  for (const item of incoming) {
    const index = positions.get(item.id) ?? -1;
    if (index < 0) { positions.set(item.id, next.length); next.push(item); }
    else if (item.type === "assistant_message" && next[index].type === "assistant_message" && item.streaming) next[index] = { ...item, text: item.delta ? (next[index].text + item.text).slice(-262144) : item.text };
    else if (item.type === "thinking" && next[index].type === "thinking" && item.status === "running") next[index] = { ...item, text: item.delta ? (next[index].text + item.text).slice(-262144) : item.text };
    else if (item.type === "command" && next[index].type === "command" && item.status === "running" && !item.command) next[index] = { ...next[index], output: (next[index].output + item.output).slice(-65536) };
    else next[index] = { ...next[index], ...item } as UiItem;
  }
  return next;
};
const diffFromItems = (value: UiItem[]) => value.filter((item): item is Extract<UiItem, { type: "file_change" }> => item.type === "file_change" && Boolean(item.diff)).map((item) => /^(diff --git|--- )/m.test(item.diff || "") ? item.diff : `diff --git a/${item.path} b/${item.path}\n--- a/${item.path}\n+++ b/${item.path}\n${item.diff}`).join("\n");
const displayAttachment = (item: ComposerAttachment) => ({ id: item.id, name: item.name, mime: item.mime, kind: item.kind, size: item.size, data: item.kind === "image" ? item.data : undefined });
const mergeThreadSummary = (previous: Thread | null | undefined, incoming: Thread): Thread => ({ ...previous, ...incoming, preview: incoming.preview || previous?.preview || "" });
const lastTurnIndex = (value: UiItem[], turnId: string) => { for (let index = value.length - 1; index >= 0; index--) if (value[index].turnId === turnId) return index; return -1; };
const editDiff = (path: string, before: string, after: string) => {
  if (before.length + after.length > 512 * 1024) return `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n Large edit saved. Open the file to inspect its contents.`;
  const oldLines = before.split("\n"); const newLines = after.split("\n");
  let prefix = 0; while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) prefix++;
  let suffix = 0; while (suffix < oldLines.length - prefix && suffix < newLines.length - prefix && oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]) suffix++;
  const contextStart = Math.max(0, prefix - 2); const oldEnd = oldLines.length - suffix; const newEnd = newLines.length - suffix; const contextEnd = Math.min(oldLines.length, oldEnd + 2);
  const lines = [`--- a/${path}`, `+++ b/${path}`, `@@ -${contextStart + 1},${contextEnd - contextStart} +${contextStart + 1},${newEnd + (contextEnd - oldEnd) - contextStart} @@`];
  lines.push(...oldLines.slice(contextStart, prefix).map((line) => ` ${line}`), ...oldLines.slice(prefix, oldEnd).map((line) => `-${line}`), ...newLines.slice(prefix, newEnd).map((line) => `+${line}`), ...oldLines.slice(oldEnd, contextEnd).map((line) => ` ${line}`));
  return lines.join("\n");
};

export function App() {
  const [threads, setThreads] = useState<Thread[]>(demo ? demoThreads : []);
  const [boot, setBoot] = useState({ active: !demo, stage: "Connecting to local server", error: "" });
  const [archivedThreads, setArchivedThreads] = useState<Thread[]>([]);
  const [threadCursors, setThreadCursors] = useState<{ recent: string | null; archived: string | null }>({ recent: null, archived: null });
  const [active, setActive] = useState<Thread | null>(demo ? demoThreads[0] : null);
  const activeRef = useRef(active); activeRef.current = active;
  const [items, setItems] = useState<UiItem[]>(demo ? demoItems : []);
  const [messageHistory, setMessageHistory] = useState<{ cursor: string | null; hasEarlier: boolean; loading: boolean }>({ cursor: null, hasEarlier: false, loading: false });
  const [diff, setDiff] = useState(demo ? diffFromItems(demoItems) : "");
  const [models, setModels] = useState<ModelOption[]>(demo ? demoModels : []);
  const modelsRef = useRef(models); modelsRef.current = models;
  const [model, setModel] = useState(demo ? demoModels[0].model : "");
  const [effort, setEffort] = useState(demo ? demoModels[0].defaultReasoningEffort : "");
  const [defaultModel, setDefaultModel] = useState(demo ? demoModels[0].model : "");
  const [defaultEffort, setDefaultEffort] = useState(demo ? demoModels[0].defaultReasoningEffort : "");
  const [permission, setPermission] = useState<PermissionPreset>("ask");
  const [configPermissionLabel, setConfigPermissionLabel] = useState("Ask when needed (Codex default)");
  const [running, setRunning] = useState(false); const [turnId, setTurnId] = useState<string>();
  const [queued, setQueued] = useState(false);
  const submitting = useRef(false);
  const outgoing = useRef(new Map<string, { id: string; text: string; attachments: ComposerAttachment[]; threadId: string }>());
  const lastAttempt = useRef<{ signature: string; id: string } | null>(null);
  const [restoreDraft, setRestoreDraft] = useState<{ id: string; text: string; attachments: ComposerAttachment[] } | null>(null);
  const [scrollRequest, setScrollRequest] = useState(0);
  const [sidebar, setSidebar] = useState(false); const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [files, setFiles] = useState(false); const [fileTarget, setFileTarget] = useState(initialFile); const [settings, setSettings] = useState(false); const [changes, setChanges] = useState(false); const [workspacePicker, setWorkspacePicker] = useState(false);
  const [meta, setMeta] = useState({ workspace: demo ? "/home/demo/project" : "", workspaceBase: demo ? "/home/demo" : "", workspaceSelected: demo, basePath: demo ? browserBasePath : "/", codexStatus: demo ? "ready" : "starting", codexVersion: "Codex" });
  const metaRef = useRef(meta); metaRef.current = meta;
  const [resources, setResources] = useState<ResourceUsage | null>(demo ? { rss: 74e6, heapUsed: 19e6, heapTotal: 34e6, heapLimit: 268e6, external: 3e6, codexRss: 103e6, totalRss: 177e6, uptime: 8240, clients: 1 } : null);
  const [account, setAccount] = useState<any>(demo ? { usage: { summary: { lifetimeTokens: 1824500, peakDailyTokens: 64200, longestRunningTurnSec: 481, currentStreakDays: 9 } }, rateLimits: { rateLimits: { limitId: "codex", primary: { usedPercent: 34, windowDurationMins: 300, resetsAt: Date.now() / 1000 + 7200 }, secondary: { usedPercent: 61, windowDurationMins: 10080, resetsAt: Date.now() / 1000 + 172800 } } } } : null);
  const [threadUsage, setThreadUsage] = useState<ThreadUsage | null>(demo ? { total: { totalTokens: 48210, inputTokens: 42000, cachedInputTokens: 31000, outputTokens: 6210, reasoningOutputTokens: 2400 }, last: { totalTokens: 13800, inputTokens: 11200, cachedInputTokens: 8300, outputTokens: 2600, reasoningOutputTokens: 980 }, modelContextWindow: 114688 } : null); const [compaction, setCompaction] = useState<CompactionStatus>(demo ? { status: "completed", at: Date.now() - 3600000 } : null);
  const pending = useRef(new Map<string, (value: any) => void>());
  const sessionToResume = useRef(initialSession);
  const sessionLoadingRef = useRef(""); const sessionLoadingStarted = useRef(0);
  const [sessionLoading, setSessionLoading] = useState<{ id: string; label: string } | null>(null);
  const beginSessionLoading = useCallback((id: string, label: string) => { if (sessionLoadingRef.current) return false; sessionLoadingRef.current = id; sessionLoadingStarted.current = performance.now(); setSessionLoading({ id, label }); return true; }, []);
  const finishSessionLoading = useCallback((id?: string) => {
    const expected = sessionLoadingRef.current; if (!expected || (id && expected !== id)) return;
    const clear = () => { if (sessionLoadingRef.current !== expected) return; sessionLoadingRef.current = ""; setSessionLoading(null); };
    const delay = Math.max(0, 280 - (performance.now() - sessionLoadingStarted.current));
    delay ? window.setTimeout(clear, delay) : clear();
  }, []);

  const onMessage = useCallback((message: any) => {
    if (message.requestId && pending.current.has(message.requestId)) {
      pending.current.get(message.requestId)?.(message); pending.current.delete(message.requestId); return;
    }
    if (message.type === "events.reset") {
      if (activeRef.current) { beginSessionLoading(activeRef.current.id, "Reconnecting session"); void sendRef.current({ type: "thread.resume", threadId: activeRef.current.id }); }
      return;
    }
    if (message.type === "status") {
      const previous = metaRef.current.codexStatus;
      setMeta((old) => ({ ...old, ...(message.bootstrap && !old.workspaceSelected && !activeRef.current ? message : {}), codexStatus: message.codexStatus, codexVersion: message.codexVersion || old.codexVersion, runtime: message.runtime }));
      if (["stopped", "error"].includes(message.codexStatus)) { setRunning(false); setQueued(false); setTurnId(undefined); submitting.current = false; setItems((old) => old.map((item) => item.type === "assistant_message" ? { ...item, streaming: false } : item.type === "thinking" ? { ...item, status: "done" } : item.type === "command" && item.status === "running" ? { ...item, status: "error" } : item)); }
      if (message.codexStatus === "ready" && ["stopped", "error"].includes(previous) && activeRef.current) void sendRef.current({ type: "thread.resume", threadId: activeRef.current.id });
    }
    else if (message.type === "bootstrap.stage") setBoot((old) => ({ ...old, stage: message.stage === "starting" ? "Starting Codex" : message.stage, error: message.error || "" }));
    else if (message.type === "bootstrap.ready") setBoot({ active: false, stage: "Ready", error: "" });
    else if (message.type === "bootstrap.error") setBoot({ active: false, stage: "Codex failed to start", error: message.message || "Unknown startup error" });
    else if (message.type === "threads") {
      const merge = (old: Thread[]) => {
        const previous = new Map(old.map((thread) => [thread.id, thread]));
        const incoming = message.threads.map((thread: Thread) => mergeThreadSummary(previous.get(thread.id), thread));
        if (message.refresh) return [...incoming, ...old.filter((entry) => !incoming.some((next: Thread) => next.id === entry.id))];
        if (message.append) return [...old, ...incoming.filter((next: Thread) => !previous.has(next.id))];
        return incoming;
      };
      const current = message.threads.find((thread: Thread) => thread.id === activeRef.current?.id);
      if (current) setActive((old) => old?.id === current.id ? mergeThreadSummary(old, current) : old);
      if (current?.status && !submitting.current) { const isRunning = threadIsRunning(current); setRunning(isRunning); setQueued(Boolean(current.queued)); if (!isRunning) setTurnId(undefined); }
      if (message.archived) { setArchivedThreads(merge); setThreadCursors((old) => ({ ...old, archived: message.nextCursor || null })); }
      else { setThreads(merge); if (!message.refresh) setThreadCursors((old) => ({ ...old, recent: message.nextCursor || null })); }
    } else if (message.type === "models") {
      setModels(message.models); const configured = message.models.find((item: ModelOption) => item.model === message.defaultModel || item.id === message.defaultModel); const preferred = configured || message.models.find((item: ModelOption) => item.isDefault);
      const nextModel = message.defaultModel || preferred?.model || ""; const nextEffort = message.defaultEffort || configured?.defaultReasoningEffort || preferred?.defaultReasoningEffort || "";
      setDefaultModel(nextModel); setDefaultEffort(nextEffort); if (!activeRef.current) { setModel(nextModel); setEffort(nextEffort); }
      if (message.defaultPermission && !message.action) { setPermission(message.defaultPermission); setConfigPermissionLabel(message.defaultPermissionLabel || "Codex default"); }
    } else if (message.type === "thread.active") {
      const thread = mergeThreadSummary(activeRef.current?.id === message.thread.id ? activeRef.current : undefined, message.thread);
      const nextItems = message.items || [];
      activeRef.current = thread;
      finishSessionLoading();
      if (message.workspace) setMeta((old) => ({ ...old, ...message.workspace }));
      setActive(thread); updateSessionUrl(thread.id); setItems(nextItems); setMessageHistory({ cursor: message.historyCursor || null, hasEarlier: Boolean(message.hasEarlier), loading: false }); setDiff(diffFromItems(nextItems)); setThreadUsage(null); setCompaction(message.compaction || null); setQueued(Boolean(message.queued)); setRunning(Boolean(message.queued || (typeof message.running === "boolean" ? message.running : threadIsRunning(thread)))); setTurnId(message.turnId);
      if (message.defaultPermission) { setPermission(message.defaultPermission); setConfigPermissionLabel(message.defaultPermissionLabel || "Codex default"); }
      const status = typeof message.running === "boolean" ? { type: message.running ? "active" : "idle" } : message.thread.status;
      setThreads((old) => old.map((entry) => entry.id === thread.id ? { ...mergeThreadSummary(entry, thread), status } : entry));
      setArchivedThreads((old) => old.map((entry) => entry.id === thread.id ? { ...mergeThreadSummary(entry, thread), status } : entry));
      if (message.model) setModel(message.model); if (message.effort) setEffort(message.effort);
    } else if (message.type === "history.items" && message.threadId === activeRef.current?.id) {
      setItems((old) => [...message.items.filter((next: UiItem) => !old.some((item) => item.id === next.id)), ...old]);
      setMessageHistory({ cursor: message.historyCursor || null, hasEarlier: Boolean(message.hasEarlier), loading: false });
    } else if (message.type === "thread.changed") {
      setThreads((old) => [mergeThreadSummary(old.find((entry) => entry.id === message.thread.id), message.thread), ...old.filter((entry) => entry.id !== message.thread.id)]);
      setActive((old) => old?.id === message.thread.id ? mergeThreadSummary(old, message.thread) : old);
    } else if (message.type === "thread.mutated") {
      setThreads((old) => old.filter((entry) => entry.id !== message.threadId)); setArchivedThreads((old) => old.filter((entry) => entry.id !== message.threadId));
      if (activeRef.current?.id === message.threadId && message.action !== "unarchive") { activeRef.current = null; setRunning(false); setQueued(false); setTurnId(undefined); setActive(null); updateSessionUrl(); setItems([]); setMessageHistory({ cursor: null, hasEarlier: false, loading: false }); setDiff(""); setThreadUsage(null); setCompaction(null); }
      sendRef.current({ type: "thread.list" }); sendRef.current({ type: "thread.list", archived: true });
    } else if (message.type === "items") { if (message.threadId === activeRef.current?.id) setItems((old) => mergeItems(old, message.items)); }
    else if (message.type === "event") {
      // The running-only poll stops at turn completion, so fetch its final title now.
      if (message.threadId && message.running === false) void sendRef.current({ type: "thread.list", refresh: true });
      const nextStatus = message.threadStatus || (typeof message.running === "boolean" ? { type: message.running ? "active" : "idle" } : null);
      if (message.threadId && nextStatus) {
        setThreads((old) => old.map((thread) => thread.id === message.threadId ? { ...thread, queued: false, status: nextStatus } : thread));
        setArchivedThreads((old) => old.map((thread) => thread.id === message.threadId ? { ...thread, queued: false, status: nextStatus } : thread));
      }
      if (!message.threadId || message.threadId === activeRef.current?.id) {
        if (message.items) setItems((old) => mergeItems(old, message.items)); if (message.diff !== undefined) setDiff(message.diff); if (message.tokenUsage) setThreadUsage(message.tokenUsage); if (message.compaction) setCompaction(message.compaction);
        const nextRunning = message.threadId ? message.threadStatus ? message.threadStatus.type === "active" : message.running : undefined;
        if (typeof nextRunning === "boolean") {
          setRunning(nextRunning); setQueued(false);
          if (!nextRunning) { setTurnId(undefined); for (const [id, prompt] of outgoing.current) if (prompt.threadId === message.threadId) outgoing.current.delete(id); }
        }
        if (message.turnId && nextRunning !== false) setTurnId(message.turnId);
      }
    } else if (message.type === "turn.queued") {
      setThreads((old) => old.map((thread) => thread.id === message.threadId ? { ...thread, queued: true } : thread));
      if (message.threadId === activeRef.current?.id) { setQueued(true); setRunning(true); setItems((old) => old.map((item) => item.id === message.messageId && item.type === "user_message" ? { ...item, delivery: "queued" } : item)); }
    } else if (message.type === "turn.failed") {
      setThreads((old) => old.map((thread) => thread.id === message.threadId ? { ...thread, queued: false, status: { type: "idle" } } : thread));
      lastAttempt.current = null;
      if (message.threadId === activeRef.current?.id) { setQueued(false); setRunning(false); setTurnId(undefined); setItems((old) => old.map((item) => item.id === message.messageId && item.type === "user_message" ? { ...item, delivery: "failed", failure: message.message } : item)); }
    } else if (message.type === "turn.accepted") {
      outgoing.current.delete(message.messageId);
      if (message.running === false) void sendRef.current({ type: "thread.list", refresh: true });
      if (message.threadId) setThreads((old) => old.map((thread) => thread.id === message.threadId ? { ...thread, queued: false, status: { type: message.running === false ? "idle" : "active" } } : thread));
      if (message.threadId !== activeRef.current?.id) return;
      setQueued(false); setTurnId(message.running === false ? undefined : message.turnId); setRunning(message.running !== false);
      if (message.messageId && Array.isArray(message.attachments)) setItems((old) => old.map((item) => {
        if (item.type !== "user_message" || item.id !== message.messageId) return item;
        return { ...item, delivery: "sent", turnId: message.turnId, attachments: message.attachments.map((attachment: any) => ({ ...attachment, data: undefined })) };
      }));
    }
    else if (message.type === "fs.entries") { pending.current.get(`list:${message.path}`)?.(message); pending.current.delete(`list:${message.path}`); }
    else if (message.type === "fs.file") { pending.current.get(`read:${message.path || message.file?.path}`)?.(message); pending.current.delete(`read:${message.path || message.file?.path}`); }
    else if (message.type === "fs.saved") { pending.current.get(`write:${message.path || message.file?.path}`)?.(message); pending.current.delete(`write:${message.path || message.file?.path}`); }
    else if (message.type === "fs.uploaded") { pending.current.get(`upload:${message.requestId}`)?.(message); pending.current.delete(`upload:${message.requestId}`); }
    else if (message.type === "fs.created") { pending.current.get(`create:${message.requestId}`)?.(message); pending.current.delete(`create:${message.requestId}`); }
    else if (message.type === "fs.deleted") { pending.current.get(`delete:${message.requestId}`)?.(message); pending.current.delete(`delete:${message.requestId}`); }
    else if (message.type === "workspace.entries") { pending.current.get(`workspace:${message.path}`)?.(message.entries); pending.current.delete(`workspace:${message.path}`); setMeta((old) => ({ ...old, workspaceBase: message.base, workspace: message.current })); }
    else if (message.type === "workspace.selected") { const availableModels = modelsRef.current; const configured = availableModels.find((item) => item.model === message.defaultModel || item.id === message.defaultModel); const preferred = configured || availableModels.find((item) => item.isDefault); const nextModel = message.defaultModel || preferred?.model || ""; const nextEffort = message.defaultEffort || configured?.defaultReasoningEffort || preferred?.defaultReasoningEffort || ""; setDefaultModel(nextModel); setDefaultEffort(nextEffort); setModel(nextModel); setEffort(nextEffort); if (message.defaultPermission) { setPermission(message.defaultPermission); setConfigPermissionLabel(message.defaultPermissionLabel || "Codex default"); } setMeta((old) => ({ ...old, ...message, workspaceSelected: true })); setWorkspacePicker(false); activeRef.current = null; setActive(null); setRunning(false); setQueued(false); setTurnId(undefined); updateSessionUrl(); setItems([]); setMessageHistory({ cursor: null, hasEarlier: false, loading: false }); setDiff(""); setThreadUsage(null); setCompaction(null); }
    else if (message.type === "system.usage") setResources(message.usage);
    else if (message.type === "account.usage") setAccount(message);
    else if (message.type === "error") {
      finishSessionLoading();
      if (message.action === "runtime.restart" || message.action === "runtime.start") setBoot({ active: false, stage: "error", error: message.message });
      if (["turn.send", "thread.create"].includes(message.action)) {
        setRunning(false); setQueued(false); if (!message.transportError) lastAttempt.current = null;
        setItems((old) => old.map((item) => item.id === message.messageId && item.type === "user_message" ? { ...item, delivery: "failed", failure: message.message } : item));
      }
      setMessageHistory((old) => ({ ...old, loading: false }));
      setItems((old) => [...old, { type: "error", id: `e-${crypto.randomUUID()}`, message: message.message }]);
    }
  }, [finishSessionLoading, beginSessionLoading]);
  const { connected, send } = useApiTransport(onMessage, demo); const sendRef = useRef(send); sendRef.current = send;
  useEffect(() => { if (demo || !connected || meta.codexStatus !== "ready" || !sessionToResume.current) return; const threadId = sessionToResume.current; sessionToResume.current = ""; beginSessionLoading(threadId, "Opening session"); send({ type: "thread.resume", threadId }); }, [connected, meta.codexStatus, send, beginSessionLoading]);
  const hasRunningThreads = threads.some(threadIsRunning);
  useEffect(() => { if (demo || !connected || !hasRunningThreads) return; const timer = window.setInterval(() => { if (!document.hidden) send({ type: "thread.list", refresh: true }); }, 7_500); return () => window.clearInterval(timer); }, [connected, send, hasRunningThreads]);
  useEffect(() => { if (!settings || demo || !connected) return; send({ type: "system.usage" }); if (meta.codexStatus === "ready") send({ type: "account.usage" }); const timer = window.setInterval(() => { if (!document.hidden) void send({ type: "system.usage" }); }, 3000); return () => window.clearInterval(timer); }, [settings, connected, meta.codexStatus, send]);
  useEffect(() => { if (compaction?.status !== "completed" || !compaction.at) return; const at = compaction.at; const timer = window.setTimeout(() => setCompaction((current) => current?.at === at ? null : current), 6000); return () => window.clearTimeout(timer); }, [compaction]);
  useEffect(() => { if (fileTarget && meta.workspaceSelected) setFiles(true); }, [fileTarget, meta.workspaceSelected]);

  const create = () => {
    if (submitting.current) return;
    activeRef.current = null;
    setQueued(false);
    setDiff(""); setItems([]); setMessageHistory({ cursor: null, hasEarlier: false, loading: false }); setActive(null); updateSessionUrl(); setThreadUsage(null); setCompaction(null); setRunning(false); setModel(defaultModel); setEffort(defaultEffort);
    if (demo) { const thread = { id: `demo-${Date.now()}`, preview: "New thread", updatedAt: Date.now() / 1000 }; setThreads((old) => [thread, ...old]); setActive(thread); setItems([]); }
    else if (!meta.workspaceSelected) setWorkspacePicker(true);
  };
  const select = (id: string) => {
    if (demo) { updateSessionUrl(id); setActive(demoThreads.find((entry) => entry.id === id) || threads.find((entry) => entry.id === id) || null); setItems(id === "demo" ? demoItems : []); setDiff(id === "demo" ? diffFromItems(demoItems) : ""); return; }
    if (submitting.current || !beginSessionLoading(id, "Opening session")) return;
    setMessageHistory({ cursor: null, hasEarlier: false, loading: false }); send({ type: "thread.resume", threadId: id });
  };
  const branchFrom = (sourceTurnId: string) => {
    if (!active || !sourceTurnId || running || queued || sessionLoadingRef.current) return;
    if (demo) { const boundary = lastTurnIndex(items, sourceTurnId); const branchItems = boundary >= 0 ? items.slice(0, boundary + 1) : items; const thread: Thread = { ...active, id: `branch-${Date.now()}`, forkedFromId: active.id, createdAt: Date.now() / 1000, updatedAt: Date.now() / 1000 }; setThreads((old) => [thread, ...old]); setActive(thread); updateSessionUrl(thread.id); setItems(branchItems); return; }
    if (beginSessionLoading(`fork:${active.id}`, "Creating branch")) send({ type: "thread.fork", threadId: active.id, turnId: sourceTurnId });
  };
  const mutateThread = (action: "archive" | "unarchive" | "delete", id: string) => {
    if (!demo) return send({ type: `thread.${action}`, threadId: id });
    const source = [...threads, ...archivedThreads]; const thread = source.find((entry) => entry.id === id);
    setThreads((old) => old.filter((entry) => entry.id !== id)); setArchivedThreads((old) => old.filter((entry) => entry.id !== id));
    if (action === "archive" && thread) setArchivedThreads((old) => [thread, ...old]); if (action === "unarchive" && thread) setThreads((old) => [thread, ...old]);
    if (active?.id === id && action !== "unarchive") { setActive(null); setItems([]); setDiff(""); }
  };
  const sendTurn = async (text: string, attachments: ComposerAttachment[]) => {
    if (running || submitting.current) return false;
    if (!activeRef.current && !metaRef.current.workspaceSelected) { setWorkspacePicker(true); return false; }
    submitting.current = true; setRunning(true); setQueued(false);
    try {
      let thread = activeRef.current;
      if (!thread && !demo) {
        const created = await send({ type: "thread.create", workspace: metaRef.current.workspace, model, effort, permission });
        thread = created.find((entry) => entry.type === "thread.active")?.thread;
        if (!thread) { setRunning(false); return false; }
      }
      setRunning(true);
      if (thread && !thread.name && (!thread.preview || thread.preview === "New thread")) {
        const preview = (text.trim().replace(/\s+/g, " ") || attachments.map((item) => item.name).join(", ")).slice(0, 30);
        if (preview) {
          thread = { ...thread, preview };
          activeRef.current = thread; setActive(thread);
          const updated = thread;
          setThreads((old) => old.map((entry) => entry.id === updated.id ? mergeThreadSummary(entry, updated) : entry));
        }
      }
      const signature = JSON.stringify([thread?.id, text, attachments.map((item) => item.id)]);
      const localId = lastAttempt.current?.signature === signature ? lastAttempt.current.id : crypto.randomUUID();
      lastAttempt.current = { signature, id: localId };
      outgoing.current.set(localId, { id: localId, text, attachments, threadId: thread?.id || "demo" });
      while (outgoing.current.size > 12) outgoing.current.delete(outgoing.current.keys().next().value!);
      setItems((old) => mergeItems(old, [{ type: "user_message", id: localId, text, attachments: attachments.map(displayAttachment), timestamp: Date.now(), delivery: "sending" }]));
      setScrollRequest((value) => value + 1);
      if (demo) {
        const id = `reply-${Date.now()}`; const words = "I am streaming this response while reasoning and tool activity remain visible.".split(" "); let index = 0;
        const timer = window.setInterval(() => {
          setItems((old) => mergeItems(old, [{ type: "assistant_message", id, text: `${words[index++]} `, streaming: true, delta: true }]));
          if (index >= words.length) { window.clearInterval(timer); setItems((old) => mergeItems(old, [{ type: "assistant_message", id, text: words.join(" "), streaming: false }])); setRunning(false); }
        }, 75); return true;
      }
      const result = await send({ type: "turn.send", threadId: thread!.id, clientUserMessageId: localId, text, attachments, model, effort, permission });
      const accepted = result.some((entry) => entry.type === "turn.queued" || entry.type === "turn.accepted");
      if (accepted) lastAttempt.current = null; else setRunning(false);
      return accepted;
    } finally { submitting.current = false; }
  };
  const request = useCallback(<T,>(key: string, message: any) => new Promise<T>((resolve) => {
    if (!demo) {
      const requestId = crypto.randomUUID();
      const timer = window.setTimeout(() => { pending.current.delete(requestId); resolve({ error: "Request timed out" } as T); }, 121_000);
      pending.current.set(requestId, (value) => { window.clearTimeout(timer); resolve(value); });
      void send({ ...message, requestId, workspace: metaRef.current.workspace, threadId: activeRef.current?.id }); return;
    }
    pending.current.set(key, resolve);
    window.setTimeout(() => {
      let value: any;
      if (message.type === "fs.read") { const content = "import { z } from 'zod';\n\nconst userSchema = z.object({\n  email: z.string().email(),\n  name: z.string().min(1),\n});\n\nexport async function createUser(req, res) {\n  const result = userSchema.safeParse(req.body);\n  if (!result.success) {\n    return res.status(400).json({ error: 'Invalid input' });\n  }\n}"; value = { file: { path: message.path, content, size: content.length, previewable: true, kind: "text", mime: "text/plain" } }; }
      else if (message.type === "fs.write") value = { file: { path: message.path, content: message.content, size: message.content.length, previewable: true, kind: "text", mime: "text/plain" } };
      else if (message.type === "fs.upload") value = { file: { path: [message.directory, message.name].filter(Boolean).join("/"), size: Math.floor((message.data?.length || 0) * 3 / 4) } };
      else if (message.type === "fs.create") value = { file: { path: [message.directory, message.name].filter(Boolean).join("/"), content: "", size: 0, previewable: true, kind: "text", mime: "text/plain" } };
      else if (message.type === "fs.delete") value = { file: { path: message.path } };
      else if (message.type === "workspace.list") value = message.path ? [{ name: "project", path: `${message.path}/project`, type: "directory" }] : [{ name: "code", path: "code", type: "directory" }, { name: "projects", path: "projects", type: "directory" }];
      else value = message.path ? [{ name: "users.ts", path: "src/server/users.ts", type: "file" }] : [{ name: "src", path: "src", type: "directory" }, { name: "package.json", path: "package.json", type: "file" }, { name: "README.md", path: "README.md", type: "file" }];
      pending.current.get(key)?.(value); pending.current.delete(key);
    }, 50);
  }), [send]);
  const loadFiles = useCallback(async (path: string) => { const result = await request<any>(`list:${path}`, { type: "fs.list", path }); if (Array.isArray(result)) return result as FileEntry[]; if (result.error) throw new Error(result.error); return result.entries as FileEntry[]; }, [request]);
  const searchFiles = useCallback(async (query: string) => { if (demo) return { entries: [{ name: "package.json", path: "package.json", type: "file" as const }, { name: "README.md", path: "README.md", type: "file" as const }].filter((item) => item.path.toLowerCase().includes(query.toLowerCase())), truncated: false }; const result = await request<any>(`search:${query}`, { type: "fs.search", query }); if (result.error || result.type === "error") throw new Error(result.error || result.message); return result; }, [request]);
  const readFile = useCallback(async (path: string) => { const result = await request<any>(`read:${path}`, { type: "fs.read", path }); if (result.error) throw new Error(result.error); return result.file; }, [request]);
  const writeFile = useCallback(async (path: string, content: string, revision?: string) => { const result = await request<any>(`write:${path}`, { type: "fs.write", path, content, revision }); if (result.error) throw new Error(result.error); return result.file; }, [request]);
  const uploadFile = useCallback(async (directory: string, name: string, data: string) => { const requestId = crypto.randomUUID(); const result = await request<any>(`upload:${requestId}`, { type: "fs.upload", requestId, directory, name, data }); if (result.error) throw new Error(result.error); return result.file as { path: string; size: number }; }, [request]);
  const createFile = useCallback(async (directory: string, name: string) => { const requestId = crypto.randomUUID(); const result = await request<any>(`create:${requestId}`, { type: "fs.create", requestId, directory, name }); if (result.error) throw new Error(result.error); return result.file; }, [request]);
  const deleteFile = useCallback(async (path: string) => { const requestId = crypto.randomUUID(); const result = await request<any>(`delete:${requestId}`, { type: "fs.delete", requestId, path }); if (result.error) throw new Error(result.error); return result.file as { path: string }; }, [request]);
  const loadWorkspaces = useCallback(async (path: string) => { const result = await request<any>(`workspace:${path}`, { type: "workspace.list", path }); if (result.error) throw new Error(result.error); return Array.isArray(result) ? result : result.entries; }, [request]);
  const chooseWorkspace = (path: string) => demo ? (setMeta((old) => ({ ...old, workspace: `${old.workspaceBase}/${path}`.replace(/\/$/, ""), workspaceSelected: true })), setWorkspacePicker(false), setActive(null), setItems([]), setDiff("")) : send({ type: "workspace.select", path });

  const sidebarProps = { threads, archivedThreads, active: active?.id, select, create, archive: (id: string) => mutateThread("archive", id), unarchive: (id: string) => mutateThread("unarchive", id), remove: (id: string) => mutateThread("delete", id), chooseWorkspace: () => setWorkspacePicker(true), workspace: meta.workspaceSelected ? meta.workspace : "", moreRecent: Boolean(threadCursors.recent), moreArchived: Boolean(threadCursors.archived), loadMore: (view: "recent" | "archived") => send({ type: "thread.list", archived: view === "archived", cursor: view === "archived" ? threadCursors.archived : threadCursors.recent }) };
  const title = active?.name || active?.preview || "New thread";
  const openWorkspaceFile = useCallback((path: string) => { setFileTarget(path); if (meta.workspaceSelected) setFiles(true); else setWorkspacePicker(true); }, [meta.workspaceSelected]);
  const closeFiles = () => { setFiles(false); setFileTarget(""); const url = new URL(location.href); if (url.searchParams.has("file")) { url.searchParams.delete("file"); history.replaceState(null, "", url); } };
  return <div className={`app-shell ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
    {boot.active && <div className="boot-loading" role="status"><div className="boot-card"><span className="boot-spinner" /><div><b>{boot.stage}</b><small>Loading models and recent sessions…</small></div></div></div>}
    {!boot.active && sessionLoading && <div className="boot-loading session-loading" role="status" aria-live="polite"><div className="boot-card compact"><span className="boot-spinner" /><div><b>{sessionLoading.label}</b></div></div></div>}
    {!boot.active && boot.error && <div className="boot-error" role="alert"><span><b>Codex startup failed</b><small>{boot.error}</small></span><button onClick={() => { setBoot({ active: true, stage: "Restarting Codex", error: "" }); send({ type: "runtime.restart" }); }}>Retry</button></div>}
    <div className="desktop-sidebar"><Sidebar {...sidebarProps} onCollapse={() => setSidebarCollapsed(true)} /></div>
    <section className="workspace-shell">
      <header className="workspace-header"><div className="header-leading"><button className="mobile-menu icon-button" aria-label="Open threads" onClick={() => setSidebar(true)}><Menu /></button>{sidebarCollapsed && <button className="desktop-sidebar-open icon-button" aria-label="Open threads" onClick={() => setSidebarCollapsed(false)}><PanelLeftOpen /></button>}<div className="thread-heading"><strong>{title}</strong><span><i className={connected || demo ? "online" : ""} />{queued ? "Waiting in queue" : running ? "Codex is working" : meta.workspaceSelected ? meta.workspace.split("/").filter(Boolean).pop() : "Choose a workspace"}</span></div></div>
        <div className="header-actions"><span className={`connection ${connected || demo ? "online" : ""}`}><i />{connected || demo ? "Web UI online" : "Connecting"}</span><button className={`runtime-chip ${meta.codexStatus}`} onClick={() => setSettings(true)}><i />Codex {queued ? "queued" : running ? "busy" : meta.codexStatus}</button>{diff && <button className="header-button changes-button" aria-label="Changes" onClick={() => setChanges(true)}><GitCompareArrows /><span>Changes</span></button>}<button className="header-button" aria-label="Files" onClick={() => meta.workspaceSelected ? setFiles(true) : setWorkspacePicker(true)}><FolderOpen /><span>Files</span></button><button className="header-icon-button" aria-label="Settings" onClick={() => setSettings(true)}><Settings2 /></button></div>
      </header>
      <main className={`chat-main ${items.length === 0 ? "is-empty" : ""}`}><Conversation items={items} threadId={active?.id || ""} running={running} queued={queued} retry={(id) => { const prompt = outgoing.current.get(id); if (prompt) setRestoreDraft({ ...prompt, id: crypto.randomUUID() }); }} scrollRequest={scrollRequest} workspace={meta.workspace} basePath={meta.basePath} hasEarlier={messageHistory.hasEarlier} loadingEarlier={messageHistory.loading} loadEarlier={() => { if (!active || messageHistory.loading) return; setMessageHistory((old) => ({ ...old, loading: true })); send({ type: "thread.history", threadId: active.id, before: messageHistory.cursor }); }} openFile={openWorkspaceFile} branch={branchFrom} respond={(item, decision) => { if (!demo) void send({ type: "approval.respond", threadId: active?.id, approvalId: item.requestId, decision }); else setItems((old) => old.map((entry) => entry.id === item.id ? { ...item, status: "approved" } : entry)); }} /><Composer running={running} queued={queued} restoreDraft={restoreDraft} disabled={(!connected || meta.codexStatus !== "ready") && !demo} send={sendTurn} stop={() => { if (active) send({ type: "turn.interrupt", threadId: active.id, turnId }); }} models={models} model={model} effort={effort} permission={permission} configPermissionLabel={configPermissionLabel} threadUsage={threadUsage} compaction={compaction} onModel={setModel} onEffort={setEffort} onPermission={setPermission} /></main>
    </section>
    {sidebar && <div className="drawer-layer sidebar-layer" onMouseDown={(event) => event.target === event.currentTarget && setSidebar(false)}><Sidebar {...sidebarProps} onDismiss={() => setSidebar(false)} /></div>}
    {files && <FileDrawer close={closeFiles} load={loadFiles} search={searchFiles} read={readFile} write={writeFile} upload={uploadFile} create={createFile} remove={deleteFile} basePath={meta.basePath} workspace={meta.workspace} threadId={active?.id} initialPath={fileTarget} onSaved={(path, before, after) => setDiff((current) => [current, editDiff(path, before, after)].filter(Boolean).join("\n"))} />}
    {changes && <DiffDrawer diff={diff} close={() => setChanges(false)} />}
    {workspacePicker && <WorkspacePicker close={() => setWorkspacePicker(false)} load={loadWorkspaces} select={chooseWorkspace} current={meta.workspaceSelected ? meta.workspace : ""} base={meta.workspaceBase} />}
    {settings && <SettingsDrawer close={() => setSettings(false)} meta={meta} connected={connected || demo} resources={resources} account={account} threadUsage={threadUsage} active={Boolean(active)} runtimeAction={(action) => send({ type: `runtime.${action}` })} />}
  </div>;
}
