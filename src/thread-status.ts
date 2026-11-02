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

export function getBranchableResponseIds({
  items,
  running,
  queued,
  turnId,
}: {
  items: UiItem[];
  running: boolean;
  queued: boolean;
  turnId?: string;
}): Set<string> {
  // A finished message can still belong to a running turn. Exclude that
  // entire turn, while keeping earlier turns available during work or queuing.
  const activeTurns = new Set(
    running && !queued
      ? getTurnProgress({ items, running, queued, turnId }).items.map((item) => item.turnId)
      : [],
  );
  const result = new Set<string>();
  const turns = new Set<string>();
  for (let index = items.length - 1; index >= 0; index--) {
    const item = items[index];
    if (
      (item.type !== "assistant_message" && item.type !== "generated_image") ||
      !item.turnId ||
      turns.has(item.turnId)
    )
      continue;
    turns.add(item.turnId);
    if (activeTurns.has(item.turnId) || (item.type === "assistant_message" && item.streaming))
      continue;
    result.add(item.id);
  }
  return result;
}
