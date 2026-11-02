import type { Thread } from "./types";

export const mergeThreadSummary = (
  previous: Thread | null | undefined,
  incoming: Thread,
): Thread => ({
  ...previous,
  ...incoming,
  preview: incoming.preview || previous?.preview || "",
});

export function mergeThreadList(
  previous: Thread[],
  incoming: Thread[],
  mode: "replace" | "refresh" | "append",
): Thread[] {
  const existing = new Map(previous.map((thread) => [thread.id, thread]));
  const updates = new Map<string, Thread>();
  for (const thread of incoming)
    updates.set(
      thread.id,
      mergeThreadSummary(updates.get(thread.id) || existing.get(thread.id), thread),
    );
  if (mode === "replace") return [...updates.values()];

  // Background updates keep existing rows in place, including loaded history pages.
  const retained = [...existing.values()].map((thread) => updates.get(thread.id) || thread);
  const added = [...updates.values()].filter((thread) => !existing.has(thread.id));
  return mode === "append" ? [...retained, ...added] : [...added, ...retained];
}
