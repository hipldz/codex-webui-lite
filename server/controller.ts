import crypto from "node:crypto";
import v8 from "node:v8";
import { adapt, approval } from "./codex/event-adapter.js";
import type { CodexClient } from "./codex/client.js";
import { AttachmentStore, type AttachmentSummary, type IncomingAttachment } from "./attachments.js";
import type { WorkspaceFs } from "./filesystem.js";
import type { EventHub } from "./event-hub.js";
import { HistoryReader, type HistoryEntry } from "./history.js";
import { TurnQueue } from "./turn-queue.js";
import { processTreeMemory } from "./resources.js";

const sourceKinds = ["cli", "vscode", "exec", "appServer", "subAgent", "subAgentReview", "subAgentCompact", "subAgentThreadSpawn", "subAgentOther", "unknown"];
const threadPermissionSettings = (permission: unknown) => permission === "config" ? {} : permission === "full" ? { approvalPolicy: "never", approvalsReviewer: "user", sandbox: "danger-full-access" } : permission === "read-only" ? { approvalPolicy: "on-request", approvalsReviewer: "user", sandbox: "read-only" } : { approvalPolicy: "on-request", approvalsReviewer: "user", sandbox: "workspace-write" };
const turnPermissionSettings = (permission: unknown, cwd: string) => permission === "config" ? {} : permission === "full" ? { approvalPolicy: "never", approvalsReviewer: "user", sandboxPolicy: { type: "dangerFullAccess" } } : permission === "read-only" ? { approvalPolicy: "on-request", approvalsReviewer: "user", sandboxPolicy: { type: "readOnly", networkAccess: false } } : { approvalPolicy: "on-request", approvalsReviewer: "user", sandboxPolicy: { type: "workspaceWrite", writableRoots: [cwd], networkAccess: false, excludeTmpdirEnvVar: false, excludeSlashTmp: false } };
const permissionDefaults = (config: any) => {
  const profile = config?.default_permissions ?? config?.defaultPermissions;
  const sandbox = config?.sandbox_mode ?? config?.sandboxMode;
  const approval = config?.approval_policy ?? config?.approvalPolicy;
  const reviewer = config?.approvals_reviewer ?? config?.approvalsReviewer;
  const customizedReviewer = reviewer != null && reviewer !== "user";
  const workspaceWrite = config?.sandbox_workspace_write ?? config?.sandboxWorkspaceWrite ?? {};
  const roots = workspaceWrite.writable_roots ?? workspaceWrite.writableRoots;
  const customizedWorkspaceWrite = (Array.isArray(roots) && roots.length > 0)
    || (workspaceWrite.network_access ?? workspaceWrite.networkAccess) === true
    || (workspaceWrite.exclude_tmpdir_env_var ?? workspaceWrite.excludeTmpdirEnvVar) === true
    || (workspaceWrite.exclude_slash_tmp ?? workspaceWrite.excludeSlashTmp) === true;
  let mode: "ask" | "full" | "read-only" | "config" = "config";
  if (!customizedReviewer) {
    if (profile === ":danger-full-access" && approval === "never") mode = "full";
    else if (profile === ":read-only" && (approval == null || approval === "on-request")) mode = "read-only";
    else if (profile === ":workspace" && (approval == null || approval === "on-request")) mode = "ask";
    else if (!profile && sandbox === "danger-full-access" && approval === "never") mode = "full";
    else if (!profile && sandbox === "read-only" && (approval == null || approval === "on-request")) mode = "read-only";
    else if (!profile && (sandbox === "workspace-write" || !sandbox) && (approval == null || approval === "on-request") && !customizedWorkspaceWrite) mode = "ask";
  }
  const labels = { ask: "Ask when needed", full: "Full access", "read-only": "Read-only", config: "Custom Codex config" };
  const approvalLabel = typeof approval === "string" ? approval : approval?.granular ? "granular" : "";
  const detail = profile || (customizedWorkspaceWrite ? "sandbox_workspace_write" : customizedReviewer ? `approvals_reviewer=${reviewer}` : [sandbox, approvalLabel].filter(Boolean).join(" + ") || "Codex defaults");
  return { defaultPermission: mode, defaultPermissionLabel: `${labels[mode]}${mode === "config" ? ` (${detail})` : " (config.toml)"}` };
};
const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);
const WEB_UI_CONTEXT_PREFIX = "[Codex Web thread files]";
const threadDirectory = (threadId: string) => `.files/${threadId}/`;
const threadFileContext = (threadId: string, attachmentPaths: string[]) => `${WEB_UI_CONTEXT_PREFIX} This thread's ID is ${threadId}. Keep uploads and standalone files generated for this conversation directly in ${threadDirectory(threadId)} in the current project workspace; do not create input, output, uploads, images, or scratch subdirectories unless the user explicitly asks.${attachmentPaths.length ? ` This turn's uploaded files: ${attachmentPaths.map((file) => JSON.stringify(file)).join(", ")}. Read them from the workspace when needed.` : ""} Keep tool-managed originals and report final paths. Honor an explicit user-specified path. Keep requested project/source edits and required build outputs at their normal project paths. If saving an artifact fails, say so.`;
const visibleUserText = (value: unknown) => {
  const text = String(value || "");
  const marker = text.indexOf(WEB_UI_CONTEXT_PREFIX);
  return marker < 0 ? text : text.slice(0, marker).trimEnd();
};
const timestampMs = (value: unknown) => { const number = Number(value); return Number.isFinite(number) && number > 0 ? (number < 1e12 ? number * 1000 : number) : undefined; };
const threadSummary = (thread: any) => {
  if (!thread || typeof thread !== "object") return thread;
  const { turns: _turns, ...summary } = thread;
  if (typeof summary.preview === "string") summary.preview = visibleUserText(summary.preview);
  return summary;
};

