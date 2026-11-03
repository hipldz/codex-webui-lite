import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { setImmediate } from "node:timers/promises";
import test from "node:test";
import { EventHub } from "../server/event-hub.js";
import { streamEvents } from "../server/event-stream.js";

class Response extends EventEmitter {
  frames: string[] = [];
  headers: Record<string, string> = {};
  destroyed = false;
  ended = false;
  blockNextEvent = false;

  writeHead(_status: number, headers: Record<string, string>) {
    this.headers = headers;
  }
  flushHeaders() {}
  setTimeout(_timeout: number) {}
  write(frame: string) {
    this.frames.push(frame);
    if (frame.startsWith("id:") && this.blockNextEvent) {
      this.blockNextEvent = false;
      return false;
    }
    return true;
  }
  end() {
    this.ended = true;
    this.emit("finish");
    this.emit("close");
  }
  destroy() {
    this.destroyed = true;
    this.emit("close");
  }
}

function open(
  hub: EventHub,
  response: Response,
  cursor = 0,
  lastId?: string,
  instance: string = hub.instance,
) {
  const url = new URL("http://localhost/api/events/stream");
  url.searchParams.set("cursor", String(cursor));
  url.searchParams.set("instance", instance);
  streamEvents(
    { headers: lastId ? { "last-event-id": lastId } : {} } as IncomingMessage,
    response as unknown as ServerResponse,
    hub,
    url,
  );
}
const messages = (response: Response) =>
  response.frames
    .filter((frame) => frame.startsWith("id:"))
    .map((frame) => JSON.parse(frame.slice(frame.indexOf("data: ") + 6)));

test("SSE replays the retained suffix and immediately delivers new events", async (t) => {
  const hub = new EventHub();
  hub.push({ type: "items", threadId: "first" });
  hub.push({ type: "items", threadId: "second" });
  const response = new Response();
  t.after(() => response.destroy());
  open(hub, response, 1);
  await setImmediate();

  assert.equal(response.headers["Content-Type"], "text/event-stream; charset=utf-8");
  assert.equal(response.headers["X-Accel-Buffering"], "no");
  assert.deepEqual(
    messages(response).map((event) => event.cursor),
    [2],
  );
  hub.push({ type: "thread.changed", thread: { id: "third" } });
  await setImmediate();
  assert.deepEqual(
    messages(response).map((event) => event.cursor),
    [2, 3],
  );
  assert.equal(messages(response)[1].instance, hub.instance);
});

test("Last-Event-ID takes precedence over the original URL cursor on reconnect", async (t) => {
  const hub = new EventHub();
  hub.push({ type: "first" });
  hub.push({ type: "second" });
  hub.push({ type: "third" });
  const response = new Response();
  t.after(() => response.destroy());
  open(hub, response, 0, `${hub.instance}:2`);
  await setImmediate();

  assert.deepEqual(
    messages(response).map((event) => event.cursor),
    [3],
  );
});

test("an expired replay cursor requests resynchronization and closes the stream", async (t) => {
  const hub = new EventHub(2);
  hub.push({ type: "first" });
  hub.push({ type: "second" });
  hub.push({ type: "third" });
  const response = new Response();
  t.after(() => response.destroy());
  open(hub, response);
  await setImmediate();

  assert.ok(response.frames.some((frame) => frame.startsWith("event: reset\n")));
  assert.equal(response.ended, true);
  assert.deepEqual(messages(response), []);
});

test("a server instance change requests resynchronization", async (t) => {
  const hub = new EventHub();
  const response = new Response();
  t.after(() => response.destroy());
  open(hub, response, 0, undefined, "previous-server");
  await setImmediate();

  assert.ok(response.frames.some((frame) => frame.startsWith("event: reset\n")));
  assert.equal(response.ended, true);
});

test("a slow reader pauses delivery and resumes without losing or duplicating events", async (t) => {
  const hub = new EventHub();
  hub.push({ type: "first" });
  hub.push({ type: "second" });
  hub.push({ type: "third" });
  const response = new Response();
  response.blockNextEvent = true;
  t.after(() => response.destroy());
  open(hub, response);
  await setImmediate();

  assert.deepEqual(
    messages(response).map((event) => event.cursor),
    [1],
  );
  hub.push({ type: "fourth" });
  await setImmediate();
  assert.deepEqual(
    messages(response).map((event) => event.cursor),
    [1],
  );
  response.emit("drain");
  await setImmediate();
  assert.deepEqual(
    messages(response).map((event) => event.cursor),
    [1, 2, 3, 4],
  );
});

test("disconnect removes the subscription and pending response listeners", async () => {
  const hub = new EventHub();
  const response = new Response();
  open(hub, response);
  await setImmediate();
  response.destroy();
  const count = response.frames.length;
  hub.push({ type: "after-disconnect" });
  await setImmediate();

  assert.equal(response.frames.length, count);
  assert.equal(response.listenerCount("drain"), 0);
  assert.equal(response.listenerCount("finish"), 0);
});
