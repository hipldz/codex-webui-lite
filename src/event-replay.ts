export type EventPosition = { instance: string; cursor: number };
type StreamEvent = EventPosition & {
  message: { type: string; threadId?: string; thread?: { id: string } };
};
const snapshotTypes = new Set([
  "items",
  "event",
  "thread.changed",
  "turn.queued",
  "turn.accepted",
  "turn.failed",
]);

export function includedInSnapshot(
  event: StreamEvent,
  snapshots: ReadonlyMap<string, EventPosition>,
) {
  const threadId = event.message.threadId || event.message.thread?.id;
  const snapshot = threadId ? snapshots.get(threadId) : undefined;
  return Boolean(
    snapshot?.instance === event.instance &&
    event.cursor <= snapshot.cursor &&
    snapshotTypes.has(event.message.type),
  );
}
