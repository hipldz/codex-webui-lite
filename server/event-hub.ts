import { randomUUID } from "node:crypto";
export type BufferedEvent = { cursor: number; message: any };

export class EventHub {
  readonly instance = randomUUID();
  private cursor = 0;
  private bytes = 0;
  private events: Array<BufferedEvent & { bytes: number }> = [];
  constructor(private readonly limit = 1000, private readonly byteLimit = 8 * 1024 * 1024, private readonly pageBytes = 512 * 1024) {}
  get current() { return this.cursor; }
  get retainedBytes() { return this.bytes; }

  push(message: any) {
    const bytes = Buffer.byteLength(JSON.stringify(message), "utf8");
    this.events.push({ cursor: ++this.cursor, message, bytes }); this.bytes += bytes;
    while (this.events.length && (this.events.length > this.limit || this.bytes > this.byteLimit)) this.bytes -= this.events.shift()!.bytes;
  }

  read(after: number, instance?: string) {
    const oldest = this.events[0]?.cursor ?? this.cursor + 1;
    const reset = !Number.isSafeInteger(after) || after < 0 || after > this.cursor || after < oldest - 1 || Boolean(instance && instance !== this.instance);
    if (reset) return { instance: this.instance, cursor: this.cursor, reset: true, events: [], more: false };
    const events: BufferedEvent[] = []; let bytes = 0;
    for (const event of this.events) {
      if (event.cursor <= after) continue;
      if (events.length && bytes + event.bytes > this.pageBytes) break;
      events.push({ cursor: event.cursor, message: event.message }); bytes += event.bytes;
    }
    const cursor = events.at(-1)?.cursor ?? after;
    return { instance: this.instance, cursor, reset: false, events, more: cursor < this.cursor };
  }
}
