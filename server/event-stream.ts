import type { IncomingMessage, ServerResponse } from "node:http";
import type { EventHub } from "./event-hub.js";

export function streamEvents(req: IncomingMessage, res: ServerResponse, hub: EventHub, url: URL) {
  let cursor = Number(url.searchParams.get("cursor") || 0);
  let instance = url.searchParams.get("instance") || "";
  const lastId = req.headers["last-event-id"];
  if (typeof lastId === "string") {
    const match = /^([^:]+):(\d+)$/.exec(lastId);
    if (match) {
      instance = match[1];
      cursor = Number(match[2]);
    }
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();
  res.setTimeout(0);

  let closed = false;
  let scheduled = false;
  let blocked = false;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let stalled: ReturnType<typeof setTimeout> | undefined;
  let unsubscribe = () => {};
  const cleanup = () => {
    if (closed) return;
    closed = true;
    unsubscribe();
    clearInterval(heartbeat);
    clearTimeout(stalled);
    res.off("drain", drain);
    res.off("close", cleanup);
    res.off("finish", cleanup);
    res.off("error", cleanup);
  };
  const write = (frame: string) => {
    if (closed || res.destroyed) return false;
    if (res.write(frame)) return true;
    blocked = true;
    // A slow reader must not retain an unbounded per-connection write queue.
    stalled = setTimeout(() => res.destroy(), 30_000);
    stalled.unref();
    return false;
  };
  const flush = () => {
    scheduled = false;
    if (closed || blocked) return;
    try {
      const page = hub.read(cursor, instance);
      if (page.reset) {
        write(`event: reset\ndata: ${JSON.stringify({ instance: page.instance })}\n\n`);
        res.end();
        return;
      }
      instance = page.instance;
      for (const event of page.events) {
        cursor = event.cursor;
        if (
          !write(`id: ${instance}:${cursor}\ndata: ${JSON.stringify({ ...event, instance })}\n\n`)
        )
          return;
      }
      if (page.more) schedule();
    } catch {
      res.destroy();
    }
  };
  const schedule = () => {
    if (closed || blocked || scheduled) return;
    scheduled = true;
    queueMicrotask(flush);
  };
  const drain = () => {
    blocked = false;
    clearTimeout(stalled);
    schedule();
  };
  res.on("drain", drain);
  res.on("close", cleanup);
  res.on("finish", cleanup);
  res.on("error", cleanup);
  unsubscribe = hub.subscribe(schedule);
  write(`retry: 2000\nevent: ready\ndata: ${JSON.stringify({ instance: hub.instance })}\n\n`);
  schedule();
  heartbeat = setInterval(() => {
    if (!closed && !blocked) write("event: ping\ndata: {}\n\n");
  }, 15_000);
  heartbeat.unref();
}
