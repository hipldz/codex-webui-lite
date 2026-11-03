import type { CodexClient } from "./codex/client.js";

export type HistoryEntry = {
  turn: any;
  item: any;
  startedAtMs?: number;
  completedAtMs?: number;
};
type TurnTiming = {
  id: string;
  startedAt: number | null;
  completedAt: number | null;
  durationMs: number | null;
};
type TimingPage = { data: TurnTiming[]; nextCursor: string | null };
type Cursor =
  { kind: "native"; value: string; timing?: TimingPage } | { kind: "legacy"; before: number };
const PAGE_SIZE = 30;
const encode = (cursor: Cursor) => Buffer.from(JSON.stringify(cursor)).toString("base64url");
function decode(value?: string): Cursor | undefined {
  if (!value) return;
  if (value.length > 8192) throw new Error("Invalid history cursor");
  const result = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  if (result.kind === "native" && typeof result.value === "string") {
    const timing = result.timing;
    if (
      timing !== undefined &&
      (!Array.isArray(timing.data) ||
        timing.data.length > PAGE_SIZE ||
        !(timing.nextCursor === null || typeof timing.nextCursor === "string") ||
        !timing.data.every(
          (turn: any) =>
            turn &&
            typeof turn.id === "string" &&
            [turn.startedAt, turn.completedAt, turn.durationMs].every(
              (value) =>
                value === null ||
                (typeof value === "number" && Number.isFinite(value) && value >= 0),
            ),
        ))
    )
      throw new Error("Invalid history cursor");
    return result;
  }
  if (result.kind === "legacy" && Number.isSafeInteger(result.before) && result.before >= 0)
    return result;
  throw new Error("Invalid history cursor");
}

/** Keep no session histories in memory. Serialize hydration for small hosts. */
export class HistoryReader {
  private nativeSupported = true;
  private timingSupported = true;
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private codex: CodexClient) {}
  read(thread: any, before?: string): Promise<{ entries: HistoryEntry[]; cursor: string | null }> {
    const work = this.tail.then(() => this.readPage(thread, decode(before)));
    this.tail = work.catch(() => {});
    return work;
  }
  private async readPage(thread: any, cursor?: Cursor) {
    if (this.nativeSupported && cursor?.kind !== "legacy") {
      try {
        const page = await this.codex.request("thread/items/list", {
          threadId: thread.id,
          limit: PAGE_SIZE,
          sortDirection: "desc",
          cursor: cursor?.value || null,
        });
        if (!Array.isArray(page.data)) throw new Error("Invalid item history response");
        // Item timestamps describe individual tools/messages. Read turn summaries
        // without items for the actual task duration, carrying the timing page
        // in the history cursor so older pages never rescan the entire thread.
        let timing = cursor?.kind === "native" ? cursor.timing : undefined;
        let lastMatchedTiming: TimingPage | undefined;
        let timingPages = 0;
        const turns = new Map<string, TurnTiming>();
        const missing = new Set<string>(page.data.map((entry: any) => entry.turnId));
        while (this.timingSupported && missing.size && timingPages++ < 4) {
          if (!timing) {
            try {
              const summaries = await this.codex.request("thread/turns/list", {
                threadId: thread.id,
                limit: PAGE_SIZE,
                sortDirection: "desc",
                itemsView: "notLoaded",
              });
              timing = this.timingPage(summaries);
            } catch (error) {
              if (
                (error as any)?.code === -32601 ||
                /method.*(not found|unknown|unsupported)|unknown.*(method|variant)|unrecognized/i.test(
                  String(error),
                )
              )
                this.timingSupported = false;
              break;
            }
          }
          for (const turn of timing.data)
            if (missing.delete(turn.id)) {
              turns.set(turn.id, turn);
              lastMatchedTiming = timing;
            }
          if (!missing.size || !timing.nextCursor || timingPages >= 4) break;
          try {
            const summaries = await this.codex.request("thread/turns/list", {
              threadId: thread.id,
              limit: PAGE_SIZE,
              sortDirection: "desc",
              itemsView: "notLoaded",
              cursor: timing.nextCursor,
            });
            timing = this.timingPage(summaries);
          } catch {
            break;
          }
        }
        return {
          entries: page.data
            .slice()
            .reverse()
            .map((entry: any) => ({
              item: entry.item,
              startedAtMs: entry.startedAtMs,
              completedAtMs: entry.completedAtMs,
              turn: turns.get(entry.turnId) || { id: entry.turnId },
            })),
          cursor: page.nextCursor
            ? encode({ kind: "native", value: page.nextCursor, timing: lastMatchedTiming })
            : null,
        };
      } catch (error) {
        if (
          cursor?.kind === "native" ||
          !(
            /method.*(not found|unknown|unsupported)|unknown.*(method|variant)|unrecognized/i.test(
              String(error),
            ) || (error as any)?.code === -32601
          )
        )
          throw error;
        this.nativeSupported = false;
      }
    }
    const full =
      Array.isArray(thread.turns) && thread.turns.length
        ? thread
        : (await this.codex.request("thread/read", { threadId: thread.id, includeTurns: true }))
            .thread;
    const turns: any[] = full?.turns || [];
    const total = turns.reduce((n, turn) => n + (turn.items?.length || 0), 0);
    const end = cursor?.kind === "legacy" ? Math.min(total, cursor.before) : total;
    const start = Math.max(0, end - PAGE_SIZE);
    const entries: HistoryEntry[] = [];
    let offset = 0;
    for (const turn of turns) {
      const items = turn.items || [];
      const next = offset + items.length;
      if (next > start && offset < end)
        for (const item of items.slice(Math.max(0, start - offset), end - offset))
          entries.push({ turn, item });
      offset = next;
      if (offset >= end) break;
    }
    return { entries, cursor: start ? encode({ kind: "legacy", before: start }) : null };
  }

  private timingPage(page: any): TimingPage {
    if (!Array.isArray(page.data)) throw new Error("Invalid turn history response");
    return {
      data: page.data.map((turn: any) => ({
        id: turn.id,
        startedAt: turn.startedAt ?? null,
        completedAt: turn.completedAt ?? null,
        durationMs: turn.durationMs ?? null,
      })),
      nextCursor: page.nextCursor || null,
    };
  }
}
