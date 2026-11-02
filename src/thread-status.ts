import type { Thread, UiItem } from "./types";

export const threadIsRunning = (thread: Pick<Thread, "status" | "queued">) =>
  Boolean(thread.queued) || (typeof thread.status === "object" && thread.status?.type === "active");

type TurnPhase = "idle" | "queued" | "starting" | "working" | "responding" | "waiting";

export function getTurnProgress({
  items,
  running,
  queued,
  turnId,
}: {
  items: UiItem[];
  running: boolean;
  queued: boolean;
  turnId?: string;
}): { phase: TurnPhase; items: UiItem[] } {
  if (!running && !queued) return { phase: "idle", items: [] };

  const lastUserIndex = items.reduce(
    (last, item, index) => (item.type === "user_message" ? index : last),
    -1,
  );
  // Live events carry turn IDs. Older histories and optimistic user messages
  // can omit them; only use those after the latest user message as a fallback.
  const currentItems = items.filter((item, index) =>
    turnId && item.turnId ? item.turnId === turnId : index >= lastUserIndex,
  );
  let phase: TurnPhase;
  if (queued) phase = "queued";
  else if (
    currentItems.some(
      (item) =>
        (item.type === "approval" && item.status === "pending") ||
        (item.type === "question" && item.status === "pending" && item.blocking),
    )
  )
    phase = "waiting";
  else if (
    currentItems.some(
      (item) =>
        (item.type === "assistant_message" && item.streaming && item.phase !== "commentary") ||
        (item.type === "plan" && item.streaming),
    )
  )
    phase = "responding";
  else if (turnId || currentItems.some((item) => item.type !== "user_message")) phase = "working";
  else phase = "starting";
  return { phase, items: currentItems };
}
