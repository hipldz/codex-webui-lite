import type { Thread } from "./types";

export const threadIsRunning = (thread: Pick<Thread, "status" | "queued">) => Boolean(thread.queued) || typeof thread.status === "object" && thread.status?.type === "active";
