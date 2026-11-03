import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import test, { type TestContext } from "node:test";
import { CodexController } from "../server/controller.js";
import { EventHub } from "../server/event-hub.js";
import { TurnQueue } from "../server/turn-queue.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function nextEvent(hub: EventHub, predicate: (message: any) => boolean) {
  const cursor = hub.current;
  return new Promise<any>((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error("Expected event was not emitted"));
    }, 2000);
    const unsubscribe = hub.subscribe(() => {
      const message = hub
        .read(cursor)
        .events.map((entry) => entry.message)
        .find(predicate);
      if (message) {
        clearTimeout(timer);
        unsubscribe();
        resolve(message);
      }
    });
  });
}

function fixture(t: TestContext, start?: (payload: any) => Promise<any>) {
  const truth = new Map<string, { id: string; status: string }>();
  const codex = Object.assign(new EventEmitter(), {
    status: "ready",
    request: async (method: string, params: any) => {
      const turn = truth.get(params.threadId);
      if (method === "thread/read")
        return {
          thread: {
            id: params.threadId,
            status: { type: turn?.status === "inProgress" ? "active" : "idle" },
          },
        };
      if (method === "thread/turns/list") return { data: turn ? [turn] : [] };
      throw new Error(`Unexpected RPC ${method}`);
    },
  });
  const hub = new EventHub();
  const controller = new CodexController(
    codex as any,
    {} as any,
    {} as any,
    hub,
    () => ({}),
    {} as any,
  );
  const queue = new TurnQueue(
    start ||
      (async (payload) => {
        const turn = { id: `turn-${payload.clientUserMessageId}`, status: "inProgress" };
        truth.set(payload.threadId, turn);
        codex.emit("message", {
          method: "turn/started",
          params: { threadId: payload.threadId, turn },
        });
        return {
          type: "turn.accepted",
          threadId: payload.threadId,
          messageId: payload.clientUserMessageId,
          turnId: turn.id,
          running: true,
        };
      }),
    (message) => hub.push(message),
  );
  (controller as any).queue = queue;
  t.after(async () => {
    codex.status = "stopped";
    clearTimeout((controller as any).summaryTimer);
    (controller as any).pendingSummaries.clear();
    await queue.reset();
    const directory = await (queue as any).directory;
    if (directory) await fs.rm(directory, { recursive: true, force: true });
  });
  const submit = async (threadId: string, messageId: string) => {
    const accepted = nextEvent(
      hub,
      (message) => message.type === "turn.accepted" && message.messageId === messageId,
    );
    await queue.submit({ threadId, clientUserMessageId: messageId, text: messageId });
    await accepted;
  };
  return { truth, codex, hub, controller, queue, submit };
}

test("idle without turn/completed releases the verified turn and starts the next queued task", async (t) => {
  const h = fixture(t);
  await h.submit("first", "one");
  await h.queue.submit({ threadId: "second", clientUserMessageId: "two", text: "next" });
  h.truth.set("first", { id: "turn-one", status: "completed" });
  const checked = nextEvent(
    h.hub,
    (message) => message.type === "turn.status" && message.threadId === "first",
  );
  const nextStarted = nextEvent(
    h.hub,
    (message) => message.type === "turn.accepted" && message.messageId === "two",
  );
  h.codex.emit("message", {
    method: "thread/status/changed",
    params: { threadId: "first", status: { type: "idle" } },
  });
  assert.equal((await checked).running, false);
  await nextStarted;
  assert.equal(h.queue.status("first"), null);
  assert.equal(h.queue.status("second")?.turnId, "turn-two");
  assert.equal(h.queue.receipt("first", "one").running, false);
});

test("an explicit status check repairs a missing completion even when the event connection stays alive", async (t) => {
  const h = fixture(t);
  await h.submit("first", "one");
  h.truth.set("first", { id: "turn-one", status: "completed" });
  // No terminal notification is delivered through the Codex event stream.
  const replies = await h.controller.handle({
    type: "turn.status",
    threadId: "first",
    clientUserMessageId: "one",
  });
  assert.equal(replies.find((reply) => reply.type === "turn.status")?.completedTurnId, "turn-one");
  assert.equal(replies.find((reply) => reply.type === "turn.accepted")?.running, false);
  assert.equal(h.queue.size, 0);
  assert.equal(
    h.hub
      .read(0)
      .events.some(({ message }) => message.type === "turn.status" && message.running === false),
    true,
  );
});

