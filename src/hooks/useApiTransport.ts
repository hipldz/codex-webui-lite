import { useCallback, useEffect, useRef, useState } from "react";

const apiBase = () => `${location.pathname.replace(/\/?$/, "/")}api`;

export function useApiTransport(onMessage: (message: any) => void, disabled = false) {
  const handler = useRef(onMessage); handler.current = onMessage;
  const cursor = useRef(0); const instance = useRef("");
  const [connected, setConnected] = useState(disabled);
  const runningThreads = useRef(new Set<string>());
  const receipts = useRef(new Map<string, number>());
  const wake = useRef<() => void>(() => {});
  const requests = useRef(new Set<AbortController>());
  const mounted = useRef(true); const hydrating = useRef(0); const epoch = useRef(0);

  const request = useCallback(async (url: string, init?: RequestInit, timeout = 12_000) => {
    const controller = new AbortController(); requests.current.add(controller);
    const timer = window.setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(url, { ...init, cache: "no-store", signal: controller.signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
      return data;
    } finally { window.clearTimeout(timer); requests.current.delete(controller); }
  }, []);

  const deliver = useCallback((message: any) => {
    if (!mounted.current) return;
    if (message.messageId && message.receiptVersion) {
      if ((receipts.current.get(message.messageId) || 0) >= message.receiptVersion) return;
      receipts.current.set(message.messageId, message.receiptVersion);
      while (receipts.current.size > 256) receipts.current.delete(receipts.current.keys().next().value!);
    }
    if (message.type === "status" && ["stopped", "error"].includes(message.codexStatus)) runningThreads.current.clear();
    const id = message.threadId || message.thread?.id;
    if (id) {
      const running = message.type === "turn.queued" ? true : message.type === "turn.accepted" ? message.running !== false : message.type === "turn.failed" ? false : message.queued || (message.threadStatus ? message.threadStatus.type === "active" : message.running);
      if (running === true) runningThreads.current.add(id); else if (running === false) runningThreads.current.delete(id);
    }
    handler.current(message);
  }, []);

  useEffect(() => {
    mounted.current = true;
    if (disabled) return;
    let live = true; let timer = 0; let polling = false; let failures = 0; let resync = false; let bootstrapped = false;
    const base = apiBase();
    const schedule = (delay: number, next = poll) => { window.clearTimeout(timer); if (live) timer = window.setTimeout(next, delay); };
    const bootstrap = async () => {
      try {
        const data = await request(`${base}/bootstrap`); if (!live) return;
        setConnected(true);
        if (data.meta) deliver({ type: "status", ...data.meta, runtime: data.runtime, bootstrap: true });
        deliver({ type: "bootstrap.stage", stage: data.stage || "starting", error: data.error || data.runtime?.lastError || "" });
        if (data.ready) {
          bootstrapped = true;
          if (instance.current !== (data.eventInstance || "")) receipts.current.clear();
          cursor.current = data.eventCursor ?? 0; instance.current = data.eventInstance || "";
          runningThreads.current = new Set((data.threads || []).filter((thread: any) => thread.status?.type === "active").map((thread: any) => thread.id));
          deliver({ type: "models", models: data.models || [], defaultModel: data.defaultModel || "", defaultEffort: data.defaultEffort || "", defaultPermission: data.defaultPermission || "ask", defaultPermissionLabel: data.defaultPermissionLabel || "Ask when needed (Codex default)" });
          deliver({ type: "threads", threads: data.threads || [], nextCursor: data.nextCursor || null, archived: false });
          deliver({ type: "bootstrap.ready" });
          if (resync) { resync = false; deliver({ type: "events.reset" }); }
          failures = 0; schedule(0); return;
        }
        if (data.stage === "error") deliver({ type: "bootstrap.error", message: data.runtime?.lastError || "Codex failed to start" });
        schedule(data.stage === "error" ? 2500 : 600, bootstrap);
      } catch (error) {
        if (!live) return;
        setConnected(false); deliver({ type: "bootstrap.error", message: error instanceof Error ? error.message : "Connection failed" });
        schedule(Math.min(30_000, 1000 * 2 ** Math.min(++failures, 5)), bootstrap);
      }
    };
    const poll = async () => {
      if (!live) return;
      if (polling || hydrating.current) { schedule(150); return; }
      polling = true; const stamp = epoch.current; let more = false;
      try {
        const data = await request(`${base}/events?cursor=${cursor.current}&instance=${encodeURIComponent(instance.current)}`);
        if (!live) return;
        if (stamp === epoch.current) {
          if (data.reset) { resync = true; bootstrapped = false; polling = false; schedule(0, bootstrap); return; }
          cursor.current = data.cursor ?? cursor.current; instance.current = data.instance || instance.current;
          for (const event of data.events || []) deliver(event.message);
          more = Boolean(data.more);
        }
        failures = 0; setConnected(true);
      } catch { if (live) { setConnected(false); failures++; } }
      finally { polling = false; }
      schedule(failures ? Math.min(30_000, 1000 * 2 ** Math.min(failures, 5)) : more ? 0 : document.hidden ? 15_000 : runningThreads.current.size ? 650 : 2500);
    };
    const visible = () => { if (!document.hidden) schedule(0, bootstrapped ? poll : bootstrap); };
    wake.current = visible; document.addEventListener("visibilitychange", visible); window.addEventListener("online", visible);
    void bootstrap();
    return () => { live = false; mounted.current = false; wake.current = () => {}; window.clearTimeout(timer); document.removeEventListener("visibilitychange", visible); window.removeEventListener("online", visible); for (const controller of requests.current) controller.abort(); };
  }, [disabled, deliver, request]);

  const send = useCallback(async (message: any): Promise<any[]> => {
    if (disabled) return [];
    const hydrate = ["thread.resume", "thread.fork"].includes(message.type);
    if (hydrate) { hydrating.current++; epoch.current++; }
    try {
      const data = await request(`${apiBase()}/actions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(message) }, 120_000);
      const messages = data.messages || [];
      for (const item of messages) {
        if (hydrate && item.type === "thread.active" && typeof item.eventCursor === "number") { cursor.current = item.eventCursor; instance.current = item.eventInstance || instance.current; }
        deliver({ ...item, action: item.action || message.type, requestId: item.requestId ?? message.requestId, requestThreadId: message.threadId });
      }
      return messages;
    } catch (error) {
      const detail = error instanceof Error && error.name !== "AbortError" ? error.message : "Request timed out or connection interrupted; retry to check the result";
      const type = ({ "fs.list": "fs.entries", "fs.read": "fs.file", "fs.write": "fs.saved", "fs.upload": "fs.uploaded", "fs.create": "fs.created", "fs.delete": "fs.deleted", "workspace.list": "workspace.entries" } as Record<string, string>)[message.type] || "error";
      const failed = { type, action: message.type, path: message.path, requestId: message.requestId, threadId: message.threadId, messageId: message.clientUserMessageId, error: detail, message: detail, transportError: true };
      deliver(failed); return [failed];
    } finally { if (hydrate) hydrating.current--; wake.current(); }
  }, [disabled, deliver, request]);
  return { connected, send };
}