const legacyAttachment = (value: unknown): IncomingAttachment | null => {
  if (typeof value !== "string" || !value.startsWith("Attached file \"")) return null;
  const marker = "\":\n\n"; const end = value.indexOf(marker, 15); if (end < 0) return null;
  const name = value.slice(15, end); return !name || name.length > 200 ? null : { name, mime: "text/plain", kind: "text", data: value.slice(end + marker.length) };
};
const legacyMessage = (content: any[]) => { const text: string[] = []; const attachments: IncomingAttachment[] = []; for (const item of content) { if (item.type !== "text" || String(item.text || "").startsWith(WEB_UI_CONTEXT_PREFIX)) continue; const attachment = legacyAttachment(item.text); attachment ? attachments.push(attachment) : text.push(visibleUserText(item.text)); } return { text: text.join("\n"), attachments }; };
const userMessage = (content: any[], stored?: { prompt: string; attachments: AttachmentSummary[] } | null) => ({
  text: visibleUserText(stored ? stored.prompt : content.filter((item: any) => item.type === "text" && !String(item.text || "").startsWith(WEB_UI_CONTEXT_PREFIX)).map((item: any) => item.text).join("\n")),
  attachments: stored?.attachments || content.filter((item: any) => ["image", "localImage", "audio", "localAudio"].includes(item.type)).map((item: any, index: number) => ({ id: item.id, name: item.path?.split("/").pop() || `Attachment ${index + 1}`, kind: item.type.toLowerCase().includes("audio") ? "audio" : "image", data: item.url?.startsWith("data:") ? item.url : undefined })),
});
const codexAttachmentInput = (attachment: any, filePath: string) => {
  if (attachment.kind === "image") return { type: "image", url: attachment.dataUrl };
  if (attachment.kind === "audio") return { type: "audio", url: attachment.dataUrl };
  if (attachment.kind === "text") return { type: "text", text: `Attached file \"${attachment.name}\":\n\n${attachment.text || ""}`, text_elements: [] };
  return { type: "text", text: `Attached binary file \"${attachment.name}\" (${attachment.mime}, ${attachment.size} bytes) is available at ${filePath}. Read it with a workspace tool if its contents are needed; do not infer its contents from the filename.`, text_elements: [] };
};
const runningTurn = (thread: any) => {
  const turn = thread?.turns?.at(-1);
  const running = thread?.status?.type === "active" || (!thread?.status && turn?.status === "inProgress");
  return { running, turnId: running && turn?.status === "inProgress" ? turn.id : undefined };
};

export class CodexController {
  private pendingApprovals = new Map<string | number, { threadId?: string; item: any }>();
  private models: any[] = [];
  private startedAt: number | null = null;
  private lastError = "";
  private busy = false;
  private activeThreadId = "";
  private activeTurns = new Map<string, string>();
  private runningThreads = new Set<string>();
  private history: HistoryReader;
  private queue: TurnQueue;
  private resourceSample?: { at: number; value: any };
  private resourceRequest?: Promise<any>;
  private lifecycle?: Promise<any[]>;
  private historyRequests = 0;
  private historyTail: Promise<unknown> = Promise.resolve();
  private fileRequests = 0;
  private stateRevision = 0;
  private stateRevisions = new Map<string, number>();

