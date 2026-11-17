import type { CodexClient } from "./codex/client.js";
import { agentParentId, agentThread, type AgentResult } from "./codex/agent-info.js";

const sourceKinds = ["subAgent", "subAgentThreadSpawn", "subAgentOther"];
const unsupported = (error: unknown) =>
  (error as any)?.code === -32601 ||
  /method.*(not found|unknown|unsupported)|unknown.*(method|variant)/i.test(String(error));

/** Inspection uses reads only: never resume a child, subscribe, or change the active session. */
export async function listAgents(
  codex: CodexClient,
  parentId: string,
  known: Array<{ thread: any; archived: boolean }> = [],
) {
  const pages = await Promise.allSettled(
    [true, false].map((archived) =>
      codex.request("thread/list", {
        parentThreadId: parentId,
        sourceKinds,
        modelProviders: [],
        archived,
        limit: 50,
        sortKey: "created_at",
        sortDirection: "desc",
      }),
    ),
  );
  const entries = new Map<string, ReturnType<typeof agentThread>>();
  const add = (thread: any, archived: boolean) => {
    // Older servers may silently ignore an unknown parentThreadId filter.
    if (thread?.id && thread.id !== parentId && agentParentId(thread) === parentId)
      entries.set(thread.id, agentThread(thread, archived));
  };
  // Include live, ephemeral children already observed through normal events.
  for (const entry of known) add(entry.thread, entry.archived);
  for (const [index, page] of pages.entries())
    if (page.status === "fulfilled")
      for (const thread of page.value.data || []) add(thread, index === 0);
  const failed = pages.some((page) => page.status === "rejected");
  if (pages.every((page) => page.status === "rejected") && !entries.size)
    throw (pages[0] as PromiseRejectedResult).reason;
  return {
    agents: [...entries.values()],
    hasMore: pages.some((page) => page.status === "fulfilled" && page.value.nextCursor),
    warning: failed ? "Some agents could not be loaded. Refresh to retry." : undefined,
  };
}

export async function readAgentResult(
  codex: CodexClient,
  parentId: string,
  agentId: string,
): Promise<AgentResult> {
  const { thread } = await codex.request("thread/read", { threadId: agentId, includeTurns: false });
  if (!thread || agentParentId(thread) !== parentId || agentId === parentId)
    throw new Error("This agent does not belong to the current session");

  let turn: any;
  try {
    const page = await codex.request("thread/turns/list", {
      threadId: agentId,
      limit: 1,
      sortDirection: "desc",
      itemsView: "notLoaded",
    });
    turn = page.data?.[0];
  } catch (error) {
    if (!unsupported(error)) throw error;
    const full = await codex.request("thread/read", { threadId: agentId, includeTurns: true });
    turn = full.thread?.turns?.at(-1);
  }
  const runtime = agentThread(thread).status;
  const status =
    turn?.status === "inProgress" || runtime === "running"
      ? "running"
      : turn?.status === "completed"
        ? "completed"
        : turn?.status === "failed"
          ? "failed"
          : turn?.status === "interrupted"
            ? "interrupted"
            : runtime;
  if (status !== "running" && turn?.id && !turn.items?.length) {
    try {
      let cursor: string | null = null;
      for (let pageNumber = 0; pageNumber < 4; pageNumber++) {
        const page = await codex.request("thread/items/list", {
          threadId: agentId,
          turnId: turn.id,
          limit: 30,
          sortDirection: "desc",
          cursor,
        });
        const messages = (page.data || [])
          .filter((entry: any) => entry.turnId === turn.id && entry.item?.type === "agentMessage")
          .map((entry: any) => entry.item)
          .reverse();
        turn.items = [...messages, ...(turn.items || [])];
        if (messages.some((item: any) => item.phase === "final_answer" || !item.phase)) break;
        cursor = page.nextCursor || null;
        if (!cursor) break;
        if (pageNumber === 3) throw new Error("The final result could not be loaded completely");
      }
    } catch (error) {
      if (!unsupported(error)) throw error;
      const full = await codex.request("thread/read", { threadId: agentId, includeTurns: true });
      turn = full.thread?.turns?.find((entry: any) => entry.id === turn.id);
    }
  }
  // A commentary message is not a final result, nor is a final from an older turn.
  const messages: any[] = turn?.items?.filter((item: any) => item.type === "agentMessage") || [];
  const final = messages.filter((item) => item.phase === "final_answer");
  const legacy = messages.filter((item) => !item.phase).at(-1);
  const text =
    status === "running" ? "" : final.map((item) => item.text).join("\n\n") || legacy?.text || "";
  return {
    status,
    text: text.slice(0, 65536),
    truncated: text.length > 65536 || undefined,
    error: turn?.error?.message,
  };
}
