import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { listAgents, readAgentResult } from "../server/agents.js";
import { agentParentId } from "../server/codex/agent-info.js";
import { CodexController } from "../server/controller.js";
import { EventHub } from "../server/event-hub.js";

const child = (id = "agent", updates: any = {}) => ({
  id,
  parentThreadId: "parent",
  status: { type: "idle" },
  preview: "Review the change",
  agentNickname: "Atlas",
  ...updates,
});
const rpc = (request: (method: string, params: any) => Promise<any>) => ({ request }) as any;

test("spawn ancestry accepts both protocol formats and never treats a user fork as an agent", () => {
  assert.equal(agentParentId(child()), "parent");
  assert.equal(
    agentParentId({ source: { subAgent: { thread_spawn: { parent_thread_id: "legacy" } } } }),
    "legacy",
  );
  assert.equal(
    agentParentId({ source: { subagent: { thread_spawn: { parent_thread_id: "legacy" } } } }),
    "legacy",
  );
  assert.equal(agentParentId({ forkedFromId: "parent" } as any), null);
});

test("listing combines stored, archived and live ephemeral children, validating ignored filters", async () => {
  const calls: any[] = [];
  const codex = rpc(async (method, params) => {
    calls.push({ method, params });
    return {
      data: params.archived
        ? [child("archived")]
        : [
            child(),
            child("unrelated", { parentThreadId: "other" }),
            { id: "fork", forkedFromId: "parent" },
          ],
      nextCursor: params.archived ? "more" : null,
    };
  });
  const result = await listAgents(codex, "parent", [
    { thread: child("ephemeral"), archived: false },
  ]);
  assert.deepEqual(
    result.agents.map((agent) => agent.id),
    ["ephemeral", "archived", "agent"],
  );
  assert.equal(result.agents[1].archived, true);
  assert.equal(result.hasMore, true);
  assert.equal(calls.length, 2);
  assert.ok(
    calls.every((call) => call.method === "thread/list" && call.params.parentThreadId === "parent"),
  );
  assert.deepEqual(calls[0].params.modelProviders, []);
});

test("inspection failures remain errors instead of silently reporting no agents", async () => {
  const codex = rpc(async () => {
    throw new Error("Unavailable");
  });
  await assert.rejects(listAgents(codex, "parent"), /Unavailable/);
  const result = await listAgents(codex, "parent", [{ thread: child(), archived: false }]);
  assert.equal(result.agents.length, 1);
  assert.match(result.warning!, /could not be loaded/);
});

test("reading a result uses only the latest turn's final answer and never resumes a thread", async () => {
  const methods: string[] = [];
  const result = await readAgentResult(
    rpc(async (method, params) => {
      methods.push(method);
      if (method === "thread/read") {
        assert.equal(params.includeTurns, false);
        return { thread: child() };
      }
      assert.equal(params.limit, 1);
      assert.equal(params.sortDirection, "desc");
      return {
        data: [
          {
            status: "completed",
            items: [
              { type: "agentMessage", phase: "commentary", text: "Checking…" },
              { type: "agentMessage", phase: "final_answer", text: "No issues found." },
            ],
          },
        ],
      };
    }),
    "parent",
    "agent",
  );
  assert.equal(result.status, "completed");
  assert.equal(result.text, "No issues found.");
  assert.deepEqual(methods, ["thread/read", "thread/turns/list"]);
});

test("native result reads page only the latest turn and ignore unrelated returned items", async () => {
  let itemPages = 0;
  const result = await readAgentResult(
    rpc(async (method, params) => {
      if (method === "thread/read") return { thread: child() };
      if (method === "thread/turns/list") {
        assert.equal(params.itemsView, "notLoaded");
        return { data: [{ id: "latest", status: "completed", items: [] }] };
      }
      assert.equal(method, "thread/items/list");
      assert.equal(params.turnId, "latest");
      assert.equal(params.limit, 30);
      itemPages++;
      if (!params.cursor)
        return {
          data: [
            {
              turnId: "older",
              item: { type: "agentMessage", phase: "final_answer", text: "Unrelated answer" },
            },
          ],
          nextCursor: "next",
        };
      return {
        data: [
          {
            turnId: "latest",
            item: { type: "agentMessage", phase: "final_answer", text: "Current answer" },
          },
        ],
      };
    }),
    "parent",
    "agent",
  );
  assert.equal(result.text, "Current answer");
  assert.equal(itemPages, 2);
});