  constructor(private codex: CodexClient, private fs: WorkspaceFs, private attachments: AttachmentStore, private events: EventHub, private meta: () => any) {
    this.history = new HistoryReader(codex);
    this.queue = new TurnQueue((msg, cancelled) => this.startTurn(msg, cancelled), (message) => this.events.push(message), Math.max(1, Math.min(4, Math.floor(Number(process.env.CODEX_WEB_MAX_TURNS)) || 1)), 8, () => [...this.runningThreads].filter((id) => !this.queue.status(id)).length);
    codex.on("status", (status) => {
      if (status === "stopped" || status === "error") { this.runningThreads.clear(); this.activeTurns.clear(); this.pendingApprovals.clear(); this.busy = false; this.startedAt = null; void this.queue.reset(); }
      if (status === "ready") { this.startedAt ||= Date.now(); this.lastError = ""; }
      this.events.push({ type: "status", codexStatus: status, runtime: this.runtime() });
    });
    codex.on("message", (message) => {
      const threadId = message.params?.threadId;
      if (threadId && ["turn/started", "turn/completed", "error", "thread/status/changed"].includes(message.method)) {
        this.stateRevisions.delete(threadId); this.stateRevisions.set(threadId, ++this.stateRevision);
        while (this.stateRevisions.size > 256) this.stateRevisions.delete(this.stateRevisions.keys().next().value!);
      }
      if (threadId && message.method === "turn/started") { this.runningThreads.add(threadId); if (message.params?.turn?.id) this.activeTurns.set(threadId, message.params.turn.id); }
      if (threadId && (message.method === "turn/completed" || (message.method === "error" && !message.params?.willRetry))) { this.runningThreads.delete(threadId); this.activeTurns.delete(threadId); this.queue.completed(threadId); }
      if (threadId && message.method === "thread/status/changed") { if (message.params?.status?.type === "active") this.runningThreads.add(threadId); else { this.runningThreads.delete(threadId); this.activeTurns.delete(threadId); this.queue.pump(); } }
      this.busy = this.runningThreads.size > 0;
      const request = approval(message);
      if (request) { this.pendingApprovals.set(request.requestId, { threadId: message.params?.threadId, item: request }); this.events.push({ type: "items", threadId: message.params?.threadId, items: [request] }); return; }
      if (message.method === "turn/completed" || message.method === "error") for (const [id, entry] of this.pendingApprovals) if (entry.threadId === message.params?.threadId) this.pendingApprovals.delete(id);
      const event = adapt(message); if (event) { if (event.items) { const timestamp = timestampMs(message.params?.completedAtMs ?? message.params?.startedAtMs) || Date.now(); const turnId = event.turnId || message.params?.turnId || message.params?.turn?.id; event.items = event.items.map((item) => ({ ...item, timestamp: item.timestamp || timestamp, ...(turnId ? { turnId: item.turnId || turnId } : {}) })); } this.events.push({ type: "event", ...event }); }
    });
  }

  runtime() { return { status: this.codex.status, pid: this.codex.pid || null, busy: this.busy || this.queue.size > 0, queued: this.queue.queued, maxConcurrentTurns: this.queue.concurrency, startedAt: this.startedAt, lastError: this.lastError }; }

  async start() {
    try { await this.codex.ensureStarted(); this.startedAt = Date.now(); }
    catch (error) { this.lastError = errorMessage(error); throw error; }
  }

  async bootstrap() {
    if (this.codex.status !== "ready") return { ready: false, stage: this.codex.status === "error" ? "error" : "starting", eventCursor: this.events.current, eventInstance: this.events.instance, runtime: this.runtime(), meta: { ...this.meta(), codexStatus: this.codex.status } };
    const eventCursor = this.events.current;
    const [modelResult, threadResult, defaults] = await Promise.all([
      this.models.length ? Promise.resolve({ data: this.models }) : this.codex.request("model/list", { limit: 50, includeHidden: false }),
      this.listThreads(false, null),
      this.readModelDefaults(this.fs.isSelected ? this.fs.path : undefined),
    ]);
    this.models = modelResult.data || this.models;
    return { ready: true, stage: "ready", eventCursor, eventInstance: this.events.instance, runtime: this.runtime(), meta: { ...this.meta(), codexStatus: this.codex.status }, models: this.models, ...defaults, threads: (threadResult.data || []).map((thread: any) => ({ ...threadSummary(thread), queued: this.queue.status(thread.id)?.queued || false })), nextCursor: threadResult.nextCursor || null };
  }

