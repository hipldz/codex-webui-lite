import type { JsonRpcMessage, UiItem } from "./protocol.js";

const MAX_TOOL_OUTPUT = 64 * 1024;
const MAX_DIFF_OUTPUT = 256 * 1024;
const clip = (value: string, limit = MAX_TOOL_OUTPUT) => value.length <= limit ? value : `${value.slice(0, limit)}\n\n… ${value.length - limit} characters omitted`;
const diffFor = (changes: any[]) => clip(changes?.map((c) => c.diff || c.patch || c.content || "").filter(Boolean).join("\n") || "", MAX_DIFF_OUTPUT);
const pathFor = (change: any) => change?.path || change?.file_path || change?.move_path || "Changed files";
const details = (value: any) => clip(value == null ? "" : typeof value === "string" ? value : JSON.stringify(value, null, 2));
const status = (id: string, title: string, detail?: string, tone: "info" | "success" | "warning" = "info") => ({ type: "status" as const, id, title, detail, tone });
const itemActivity = (item: any, done: boolean): UiItem[] => {
  const state = done ? "done" : "running";
  if (item.type === "plan") return [status(item.id, "Plan updated", item.text)];
  if (item.type === "webSearch") return [{ type: "command", id: item.id, command: `Web search · ${item.query || item.searchQuery || "Search"}`, output: details(item.results || item), status: state }];
  if (item.type === "imageView") return [{ type: "file_read", id: item.id, path: item.path || "Image" }];
  if (item.type === "imageGeneration") {
    const src = item.savedPath || item.imageUrl || item.image_url || item.url || (typeof item.result === "object" ? item.result?.image_url || item.result?.url : "");
    if (typeof src === "string" && src) return [{ type: "generated_image", id: item.id, src, alt: item.prompt || "Generated image" }];
    const output = details({ status: item.status, failure: item.failure, revisedPrompt: item.revisedPrompt });
    return [{ type: "command", id: item.id, command: "Generated image", output, status: item.status === "failed" ? "error" : state }];
  }
  if (item.type === "sleep") return [status(item.id, "Waiting", item.reason || item.duration || "")];
  if (item.type === "collabAgentToolCall") return [{ type: "command", id: item.id, command: `Agent collaboration · ${item.tool}`, output: details({ prompt: item.prompt, agents: item.agentsStates, model: item.model }), status: state }];
  if (item.type === "subAgentActivity") return [status(item.id, `Sub-agent · ${item.kind}`, item.agentPath)];
  if (item.type === "enteredReviewMode" || item.type === "exitedReviewMode") return [status(item.id, item.type === "enteredReviewMode" ? "Entered review mode" : "Exited review mode", item.review)];
  if (item.type === "hookPrompt") return [status(item.id, "Hook prompt", details(item.fragments))];
  return [];
};

