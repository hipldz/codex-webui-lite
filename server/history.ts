import type { CodexClient } from "./codex/client.js";

export type HistoryEntry = { turn: any; item: any };
type Cursor = { kind: "native"; value: string } | { kind: "legacy"; before: number };
const PAGE_SIZE = 30;
const encode = (cursor: Cursor) => Buffer.from(JSON.stringify(cursor)).toString("base64url");
function decode(value?: string): Cursor | undefined {
  if (!value) return;
  if (value.length > 8192) throw new Error("Invalid history cursor");
  const result = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  if (result.kind === "native" && typeof result.value === "string") return result;
  if (result.kind === "legacy" && Number.isSafeInteger(result.before) && result.before >= 0) return result;
  throw new Error("Invalid history cursor");
}

/** Keep no session histories in memory. Serialize hydration for small hosts. */
export class HistoryReader {
  private nativeSupported = true;
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private codex: CodexClient) {}
  read(thread: any, before?: string): Promise<{ entries: HistoryEntry[]; cursor: string | null }> {
    const work = this.tail.then(() => this.readPage(thread, decode(before)));
    this.tail = work.catch(() => {}); return work;
  }
  private async readPage(thread: any, cursor?: Cursor) {
    if (this.nativeSupported && cursor?.kind !== "legacy") {
      try {
        const page = await this.codex.request("thread/items/list", { threadId: thread.id, limit: PAGE_SIZE, sortDirection: "desc", cursor: cursor?.value || null });
        if (!Array.isArray(page.data)) throw new Error("Invalid item history response");
        return { entries: page.data.slice().reverse().map((entry: any) => ({ item: entry.item, turn: { id: entry.turnId, startedAt: entry.startedAtMs, completedAt: entry.completedAtMs } })), cursor: page.nextCursor ? encode({ kind: "native", value: page.nextCursor }) : null };
      } catch (error) {
        if (cursor?.kind === "native" || !(/method.*(not found|unknown|unsupported)|unknown.*(method|variant)|unrecognized/i.test(String(error)) || (error as any)?.code === -32601)) throw error;
        this.nativeSupported = false;
      }
    }
    const full = Array.isArray(thread.turns) && thread.turns.length ? thread : (await this.codex.request("thread/read", { threadId: thread.id, includeTurns: true })).thread;
    const turns: any[] = full?.turns || [];
    const total = turns.reduce((n, turn) => n + (turn.items?.length || 0), 0);
    const end = cursor?.kind === "legacy" ? Math.min(total, cursor.before) : total;
    const start = Math.max(0, end - PAGE_SIZE);
    const entries: HistoryEntry[] = []; let offset = 0;
    for (const turn of turns) {
      const items = turn.items || []; const next = offset + items.length;
      if (next > start && offset < end) for (const item of items.slice(Math.max(0, start - offset), end - offset)) entries.push({ turn, item });
      offset = next; if (offset >= end) break;
    }
    return { entries, cursor: start ? encode({ kind: "legacy", before: start }) : null };
  }
}