test("a quiet but genuinely running turn keeps its slot", async (t) => {
  const h = fixture(t);
  await h.submit("first", "one");
  const replies = await h.controller.handle({ type: "turn.status", threadId: "first" });
  assert.equal(replies.at(-1).running, true);
  assert.equal(h.queue.size, 1);
});

test("a delayed idle notification verifies the newer running turn instead of clearing it", async (t) => {
  const h = fixture(t);
  await h.submit("first", "one");
  h.queue.completed("first", "turn-one");
  await h.submit("first", "two");
  const checked = nextEvent(h.hub, (message) => message.type === "turn.status");
  h.codex.emit("message", {
    method: "thread/status/changed",
    params: { threadId: "first", status: { type: "idle" } },
  });
  assert.equal((await checked).running, true);
  assert.equal(h.queue.status("first")?.turnId, "turn-two");
});

test("an old RPC response arriving after completion cannot release a newer job", async (t) => {
  const oldResponse = deferred<any>();
  const firstStarted = deferred<void>();
  const h = fixture(t, async (payload) => {
    if (payload.clientUserMessageId === "one") {
      firstStarted.resolve();
      return oldResponse.promise;
    }
    return {
      type: "turn.accepted",
      threadId: "first",
      messageId: "two",
      turnId: "turn-two",
      running: true,
    };
  });
  await h.queue.submit({ threadId: "first", clientUserMessageId: "one", text: "one" });
  await firstStarted.promise;
  h.queue.started("first", "turn-one");
  h.queue.completed("first", "turn-one");
  await h.submit("first", "two");
  const oldAcknowledged = nextEvent(
    h.hub,
    (message) => message.type === "turn.accepted" && message.messageId === "one",
  );
  oldResponse.resolve({
    type: "turn.accepted",
    threadId: "first",
    messageId: "one",
    turnId: "turn-one",
    running: true,
  });
  assert.equal((await oldAcknowledged).running, false);
  assert.equal(h.queue.status("first")?.turnId, "turn-two");
});

test("a delayed old completion cannot remove a newer turn in the same session", async (t) => {
  const h = fixture(t);
  await h.submit("first", "one");
  h.queue.completed("first", "turn-one");
  await h.submit("first", "two");
  h.codex.emit("message", {
    method: "turn/completed",
    params: { threadId: "first", turn: { id: "turn-one", status: "completed" } },
  });
  h.queue.completed("first", "turn-one");
  assert.equal(h.queue.status("first")?.turnId, "turn-two");
  assert.equal((h.controller as any).activeTurns.get("first"), "turn-two");
});

test("a status snapshot captured before a newer start is ignored", async (t) => {
  const h = fixture(t);
  await h.submit("first", "one");
  const read = deferred<any>();
  const turns = deferred<any>();
  h.codex.request = (method) => (method === "thread/read" ? read.promise : turns.promise);
  const checking = h.controller.handle({ type: "turn.status", threadId: "first" });
  h.codex.emit("message", {
    method: "turn/started",
    params: { threadId: "first", turn: { id: "newer", status: "inProgress" } },
  });
  read.resolve({ thread: { id: "first", status: { type: "idle" } } });
  turns.resolve({ data: [{ id: "turn-one", status: "completed" }] });
  assert.equal((await checking).at(-1).stale, true);
  assert.equal(h.queue.size, 1);
  assert.equal((h.controller as any).activeTurns.get("first"), "newer");
});

test("a failed status query preserves the task instead of declaring it finished", async (t) => {
  const h = fixture(t);
  await h.submit("first", "one");
  h.codex.request = async () => {
    throw new Error("RPC unavailable");
  };
  const replies = await h.controller.handle({ type: "turn.status", threadId: "first" });
  assert.equal(replies[0].type, "error");
  assert.equal(h.queue.status("first")?.turnId, "turn-one");
});

test("an unconfirmed turn/start timeout keeps its slot until a matching turn is known", async (t) => {
  const h = fixture(t, async () => {
    throw Object.assign(new Error("turn/start timed out"), { deliveryUnknown: true });
  });
  const unknown = nextEvent(h.hub, (message) => message.type === "turn.unconfirmed");
  await h.queue.submit({ threadId: "first", clientUserMessageId: "one", text: "one" });
  await unknown;
  assert.equal(h.queue.size, 1);
  assert.equal(h.queue.status("first")?.unconfirmed, true);
  h.queue.completed("first", "older-turn");
  assert.equal(h.queue.size, 1);
  h.queue.started("first", "confirmed-turn");
  assert.equal(h.queue.receipt("first", "one").type, "turn.accepted");
  h.queue.completed("first", "confirmed-turn");
  assert.equal(h.queue.size, 0);
});