test("running and commentary-only turns cannot appear as completed results", async () => {
  for (const status of ["inProgress", "completed"]) {
    const result = await readAgentResult(
      rpc(async (method) =>
        method === "thread/read"
          ? { thread: child() }
          : {
              data: [
                {
                  status,
                  items: [{ type: "agentMessage", phase: "commentary", text: "Still checking" }],
                },
              ],
            },
      ),
      "parent",
      "agent",
    );
    assert.equal(result.text, "");
    assert.equal(result.status, status === "inProgress" ? "running" : "completed");
  }
});

test("a new active turn hides the preceding turn's answer", async () => {
  const result = await readAgentResult(
    rpc(async (method) =>
      method === "thread/read"
        ? { thread: child("agent", { status: { type: "active" } }) }
        : {
            data: [
              { status: "completed", items: [{ type: "agentMessage", text: "Previous result" }] },
            ],
          },
    ),
    "parent",
    "agent",
  );
  assert.equal(result.status, "running");
  assert.equal(result.text, "");
});

test("result reads reject an unrelated thread even if its id is supplied directly", async () => {
  let calls = 0;
  await assert.rejects(
    readAgentResult(
      rpc(async () => {
        calls++;
        return { thread: child("agent", { parentThreadId: "other" }) };
      }),
      "parent",
      "agent",
    ),
    /does not belong/,
  );
  assert.equal(calls, 1);
});

test("older servers fall back to a read without changing the session", async () => {
  const result = await readAgentResult(
    rpc(async (method, params) => {
      if (method === "thread/turns/list")
        throw Object.assign(new Error("Method not found"), { code: -32601 });
      return {
        thread: child("agent", {
          turns: params.includeTurns
            ? [{ status: "completed", items: [{ type: "agentMessage", text: "Legacy result" }] }]
            : [],
        }),
      };
    }),
    "parent",
    "agent",
  );
  assert.equal(result.text, "Legacy result");
});

test("inspection actions leave the active session and event stream untouched", async () => {
  const codex = Object.assign(
    new EventEmitter(),
    rpc(async (method: string) => {
      if (method === "thread/list") return { data: [child()] };
      if (method === "thread/read") return { thread: child() };
      if (method === "thread/turns/list") return { data: [] };
      throw new Error(`Unexpected RPC ${method}`);
    }),
    { status: "ready" },
  );
  const hub = new EventHub();
  const controller = new CodexController(
    codex as any,
    {} as any,
    {} as any,
    hub,
    () => ({}),
    {} as any,
  );
  (controller as any).activeThreadId = "parent";
  assert.equal(
    (await controller.handle({ type: "thread.agents", threadId: "parent" }))[0].type,
    "agents.list",
  );
  assert.equal(
    (
      await controller.handle({ type: "thread.agentResult", threadId: "parent", agentId: "agent" })
    )[0].type,
    "agents.result",
  );
  assert.equal((controller as any).activeThreadId, "parent");
  assert.equal(hub.current, 0);
  assert.equal(controller.runtime().busy, false);
});

test("slow inspection requests are bounded without blocking ordinary actions", async () => {
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const codex = Object.assign(
    new EventEmitter(),
    rpc(async () => {
      await blocked;
      return { data: [] };
    }),
    { status: "ready" },
  );
  const controller = new CodexController(
    codex as any,
    {} as any,
    {} as any,
    new EventHub(),
    () => ({}),
    { snapshot: {} } as any,
  );
  const first = controller.handle({ type: "thread.agents", threadId: "parent" });
  const second = controller.handle({ type: "thread.agents", threadId: "parent" });
  try {
    const third = await controller.handle({ type: "thread.agents", threadId: "parent" });
    assert.match(third[0].message, /busy/);
    assert.equal((await controller.handle({ type: "settings.read" }))[0].type, "settings.updated");
  } finally {
    release();
    await Promise.all([first, second]);
  }
});
