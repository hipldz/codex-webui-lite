import assert from "node:assert/strict";
import test from "node:test";
import { includedInSnapshot } from "../src/event-replay";

const snapshots = new Map([["current", { instance: "server", cursor: 100 }]]);
const event = (type: string, cursor: number, threadId?: string, instance = "server") => ({
  instance,
  cursor,
  message: { type, threadId },
});

test("hydrating one session does not discard another session's buffered updates", () => {
  assert.equal(includedInSnapshot(event("event", 75, "other"), snapshots), false);
  assert.equal(includedInSnapshot(event("thread.changed", 76, "other"), snapshots), false);
  assert.equal(includedInSnapshot(event("items", 77, "current"), snapshots), true);
  assert.equal(includedInSnapshot(event("event", 78, "current"), snapshots), true);
  assert.equal(includedInSnapshot(event("thread.changed", 79, "current"), snapshots), true);
});

test("global runtime changes and thread mutations still replay after a snapshot", () => {
  assert.equal(includedInSnapshot(event("status", 80), snapshots), false);
  assert.equal(includedInSnapshot(event("thread.mutated", 81, "current"), snapshots), false);
});

test("newer events and events from a different server are never covered by an old snapshot", () => {
  assert.equal(includedInSnapshot(event("event", 101, "current"), snapshots), false);
  assert.equal(includedInSnapshot(event("items", 50, "current", "new-server"), snapshots), false);
  assert.equal(includedInSnapshot(event("items", 50, "unknown"), snapshots), false);
});