  private async readModelDefaults(cwd?: string) {
    try {
      const result = await this.codex.request("config/read", { includeLayers: false, ...(cwd ? { cwd } : {}) });
      return { defaultModel: String(result?.config?.model || ""), defaultEffort: String(result?.config?.model_reasoning_effort || ""), ...permissionDefaults(result?.config) };
    } catch {
      return { defaultModel: "", defaultEffort: "", ...permissionDefaults(null) };
    }
  }

  private async applyConfiguredPermission(threadId: string, cwd: string) {
    const result = await this.codex.request("config/read", { includeLayers: false, cwd });
    const config = result?.config || {};
    const profile = config.default_permissions ?? config.defaultPermissions;
    const approvalPolicy = config.approval_policy ?? config.approvalPolicy ?? "on-request";
    const approvalsReviewer = config.approvals_reviewer ?? config.approvalsReviewer ?? "user";
    if (typeof profile === "string" && profile) {
      await this.codex.request("thread/settings/update", { threadId, permissions: profile, approvalPolicy, approvalsReviewer });
      return;
    }
    const mode = config.sandbox_mode ?? config.sandboxMode ?? "workspace-write";
    const workspaceWrite = config.sandbox_workspace_write ?? config.sandboxWorkspaceWrite ?? {};
    const roots = Array.isArray(workspaceWrite.writable_roots ?? workspaceWrite.writableRoots) ? (workspaceWrite.writable_roots ?? workspaceWrite.writableRoots) : [];
    const sandboxPolicy = mode === "danger-full-access" ? { type: "dangerFullAccess" }
      : mode === "read-only" ? { type: "readOnly", networkAccess: false }
        : { type: "workspaceWrite", writableRoots: [cwd, ...roots], networkAccess: workspaceWrite.network_access ?? workspaceWrite.networkAccess ?? false, excludeTmpdirEnvVar: workspaceWrite.exclude_tmpdir_env_var ?? workspaceWrite.excludeTmpdirEnvVar ?? false, excludeSlashTmp: workspaceWrite.exclude_slash_tmp ?? workspaceWrite.excludeSlashTmp ?? false };
    await this.codex.request("thread/settings/update", { threadId, approvalPolicy, approvalsReviewer, sandboxPolicy });
  }

  private async listThreads(archived: boolean, cursor: string | null) {
    const since = this.stateRevision;
    const result = await this.codex.request("thread/list", { limit: 50, cursor, sortKey: "updated_at", sortDirection: "desc", archived, sourceKinds });
    for (const thread of result.data || []) {
      if ((this.stateRevisions.get(thread.id) || 0) > since) { thread.status = { type: this.runningThreads.has(thread.id) ? "active" : "idle" }; continue; }
      if (thread.status?.type === "active") this.runningThreads.add(thread.id);
      else if (thread.status) { this.runningThreads.delete(thread.id); this.activeTurns.delete(thread.id); }
    }
    this.busy = this.runningThreads.size > 0;
    this.queue.pump();
    return result;
  }

  private async threadItems(thread: any, rawItems: HistoryEntry[]) {
    const result: any[] = [];
    const sources: string[] = []; const seen = new Set<string>([thread.id]);
    let parent = thread.forkedFromId;
    while (parent && !seen.has(parent) && sources.length < 64) {
      seen.add(parent); sources.push(parent);
      try {
        const source = (await this.codex.request("thread/read", { threadId: parent, includeTurns: false })).thread;
        const scope = await this.fs.scoped(source.cwd); this.attachments.bindThread(parent, scope.path);
        parent = source.forkedFromId;
      } catch { break; }
    }
    for (const { turn, item } of rawItems) {
      if (item.type === "userMessage") {
        let attachmentThreadId = thread.id; let stored = await this.attachments.load(thread.id, item.id, turn.id);
        if (!stored) for (const source of sources) { stored = await this.attachments.load(source, item.id, turn.id); if (stored) { attachmentThreadId = source; break; } }
        if (!stored) { const legacy = legacyMessage(item.content || []); if (legacy.attachments.length) try { stored = await this.attachments.save(thread.id, item.id, legacy.text, legacy.attachments); await this.attachments.setTurnId(thread.id, item.id, turn.id); } catch { /* keep original */ } }
        result.push({ type: "user_message", id: item.id, turnId: turn.id, timestamp: timestampMs(turn.startedAt), ...userMessage(item.content || [], stored), ...(stored ? { attachmentThreadId } : {}) });
      } else { const mapped = adapt({ method: "item/completed", params: { threadId: thread.id, turnId: turn.id, item } }); const timestamp = timestampMs(turn.completedAt ?? turn.startedAt); result.push(...(mapped?.items || []).map((entry) => ({ ...entry, turnId: turn.id, timestamp }))); }
    }
    return result;
  }

