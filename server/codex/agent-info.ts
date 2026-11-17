export type AgentStatus = "running" | "idle" | "completed" | "failed" | "interrupted" | "unknown";

export type AgentThread = {
  id: string;
  name: string;
  task: string;
  status: AgentStatus;
  waiting?: string;
  archived: boolean;
};

export type AgentResult = {
  status: AgentStatus;
  text: string;
  error?: string;
  truncated?: boolean;
};

// A user-created fork is an ordinary session. Only explicit spawn metadata
// identifies a sub-agent; forkedFromId and sessionId cannot establish this.
export function agentParentId(thread: {
  parentThreadId?: unknown;
  source?: unknown;
}): string | null {
  if (typeof thread.parentThreadId === "string" && thread.parentThreadId)
    return thread.parentThreadId;
  const source = thread.source as any;
  const parent = (source?.subAgent || source?.subagent)?.thread_spawn?.parent_thread_id;
  return typeof parent === "string" && parent ? parent : null;
}

export function agentThread(thread: any, archived = false): AgentThread {
  const status = typeof thread.status === "string" ? thread.status : thread.status?.type;
  const flags: string[] = thread.status?.activeFlags || [];
  return {
    id: thread.id,
    name: thread.agentNickname || thread.name || thread.agentRole || "Agent",
    task: String(thread.preview || "").slice(0, 2048),
    status:
      status === "active"
        ? "running"
        : status === "systemError"
          ? "failed"
          : status === "idle" || status === "notLoaded"
            ? "idle"
            : "unknown",
    waiting: flags.includes("waitingOnApproval")
      ? "Waiting for approval"
      : flags.includes("waitingOnUserInput")
        ? "Waiting for your answer"
        : undefined,
    archived,
  };
}
