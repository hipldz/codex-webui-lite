import assert from "node:assert/strict";
import test from "node:test";
import { mergeThreadList } from "../src/thread-list";
import type { Thread } from "../src/types";

const thread = (id: string, updates: Partial<Thread> = {}): Thread => ({
  id,
  preview: `Preview ${id}`,
  updatedAt: 1,
  ...updates,
});
const ids = (threads: Thread[]) => threads.map((entry) => entry.id);

test("resync preserves all loaded history pages while updating the first page", () => {
  const loaded = Array.from({ length: 125 }, (_, index) => thread(`session-${index}`));
  const page = loaded
    .slice(0, 50)
    .reverse()
    .map((entry) => ({ ...entry, name: "Updated title", updatedAt: 2 }));

  const result = mergeThreadList(loaded, page, "refresh");

  assert.deepEqual(ids(result), ids(loaded));
  assert.equal(result[0].name, "Updated title");
  assert.equal(result[49].updatedAt, 2);
  assert.deepEqual(result.slice(50), loaded.slice(50));
  assert.equal(loaded[0].name, undefined);
});

test("background refresh adds new sessions without reordering existing sessions", () => {
  const loaded = [thread("first"), thread("second"), thread("third")];
  const result = mergeThreadList(
    loaded,
    [thread("third", { name: "Newest title" }), thread("new"), thread("first")],
    "refresh",
  );

  assert.deepEqual(ids(result), ["new", "first", "second", "third"]);
  assert.equal(result[3].name, "Newest title");
});

test("a changed session keeps its existing position", () => {
  const loaded = [thread("first"), thread("second"), thread("third")];
  const result = mergeThreadList(
    loaded,
    [thread("third", { status: { type: "active" } })],
    "refresh",
  );

  assert.deepEqual(ids(result), ["first", "second", "third"]);
  assert.deepEqual(result[2].status, { type: "active" });
});

test("overlapping history pages update cached summaries and append each new ID once", () => {
  const result = mergeThreadList(
    [thread("first"), thread("second", { name: "Saved title" })],
    [
      thread("second", { preview: "", updatedAt: 2 }),
      thread("third"),
      thread("third", { name: "Updated third title" }),
      thread("fourth"),
    ],
    "append",
  );

  assert.deepEqual(ids(result), ["first", "second", "third", "fourth"]);
  assert.equal(result[1].name, "Saved title");
  assert.equal(result[1].preview, "Preview second");
  assert.equal(result[1].updatedAt, 2);
  assert.equal(result[2].name, "Updated third title");
});

test("refreshing a destination list retains older archived sessions", () => {
  const archived = Array.from({ length: 100 }, (_, index) => thread(`archived-${index}`));
  const moved = thread("just-archived");
  const result = mergeThreadList(
    mergeThreadList(archived, [moved], "refresh"),
    [moved, ...archived.slice(0, 49)],
    "refresh",
  );

  assert.deepEqual(ids(result), [moved.id, ...ids(archived)]);
});

test("initial replacement follows server order and removes unrelated cached entries", () => {
  const result = mergeThreadList(
    [thread("unrelated"), thread("saved", { name: "Saved title" })],
    [thread("new"), thread("saved", { preview: "" }), thread("new")],
    "replace",
  );

  assert.deepEqual(ids(result), ["new", "saved"]);
  assert.equal(result[1].name, "Saved title");
  assert.equal(result[1].preview, "Preview saved");
});