export function adapt(message: JsonRpcMessage): { threadId?: string; items?: UiItem[]; running?: boolean; turnId?: string; threadStatus?: { type: string; activeFlags?: string[] }; diff?: string; tokenUsage?: any; compaction?: { status: "running" | "completed"; at?: number } } | null {
  const p = message.params || {}; const item = p.item || {};
  if (message.method === "thread/status/changed") return { threadId: p.threadId, threadStatus: p.status };
  if (message.method === "turn/diff/updated") return { threadId: p.threadId, turnId: p.turnId, diff: clip(p.diff || "", MAX_DIFF_OUTPUT) };
  if (message.method === "thread/tokenUsage/updated") return { threadId: p.threadId, turnId: p.turnId, tokenUsage: p.tokenUsage };
  if (message.method === "thread/compacted") return { threadId: p.threadId, turnId: p.turnId, compaction: { status: "completed", at: Date.now() }, items: [status(`compaction-${p.turnId}`, "Context automatically compacted", "Older conversation context was summarized.", "success")] };
  if (message.method === "turn/plan/updated") return { threadId: p.threadId, turnId: p.turnId, items: [status(`plan-${p.turnId}`, "Plan updated", (p.plan || []).map((step: any) => `${step.status === "completed" ? "✓" : step.status === "in_progress" ? "•" : "○"} ${step.step}`).join("\n"))] };
  if (message.method === "hook/started" || message.method === "hook/completed") return { threadId: p.threadId, turnId: p.turnId, items: [status(`hook-${p.run?.id || p.turnId}`, `${message.method === "hook/started" ? "Running" : "Completed"} hook`, p.run?.statusMessage || p.run?.eventName, message.method === "hook/completed" ? "success" : "info")] };
  if (message.method === "model/rerouted") return { threadId: p.threadId, turnId: p.turnId, items: [status(`reroute-${p.turnId}`, `Model switched to ${p.toModel}`, p.reason, "warning")] };
  if (message.method === "model/safetyBuffering/updated" && p.showBufferingUi) return { threadId: p.threadId, turnId: p.turnId, items: [status(`buffering-${p.turnId}`, "Response is being safety checked", p.reasons?.join(" · ") || "Codex will continue when ready.")] };
  if (message.method === "warning" || message.method === "guardianWarning" || message.method === "configWarning") return { threadId: p.threadId, turnId: p.turnId, items: [status(`warning-${Date.now()}`, "Codex warning", p.message || p.warning || details(p), "warning")] };
  if (message.method === "item/agentMessage/delta") return { threadId: p.threadId, items: [{ type: "assistant_message", id: p.itemId, text: p.delta || "", streaming: true, delta: true }] };
  if (message.method === "item/reasoning/summaryTextDelta" || message.method === "item/reasoning/textDelta") return { threadId: p.threadId, items: [{ type: "thinking", id: p.itemId, text: p.delta || "", status: "running", delta: true }] };
  if (message.method === "item/commandExecution/outputDelta") return { threadId: p.threadId, items: [{ type: "command", id: p.itemId, command: "", output: p.delta || "", status: "running" }] };
  if (message.method === "item/mcpToolCall/progress") return { threadId: p.threadId, items: [{ type: "command", id: p.itemId, command: "", output: p.message || "", status: "running" }] };
  if (message.method === "item/fileChange/outputDelta") return { threadId: p.threadId, items: [{ type: "command", id: p.itemId, command: "Editing files", output: p.delta || "", status: "running" }] };
  if (message.method === "item/fileChange/patchUpdated") return { threadId: p.threadId, items: (p.changes || []).map((c: any, i: number) => ({ type: "file_change", id: `${p.itemId}-${i}`, path: pathFor(c), diff: diffFor([c]), status: "running" })) };
  if (message.method === "turn/started") return { threadId: p.threadId, running: true, turnId: p.turn?.id };
  if (message.method === "turn/completed") return { threadId: p.threadId, running: false, turnId: p.turn?.id };
  if (message.method === "error" && p.willRetry) return { threadId: p.threadId, items: [status(`retry-${p.turnId}`, "Retrying connection", p.error?.message || p.message, "warning")] };
  if (message.method === "error") return { threadId: p.threadId, running: false, items: [{ type: "error", id: `error-${Date.now()}`, message: p.error?.message || p.message || "Codex error" }] };
  if (message.method === "item/started" || message.method === "item/completed") {
    const done = message.method === "item/completed";
    if (item.type === "contextCompaction") return { threadId: p.threadId, turnId: p.turnId, compaction: { status: done ? "completed" : "running", at: done ? Date.now() : undefined }, items: done ? [status(`compaction-${p.turnId}`, "Context automatically compacted", "Older conversation context was summarized.", "success")] : [status(`compaction-${p.turnId}`, "Compacting context…", "Summarizing older conversation context.")] };
    if (item.type === "agentMessage") return { threadId: p.threadId, items: [{ type: "assistant_message", id: item.id, text: item.text || "", streaming: !done }] };
    if (item.type === "reasoning") return { threadId: p.threadId, items: [{ type: "thinking", id: item.id, text: clip([...(item.summary || []), ...(item.content || [])].join("\n")), status: done ? "done" : "running" }] };
    if (item.type === "commandExecution") return { threadId: p.threadId, items: [{ type: "command", id: item.id, command: item.command || "Command", output: clip(item.aggregatedOutput || ""), status: done ? (item.status === "failed" ? "error" : "done") : "running" }] };
    if (item.type === "fileChange") return { threadId: p.threadId, items: (item.changes || []).map((c: any, i: number) => ({ type: "file_change", id: `${item.id}-${i}`, path: pathFor(c), diff: diffFor([c]), status: item.status })) };
    if (item.type === "mcpToolCall" || item.type === "dynamicToolCall") return { threadId: p.threadId, items: [{ type: "command", id: item.id, command: `${item.server || item.namespace || "tool"} · ${item.tool}`, output: details(item.result), status: done ? (item.error ? "error" : "done") : "running" }] };
    const activity = itemActivity(item, done); if (activity.length) return { threadId: p.threadId, turnId: p.turnId, items: activity };
  }
  return null;
}

export function approval(message: JsonRpcMessage): Extract<UiItem, { type: "approval" }> | null {
  const p = message.params || {};
  if (message.id === undefined) return null;
  if (message.method === "item/commandExecution/requestApproval") return { type: "approval", id: `approval-${message.id}`, requestId: message.id, description: p.command || p.reason || "Run command", status: "pending", decisions: p.availableDecisions || ["accept", "acceptForSession", "decline"], approvalKind: "command" };
  if (message.method === "item/fileChange/requestApproval") return { type: "approval", id: `approval-${message.id}`, requestId: message.id, description: p.reason || `Modify files${p.grantRoot ? ` under ${p.grantRoot}` : ""}`, status: "pending", decisions: ["accept", "acceptForSession", "decline"], approvalKind: "file" };
  return null;
}