  async workspaceFor(msg: { threadId?: string; workspace?: string }) {
    const cwd = msg.threadId ? this.attachments.workspaceFor(msg.threadId) : msg.workspace || (this.fs.isSelected ? this.fs.path : "");
    if (!cwd) throw new Error("Workspace is unavailable; reopen the session or choose a folder");
    return this.fs.scoped(cwd);
  }

  private workspaceMeta(scope: WorkspaceFs) {
    return { ...this.meta(), workspace: scope.path, workspaceBase: scope.basePath, workspaceSelected: true };
  }

  private async threadPage(thread: any, cursor?: string) {
    const page = await this.history.read(thread, cursor);
    const eventCursor = this.events.current;
    return { items: await this.threadItems(thread, page.entries), historyCursor: page.cursor, hasEarlier: Boolean(page.cursor), eventCursor };
  }

  private async activate(result: any, since: number) {
    const thread = result.thread; this.activeThreadId = thread.id;
    if ((this.stateRevisions.get(thread.id) || 0) <= since) {
      const turn = runningTurn(thread);
      if (turn.running) this.runningThreads.add(thread.id); else { this.runningThreads.delete(thread.id); this.activeTurns.delete(thread.id); }
      if (turn.turnId) this.activeTurns.set(thread.id, turn.turnId);
    }
    let workspace: any;
    try {
      const scope = await this.fs.scoped(thread.cwd);
      this.attachments.bindThread(thread.id, scope.path);
      if (thread.forkedFromId) this.attachments.bindThread(thread.forkedFromId, scope.path);
      workspace = this.workspaceMeta(scope);
    } catch (error) { workspace = { ...this.meta(), workspace: "", workspaceSelected: false, error: errorMessage(error) }; }
    const [page, defaults] = await Promise.all([this.threadPage(thread), this.readModelDefaults(thread.cwd)]);
    const preview = await this.queue.preview(thread.id);
    const pending = [...this.pendingApprovals.values()].filter((entry) => entry.threadId === thread.id).map((entry) => entry.item);
    this.busy = this.runningThreads.size > 0;
    return { type: "thread.active", thread: threadSummary(thread), workspace, ...defaults, ...page, items: [...page.items, ...(preview && !page.items.some((item) => item.id === preview.id) ? [preview] : []), ...pending], running: this.runningThreads.has(thread.id), queued: this.queue.status(thread.id)?.queued || false, turnId: this.activeTurns.get(thread.id), model: result.model, effort: result.reasoningEffort, eventInstance: this.events.instance };
  }

  private async startTurn(msg: any, cancelled: () => boolean) {
    const threadId = msg.threadId; const messageId = msg.clientUserMessageId;
    const cwd = this.attachments.workspaceFor(threadId);
    if (!cwd) throw new Error("Thread workspace is unavailable; reopen the session");
    if (cancelled()) throw new Error("Turn cancelled");
    if (msg.permission === "config") await this.applyConfiguredPermission(threadId, cwd);
    const persisted = msg.attachments?.length ? await this.attachments.save(threadId, messageId, msg.text, msg.attachments) : null;
    let accepted = false;
    try {
      if (cancelled()) throw new Error("Turn cancelled");
      const input: any[] = msg.text ? [{ type: "text", text: msg.text, text_elements: [] }] : [];
      const paths = persisted?.paths || [];
      for (const [index, attachment] of (persisted?.prepared || []).entries()) input.push(codexAttachmentInput(attachment, paths[index]));
      input.push({ type: "text", text: threadFileContext(threadId, paths), text_elements: [] });
      const result = await this.codex.request("turn/start", { threadId, input, clientUserMessageId: messageId, model: msg.model || null, effort: msg.effort || null, ...turnPermissionSettings(msg.permission, cwd), summary: "auto" });
      accepted = true;
      if (cancelled()) { await this.codex.request("turn/interrupt", { threadId, turnId: result.turn.id }).catch(() => {}); throw new Error("Turn interrupted"); }
      const running = this.queue.status(threadId) !== null && result.turn.status !== "completed" && result.turn.status !== "failed" && result.turn.status !== "interrupted";
      if (running) { this.runningThreads.add(threadId); this.activeTurns.set(threadId, result.turn.id); this.busy = true; }
      if (persisted) await this.attachments.setTurnId(threadId, messageId, result.turn.id).catch(() => {});
      return { type: "turn.accepted", running, threadId, turnId: result.turn.id, messageId, attachments: persisted?.attachments || [] };
    } catch (error) { if (persisted && !accepted) await this.attachments.removeMessage(threadId, messageId); throw error; }
  }

