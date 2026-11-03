import assert from "node:assert/strict";
import test from "node:test";
import { DraftSubmissions } from "../src/draft-submissions";

function tracker() {
  let next = 0;
  return new DraftSubmissions(() => `message-${++next}`);
}

test("a timed-out submission keeps its ID and a later receipt clears its draft exactly once", () => {
  const drafts = tracker();
  const id = drafts.begin("thread:first");
  // A transport timeout leaves delivery unknown, so it must not settle a draft.
  assert.equal(drafts.begin("thread:first"), id);
  assert.equal(drafts.settle(id, true), "thread:first");
  assert.equal(drafts.settle(id, true), undefined);
});

test("late confirmation preserves a later edit, including text edited back to its original value", () => {
  const drafts = tracker();
  const id = drafts.begin("thread:first");
  drafts.edit("thread:first");
  drafts.edit("thread:first");
  assert.equal(drafts.settle(id, true), undefined);
  assert.notEqual(drafts.begin("thread:first"), id);
});

test("a receipt for an inactive session only clears that session's submitted draft", () => {
  const drafts = tracker();
  const first = drafts.begin("thread:first");
  const second = drafts.begin("thread:second");
  drafts.edit("thread:second");
  assert.equal(drafts.settle(first, true), "thread:first");
  assert.equal(drafts.settle(second, true), undefined);
});

test("a first send transfers its revision from the workspace to the created session", () => {
  const drafts = tracker();
  const id = drafts.begin("workspace:/project");
  drafts.transfer("workspace:/project", "thread:new");
  assert.equal(drafts.settle(id, true), "thread:new");
});

test("a definite rejection preserves the draft and allows a new message ID", () => {
  const drafts = tracker();
  const id = drafts.begin("thread:first");
  assert.equal(drafts.settle(id, false), undefined);
  assert.notEqual(drafts.begin("thread:first"), id);
});

test("a recovered pending draft retains its original ID for an idempotent retry", () => {
  const drafts = tracker();
  drafts.restore("thread:first", "saved-message");
  assert.equal(drafts.begin("thread:first"), "saved-message");
  assert.equal(drafts.settle("saved-message", true), "thread:first");
});
