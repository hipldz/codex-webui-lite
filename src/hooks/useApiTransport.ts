import { useCallback, useEffect, useRef, useState } from "react";
import { includedInSnapshot, type EventPosition } from "../event-replay";

const apiBase = () => `${location.pathname.replace(/\/?$/, "/")}api`;

export function useApiTransport(onMessage: (message: any) => void, disabled = false) {
  const handler = useRef(onMessage);
  handler.current = onMessage;
  const cursor = useRef(0);
  const instance = useRef("");
  const [connected, setConnected] = useState(disabled);
  const [connectionError, setConnectionError] = useState("");
  const receipts = useRef(new Map<string, number>());
  const seenEvents = useRef(new Set<string>());
  const snapshots = useRef(new Map<string, EventPosition>());
  const wake = useRef<() => void>(() => {});
  const pauseStream = useRef<() => void>(() => {});
  const reconnect = useRef<() => void>(() => {});
  const requests = useRef(new Set<AbortController>());
  const mounted = useRef(true);
  const hydrating = useRef(0);
  const epoch = useRef(0);
  const threadListVersion = useRef(0);

  const request = useCallback(async (url: string, init?: RequestInit, timeout = 12_000) => {
    const controller = new AbortController();
    requests.current.add(controller);
    const timer = window.setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(url, { ...init, cache: "no-store", signal: controller.signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
      return data;
    } finally {
      window.clearTimeout(timer);
      requests.current.delete(controller);
    }
  }, []);

  const deliver = useCallback((message: any) => {
    if (!mounted.current) return;
    if (message.eventId) {
      if (seenEvents.current.has(message.eventId)) return;
      seenEvents.current.add(message.eventId);
      while (seenEvents.current.size > 1000)
        seenEvents.current.delete(seenEvents.current.values().next().value!);
    }
    if (message.messageId && message.receiptVersion) {
      if ((receipts.current.get(message.messageId) || 0) >= message.receiptVersion) return;
      receipts.current.set(message.messageId, message.receiptVersion);
      while (receipts.current.size > 256)
        receipts.current.delete(receipts.current.keys().next().value!);
    }
    if (message.type === "thread.mutated") threadListVersion.current++;
    handler.current(message);
  }, []);

  useEffect(() => {
    mounted.current = true;
    if (disabled) return;
    let live = true;
    let timer = 0;
    let warning = 0;
    let watchdog = 0;
    let disconnected = false;
    let failures = 0;
    let resync = false;
    let bootstrapped = false;
    let bootstrapping = false;
    let stream: EventSource | null = null;
    let lastActivity = 0;
    const base = apiBase();
    const schedule = (delay: number, next: () => void) => {
      window.clearTimeout(timer);
      if (live) timer = window.setTimeout(next, delay);
    };
    const closeStream = () => {
      const source = stream;
      stream = null;
      source?.close();
      window.clearTimeout(watchdog);
    };
    const failed = (message = "Live updates are interrupted. Reconnecting automatically…") => {
      if (!live) return;
      setConnected(false);
      if (disconnected) return;
      disconnected = true;
      warning = window.setTimeout(() => {
        if (live && disconnected) setConnectionError(message);
      }, 4_000);
    };
    const clearFailure = () => {
      disconnected = false;
      window.clearTimeout(warning);
      setConnectionError("");
    };
    const healthy = () => {
      clearFailure();
      failures = 0;
      setConnected(true);
    };
    const retryDelay = () => Math.min(30_000, 1000 * 2 ** Math.min(failures++, 5));
    const reset = () => {
      closeStream();
      failed("Session updates were interrupted. Restoring the connection automatically…");
      resync = true;
      bootstrapped = false;
      schedule(0, bootstrap);
    };
    const connect = () => {
      if (!live || !bootstrapped || bootstrapping || hydrating.current || stream) return;
      if (!navigator.onLine) {
        failed();
        return;
      }
      window.clearTimeout(timer);
      let source: EventSource;
      try {
        source = new EventSource(
          `${base}/events/stream?cursor=${cursor.current}&instance=${encodeURIComponent(instance.current)}`,
        );
      } catch {
        failed("Live updates could not be opened. Retry the connection.");
        schedule(retryDelay(), connect);
        return;
      }
      stream = source;
      lastActivity = Date.now();
      const current = () => live && stream === source;
      const interrupted = () => {
        if (!current()) return;
        closeStream();
        failed();
        schedule(retryDelay(), connect);
      };
      const checkHeartbeat = () => {
        if (!current()) return;
        const remaining = 45_000 - (Date.now() - lastActivity);
        if (remaining <= 0) interrupted();
        else watchdog = window.setTimeout(checkHeartbeat, remaining);
      };
      // Also detect a proxy accepting headers without delivering the event stream.
      watchdog = window.setTimeout(interrupted, 12_000);
      source.addEventListener("ready", (event) => {
        if (!current()) return;
        try {
          const data = JSON.parse((event as MessageEvent).data);
          if (data.instance !== instance.current) return reset();
        } catch {
          return interrupted();
        }
        lastActivity = Date.now();
        window.clearTimeout(watchdog);
        watchdog = window.setTimeout(checkHeartbeat, 45_000);
        healthy();
      });
      source.addEventListener("ping", () => {
        if (current()) lastActivity = Date.now();
      });
      source.addEventListener("reset", () => {
        if (current()) reset();
      });
      source.onmessage = (event) => {
        if (!current() || hydrating.current) return;
        lastActivity = Date.now();
        let data: any;
        try {
          data = JSON.parse(event.data);
          if (data.instance !== instance.current || !Number.isSafeInteger(data.cursor))
            return reset();
          if (data.cursor <= cursor.current) return;
          if (data.cursor !== cursor.current + 1 || !data.message) return reset();
        } catch {
          return interrupted();
        }
        cursor.current = data.cursor;
        const threadId = data.message.threadId || data.message.thread?.id;
        const snapshot = snapshots.current.get(threadId);
        if (includedInSnapshot(data, snapshots.current)) return;
        if (snapshot && data.cursor >= snapshot.cursor) snapshots.current.delete(threadId);
        deliver(data.message);
      };
      source.onerror = interrupted;
    };
    const bootstrap = async () => {
      if (!live || bootstrapping) return;
      if (!navigator.onLine) {
        failed("The server is unreachable. Reconnecting automatically…");
        return;
      }
      bootstrapping = true;
      try {
        const listVersion = threadListVersion.current;
        const data = await request(`${base}/bootstrap`);
        if (!live) return;
        if (data.meta)
          deliver({ type: "status", ...data.meta, runtime: data.runtime, bootstrap: true });
        deliver({
          type: "bootstrap.stage",
          stage: data.stage || "starting",
          error: data.error || data.runtime?.lastError || "",
        });
        if (data.settings) deliver({ type: "settings.updated", settings: data.settings });
        if (data.ready) {
          if (instance.current !== (data.eventInstance || "")) {
            receipts.current.clear();
            seenEvents.current.clear();
            snapshots.current.clear();
          }
          cursor.current = data.eventCursor ?? 0;
          instance.current = data.eventInstance || "";
          deliver({
            type: "models",
            models: data.models || [],
            defaultModel: data.defaultModel || "",
            defaultEffort: data.defaultEffort || "",
          });
          if (listVersion === threadListVersion.current)
            deliver({
              type: "threads",
              threads: data.threads || [],
              nextCursor: data.nextCursor || null,
              archived: false,
              refresh: resync,
            });
          deliver({ type: "interactions.snapshot", interactions: data.pendingInteractions || [] });
          deliver({ type: "bootstrap.ready" });
          bootstrapped = true;
          if (resync) {
            resync = false;
            deliver({ type: "events.reset" });
          }
          return;
        }
        clearFailure();
        failures = 0;
        if (data.stage === "error")
          deliver({
            type: "bootstrap.error",
            message: data.runtime?.lastError || "Codex failed to start",
          });
        schedule(data.stage === "error" ? 2500 : 600, bootstrap);
      } catch {
        if (!live) return;
        failed("Session updates could not be loaded. Retrying automatically…");
        schedule(retryDelay(), bootstrap);
      } finally {
        bootstrapping = false;
        if (live && bootstrapped) connect();
      }
    };
    const resume = () => {
      if (!live || hydrating.current) return;
      if (bootstrapped) connect();
      else if (!bootstrapping) schedule(0, bootstrap);
    };
    const retry = () => {
      failures = 0;
      closeStream();
      window.clearTimeout(timer);
      resume();
    };
    const visible = () => {
      if (document.hidden) return;
      if (stream && Date.now() - lastActivity >= 45_000) closeStream();
      resume();
    };
    const offline = () => {
      closeStream();
      window.clearTimeout(timer);
      failed();
    };
    wake.current = resume;
    pauseStream.current = () => {
      closeStream();
      window.clearTimeout(timer);
    };
    reconnect.current = retry;
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("online", retry);
    window.addEventListener("offline", offline);
    void bootstrap();
    return () => {
      live = false;
      mounted.current = false;
      wake.current = () => {};
      pauseStream.current = () => {};
      reconnect.current = () => {};
      closeStream();
      window.clearTimeout(timer);
      window.clearTimeout(warning);
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("online", retry);
      window.removeEventListener("offline", offline);
      for (const controller of requests.current) controller.abort();
    };
  }, [disabled, deliver, request]);

  const send = useCallback(
    async (message: any): Promise<any[]> => {
      if (disabled) return [];
      const listVersion = threadListVersion.current;
      const hydrate = ["thread.resume", "thread.fork"].includes(message.type);
      const stamp = hydrate ? ++epoch.current : epoch.current;
      if (hydrate) {
        hydrating.current++;
        pauseStream.current();
      }
      try {
        const data = await request(
          `${apiBase()}/actions`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(message),
          },
          120_000,
        );
        const messages = data.messages || [];
        for (const item of messages) {
          if (item.type === "threads" && listVersion !== threadListVersion.current) continue;
          if (hydrate && item.type === "thread.active") {
            if (stamp !== epoch.current) continue;
            if (typeof item.eventCursor === "number" && item.thread?.id) {
              // Keep the global cursor: other sessions may have changed during hydration.
              // Only replayed deltas already included in this thread's snapshot are skipped.
              snapshots.current.delete(item.thread.id);
              snapshots.current.set(item.thread.id, {
                cursor: item.eventCursor,
                instance: item.eventInstance || instance.current,
              });
              while (snapshots.current.size > 32)
                snapshots.current.delete(snapshots.current.keys().next().value!);
            }
          }
          deliver({
            ...item,
            action: item.action || message.type,
            requestId: item.requestId ?? message.requestId,
            requestThreadId: message.threadId,
          });
        }
        return messages;
      } catch (error) {
        const detail =
          error instanceof Error && error.name !== "AbortError"
            ? error.message
            : "Request timed out or connection interrupted; retry to check the result";
        const type =
          (
            {
              "fs.list": "fs.entries",
              "fs.read": "fs.file",
              "fs.write": "fs.saved",
              "fs.upload": "fs.uploaded",
              "fs.create": "fs.created",
              "fs.delete": "fs.deleted",
              "workspace.list": "workspace.entries",
            } as Record<string, string>
          )[message.type] || "error";
        const failed = {
          type,
          action: message.type,
          path: message.path,
          requestId: message.requestId,
          threadId: message.threadId,
          messageId: message.clientUserMessageId,
          error: detail,
          message: detail,
          transportError: true,
        };
        deliver(failed);
        return [failed];
      } finally {
        if (hydrate) hydrating.current--;
        wake.current();
      }
    },
    [disabled, deliver, request],
  );
  const retry = useCallback(() => reconnect.current(), []);
  return { connected, connectionError, retry, send };
}