  async handle(msg: any): Promise<any[]> {
    if (!msg || typeof msg !== "object" || typeof msg.type !== "string") return [{ type: "error", message: "Invalid action" }];
    const hydration = ["thread.resume", "thread.history", "thread.fork"].includes(msg.type);
    let messages: any[];
    if (hydration) {
      if (this.historyRequests >= 4) return [{ type: "error", action: msg.type, requestId: msg.requestId, message: "History is busy loading; retry shortly" }];
      this.historyRequests++;
      const queuedAt = Date.now();
      const work = this.historyTail.then(() => Date.now() - queuedAt > 30_000 ? [{ type: "error", message: "History is busy loading; retry shortly" }] : this.handleAction(msg)); this.historyTail = work.catch(() => {});
      try { messages = await work; } finally { this.historyRequests--; }
    } else if (["fs.read", "fs.write", "fs.upload"].includes(msg.type)) {
      if (this.fileRequests >= 2) messages = [{ type: "error", error: "File service is busy; retry shortly", message: "File service is busy; retry shortly" }];
      else { this.fileRequests++; try { messages = await this.handleAction(msg); } finally { this.fileRequests--; } }
    } else messages = await this.handleAction(msg);
    return messages.map((message) => ({ ...message, requestId: message.requestId ?? msg.requestId, action: message.action ?? msg.type, requestThreadId: msg.threadId }));
  }

