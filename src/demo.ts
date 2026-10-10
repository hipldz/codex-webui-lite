import type { Thread, UiItem } from "./types";

const demoNow = Date.now();
export const demoThreads: Thread[] = [
  { id: "demo", preview: "Improve error handling", updatedAt: Date.now() / 1000 },
  { id: "cache", preview: "Add caching layer", updatedAt: Date.now() / 1000 - 86400 },
  { id: "auth", preview: "Refactor auth flow", updatedAt: Date.now() / 1000 - 172800 },
  { id: "tests", preview: "Fix flaky tests", updatedAt: Date.now() / 1000 - 259200 },
];
export const demoItems: UiItem[] = [
  { type: "user_message", id: "u1", text: "Add input validation for the `/api/users` endpoint.", timestamp: demoNow - 85_000, turnId: "demo-turn-1" },
  { type: "assistant_message", id: "a1", text: "I’ll add validation with Zod and return clear `400` responses. See [src/server/users.ts](/home/demo/project/src/server/users.ts).", streaming: false, timestamp: demoNow - 78_000, turnId: "demo-turn-1" },
  { type: "thinking", id: "t1", text: "Inspecting the endpoint and its request schema before making a small, focused change.", status: "done", turnId: "demo-turn-1" },
  { type: "file_read", id: "r1", path: "src/server/users.ts", turnId: "demo-turn-1" },
  { type: "command", id: "c1", command: "npm test", output: "PASS  tests/users.test.ts\nTests: 8 passed, 8 total\nTime: 1.42s", status: "done", turnId: "demo-turn-1" },
  { type: "file_change", id: "f1", path: "src/server/users.ts", diff: "@@ -21,7 +21,12 @@ export async function createUser(req, res) {\n-  if (!email || !name) return res.status(400).json({ error: 'Missing fields' });\n+  const result = userSchema.safeParse(req.body);\n+  if (!result.success) {\n+    return res.status(400).json({\n+      error: 'Invalid input'\n+    });\n+  }", status: "completed", turnId: "demo-turn-1" },
  { type: "file_change", id: "f2", path: "package.json", diff: "@@ -12,6 +12,7 @@\n   \"dependencies\": {\n+    \"zod\": \"^4.0.0\",\n     \"express\": \"^5.0.0\"\n   }", status: "completed", turnId: "demo-turn-1" },
  { type: "approval", id: "p1", requestId: 99, description: "npm install zod", status: "pending", decisions: ["accept", { acceptWithExecpolicyAmendment: { execpolicy_amendment: ["npm", "install"] } }, "acceptForSession", "decline"], approvalKind: "command" },
];