  private async handleAction(msg: any): Promise<any[]> {
    try {
      if (msg.type === "thread.list") { const result = await this.listThreads(Boolean(msg.archived), typeof msg.cursor === "string" ? msg.cursor : null); return [{ type: "threads", archived: Boolean(msg.archived), append: Boolean(msg.cursor), refresh: Boolean(msg.refresh), threads: (result.data || []).map((thread: any) => ({ ...threadSummary(thread), queued: this.queue.status(thread.id)?.queued || false })), nextCursor: result.nextCursor || null }]; }
      if (msg.type === "model.list") { const [result, defaults] = await Promise.all([this.codex.request("model/list", { limit: 50, includeHidden: false }), this.readModelDefaults(this.fs.isSelected ? this.fs.path : undefined)]); this.models = result.data || []; return [{ type: "models", models: this.models, ...defaults }]; }
      if (msg.type === "thread.create") {
        const scope = await this.workspaceFor({ workspace: msg.workspace });
        const result = await this.codex.request("thread/start", { cwd: scope.path, model: msg.model || null, ...threadPermissionSettings(msg.permission), experimentalRawEvents: false });
        this.attachments.bindThread(result.thread.id, result.thread.cwd || scope.path);
        this.activeThreadId = result.thread.id;
        const thread = threadSummary(result.thread);
        return [{ type: "thread.active", thread, workspace: this.workspaceMeta(scope), items: [], historyCursor: null, hasEarlier: false, model: result.model, effort: result.reasoningEffort }, { type: "thread.changed", thread }];
      }
      if (msg.type === "thread.resume") { const since = this.stateRevision; return [await this.activate(await this.codex.request("thread/resume", { threadId: msg.threadId, excludeTurns: true }), since)]; }
      if (msg.type === "thread.fork") {
        const lastTurnId = typeof msg.turnId === "string" ? msg.turnId.trim() : "";
        if (!lastTurnId) throw new Error("Choose a Codex response to branch from");
        const since = this.stateRevision;
        const result = await this.codex.request("thread/fork", { threadId: msg.threadId, lastTurnId, excludeTurns: true });
        return [await this.activate(result, since), { type: "thread.changed", thread: threadSummary(result.thread) }];
      }
      if (msg.type === "thread.history") {
        const result = await this.codex.request("thread/read", { threadId: msg.threadId, includeTurns: false });
        return [{ type: "history.items", threadId: msg.threadId, ...await this.threadPage(result.thread, msg.before) }];
      }
      if (msg.type === "thread.archive") { if (this.queue.status(msg.threadId) || this.runningThreads.has(msg.threadId)) throw new Error("Stop the task before archiving this thread"); await this.codex.request("thread/archive", { threadId: msg.threadId }); if (this.activeThreadId === msg.threadId) this.activeThreadId = ""; return [{ type: "thread.mutated", action: "archive", threadId: msg.threadId }]; }
      if (msg.type === "thread.unarchive") { const result = await this.codex.request("thread/unarchive", { threadId: msg.threadId }); return [{ type: "thread.mutated", action: "unarchive", threadId: msg.threadId, thread: threadSummary(result.thread) }]; }
      if (msg.type === "thread.delete") { if (this.queue.status(msg.threadId) || this.runningThreads.has(msg.threadId)) throw new Error("Stop the task before deleting this thread"); await this.codex.request("thread/delete", { threadId: msg.threadId }); await this.attachments.removeThread(String(msg.threadId || "")); if (this.activeThreadId === msg.threadId) this.activeThreadId = ""; return [{ type: "thread.mutated", action: "delete", threadId: msg.threadId }]; }
      if (msg.type === "turn.send") {
        if (this.codex.status !== "ready") throw new Error("Codex is not ready");
        const text = String(msg.text || "").trim(); const inputs = Array.isArray(msg.attachments) ? msg.attachments : [];
        if (!text && !inputs.length) return [];
        if (inputs.length > 4) throw new Error("At most four attachments are allowed");
        const threadId = String(msg.threadId || "");
        const messageId = typeof msg.clientUserMessageId === "string" && /^[A-Za-z0-9_-]{1,160}$/.test(msg.clientUserMessageId) ? msg.clientUserMessageId : crypto.randomUUID();
        const receipt = this.queue.receipt(threadId, messageId); if (receipt) return [receipt];
        if (this.runningThreads.has(threadId) || this.activeTurns.has(threadId)) throw new Error("This thread is still running; stop or wait for the current turn");
        if (!this.attachments.workspaceFor(threadId)) throw new Error("Thread workspace is unavailable; resume the thread before sending");
        return [await this.queue.submit({ ...msg, text, threadId, clientUserMessageId: messageId })];
      }
      if (msg.type === "turn.interrupt") {
        const threadId = String(msg.threadId || "");
        if (await this.queue.cancel(threadId)) return [];
        let turnId = this.activeTurns.get(threadId) || msg.turnId;
        if (!turnId) {
          try { const turns = await this.codex.request("thread/turns/list", { threadId, limit: 1, sortDirection: "desc" }); turnId = turns.data?.find((turn: any) => turn.status === "inProgress")?.id; }
          catch (error) {
            if ((error as any)?.code !== -32601 && !/unknown.*(method|variant)|method.*(not found|unsupported)/i.test(String(error))) throw error;
            const result = await this.codex.request("thread/read", { threadId, includeTurns: true }); turnId = runningTurn(result.thread).turnId;
          }
        }
        if (!turnId) throw new Error("No active turn to stop. Reopen the session to refresh its state.");
        await this.codex.request("turn/interrupt", { threadId, turnId }); return [];
      }
      if (msg.type === "approval.respond") {
        const entry = this.pendingApprovals.get(msg.approvalId);
        if (!entry || entry.threadId !== msg.threadId) throw new Error("This approval is no longer pending in this thread");
        if (!entry.item.decisions.some((decision: any) => JSON.stringify(decision) === JSON.stringify(msg.decision))) throw new Error("Invalid approval decision");
        this.codex.respond(msg.approvalId, { decision: msg.decision }); this.pendingApprovals.delete(msg.approvalId);
        const key = typeof msg.decision === "string" ? msg.decision : Object.keys(msg.decision)[0];
        const result = { type: "items", threadId: msg.threadId, items: [{ ...entry.item, status: key === "decline" || key === "cancel" ? "denied" : "approved" }] };
        this.events.push(result); return [result];
      }
      const scope = msg.type.startsWith("fs.") ? await this.workspaceFor(msg) : this.fs;
      if (msg.type === "fs.list") return [{ type: "fs.entries", path: msg.path || "", entries: await scope.list(msg.path || "") }];
      if (msg.type === "fs.search") return [{ type: "fs.search", ...await scope.search(String(msg.query || "")) }];
      if (msg.type === "fs.read") return [{ type: "fs.file", path: msg.path, file: await scope.read(msg.path) }];
      if (msg.type === "fs.write") return [{ type: "fs.saved", path: msg.path, file: await scope.write(msg.path, String(msg.content ?? ""), msg.revision) }];
      if (msg.type === "fs.create") return [{ type: "fs.created", requestId: msg.requestId, file: await scope.create(String(msg.directory || ""), String(msg.name || "")) }];
      if (msg.type === "fs.delete") return [{ type: "fs.deleted", requestId: msg.requestId, file: await scope.delete(String(msg.path || "")) }];
      if (msg.type === "fs.upload") return [{ type: "fs.uploaded", requestId: msg.requestId, file: await scope.upload(String(msg.directory || ""), String(msg.name || ""), String(msg.data || "")) }];
      if (msg.type === "workspace.list") return [{ type: "workspace.entries", path: msg.path || "", entries: await this.fs.listWorkspaces(msg.path || ""), base: this.fs.basePath, current: this.fs.path }];
      if (msg.type === "workspace.select") { const selectedScope = await this.fs.scoped(this.fs.basePath); const selected = await selectedScope.select(msg.path || ""); const defaults = await this.readModelDefaults(selectedScope.path); return [{ type: "workspace.selected", ...selected, ...this.workspaceMeta(selectedScope), ...defaults }]; }
      if (msg.type === "system.usage") {
        if (!this.resourceSample || Date.now() - this.resourceSample.at > 2000) {
          this.resourceRequest ||= processTreeMemory(process.pid, this.codex.pid).then((tree) => {
            const memory = process.memoryUsage();
            this.resourceSample = { at: Date.now(), value: { rss: memory.rss, heapUsed: memory.heapUsed, heapTotal: memory.heapTotal, heapLimit: v8.getHeapStatistics().heap_size_limit, external: memory.external, ...tree, totalRss: memory.rss + (tree.codexRss || 0) + (tree.childRss || 0), uptime: process.uptime(), eventBytes: this.events.retainedBytes, queued: this.queue.queued } };
          }).finally(() => { this.resourceRequest = undefined; });
          await this.resourceRequest;
        }
        return [{ type: "system.usage", usage: this.resourceSample!.value }];
      }
      if (msg.type === "account.usage") { const [usage, limits] = await Promise.allSettled([this.codex.request("account/usage/read"), this.codex.request("account/rateLimits/read")]); return [{ type: "account.usage", usage: usage.status === "fulfilled" ? usage.value : null, rateLimits: limits.status === "fulfilled" ? limits.value : null, unavailable: usage.status === "rejected" && limits.status === "rejected" }]; }
      if (["runtime.restart", "runtime.stop", "runtime.start"].includes(msg.type)) {
        if (this.lifecycle) throw new Error("A runtime operation is already in progress");
        this.lifecycle = (async () => {
          if (msg.type !== "runtime.start") { await this.codex.stop(); await this.queue.reset(); this.runningThreads.clear(); this.activeTurns.clear(); this.pendingApprovals.clear(); this.busy = false; this.startedAt = null; this.models = []; }
          if (msg.type !== "runtime.stop") await this.start();
          return [{ type: "status", codexStatus: this.codex.status, runtime: this.runtime() }];
        })();
        try { return await this.lifecycle; } finally { this.lifecycle = undefined; }
      }
      throw new Error(`Unsupported action: ${msg.type || "unknown"}`);
    } catch (error) {
      const message = errorMessage(error);
      if (msg.type === "fs.list") return [{ type: "fs.entries", path: msg.path || "", error: message }];
      if (msg.type === "fs.read") return [{ type: "fs.file", path: msg.path, error: message }];
      if (msg.type === "fs.write") return [{ type: "fs.saved", path: msg.path, error: message }];
      if (msg.type === "fs.upload") return [{ type: "fs.uploaded", requestId: msg.requestId, error: message }];
      if (msg.type === "fs.create") return [{ type: "fs.created", requestId: msg.requestId, error: message }];
      if (msg.type === "fs.delete") return [{ type: "fs.deleted", requestId: msg.requestId, error: message }];
      if (msg.type === "workspace.list") return [{ type: "workspace.entries", path: msg.path || "", entries: [], error: message, base: this.fs.basePath, current: this.fs.path }];
      return [{ type: "error", requestId: msg.requestId, threadId: msg.threadId, messageId: msg.clientUserMessageId, message }];
    }
  }
}
