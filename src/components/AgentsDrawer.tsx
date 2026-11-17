import { Bot, ChevronRight, LoaderCircle, RefreshCw, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { AgentResult, AgentStatus, AgentThread } from "../../server/codex/agent-info";

const labels: Record<AgentStatus, string> = {
  running: "Working",
  idle: "Idle",
  completed: "Completed",
  failed: "Failed",
  interrupted: "Interrupted",
  unknown: "Unknown",
};
type AgentList = { agents: AgentThread[]; hasMore?: boolean; warning?: string };

export function AgentsDrawer({
  threadId,
  basePath,
  close,
  demo = false,
}: {
  threadId: string;
  basePath: string;
  close: () => void;
  demo?: boolean;
}) {
  const [list, setList] = useState<AgentList | null>(null);
  const [listError, setListError] = useState("");
  const [selected, setSelected] = useState("");
  const [result, setResult] = useState<AgentResult | null>(null);
  const [resultError, setResultError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const dialog = useRef<HTMLElement>(null);
  const closeRef = useRef(close);
  closeRef.current = close;
  const prefix = basePath === "/" ? "" : basePath;

  // Keep inspection requests and failures inside this panel. They never enter
  // the conversation's transport, hydration, or turn-status handlers.
  const request = async (type: string, signal: AbortSignal, agentId?: string) => {
    const response = await fetch(`${prefix}/api/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, threadId, agentId }),
      signal,
      cache: "no-store",
    });
    const data = await response.json();
    const error = data.messages?.find((message: any) => message.type === "error");
    if (!response.ok || error)
      throw new Error(error?.message || data.error || "Could not load agents");
    const message = data.messages?.find((entry: any) => entry.type.startsWith("agents."));
    if (!message) throw new Error("Could not load agents");
    return message;
  };

  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLButtonElement>('button[aria-label="Close agents"]')?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
      }
      if (event.key === "Tab") {
        const buttons =
          dialog.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)");
        if (!buttons?.length) return;
        const first = buttons[0];
        const last = buttons[buttons.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", keydown);
    return () => {
      document.removeEventListener("keydown", keydown);
      if (trigger?.isConnected) trigger.focus();
    };
  }, []);

  useEffect(() => {
    let live = true;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 20_000);
    setLoading(true);
    setListError("");
    const work: Promise<AgentList> = demo
      ? Promise.resolve({ agents: [] })
      : request("thread.agents", controller.signal);
    void work
      .then((data) => {
        if (controller.signal.aborted) return;
        setList(data);
        setSelected((id) => (data.agents.some((agent) => agent.id === id) ? id : ""));
      })
      .catch((error) => {
        if (!live) return;
        if (!controller.signal.aborted) setListError(String(error.message || error));
        else setListError("Loading agents timed out. Refresh to retry.");
      })
      .finally(() => {
        window.clearTimeout(timer);
        if (live) setLoading(false);
      });
    return () => {
      live = false;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [threadId, prefix, refresh, demo]);

  useEffect(() => {
    setResult(null);
    setResultError("");
    if (!selected) return;
    let live = true;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 20_000);
    void request("thread.agentResult", controller.signal, selected)
      .then((data) => {
        if (!controller.signal.aborted) setResult(data);
      })
      .catch((error) => {
        if (!live) return;
        setResultError(
          controller.signal.aborted
            ? "Loading the result timed out. Refresh to retry."
            : error.message,
        );
      })
      .finally(() => window.clearTimeout(timer));
    return () => {
      live = false;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [threadId, prefix, selected, refresh]);

  return (
    <div
      className="drawer-layer"
      onMouseDown={(event) => event.target === event.currentTarget && close()}
    >
      <section
        ref={dialog}
        className="agents-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="agents-title"
      >
        <header>
          <div>
            <span>Current thread</span>
            <b id="agents-title">Agents{list ? ` · ${list.agents.length}` : ""}</b>
          </div>
          <button
            className="icon-button"
            aria-label="Refresh agents"
            disabled={loading}
            onClick={() => setRefresh((value) => value + 1)}
          >
            <RefreshCw />
          </button>
          <button className="icon-button" aria-label="Close agents" onClick={close}>
            <X />
          </button>
        </header>
        <div className="agents-body">
          <p className="agents-note">
            Tasks delegated by this thread. Refresh to see the latest status and results.
          </p>
          {(listError || list?.warning) && (
            <p className="agents-error" role="status">
              {listError || list?.warning}
            </p>
          )}
          {loading && (
            <p className="agents-note" role="status">
              Loading agents…
            </p>
          )}
          {!loading && !listError && list?.agents.length === 0 && (
            <div className="preview-empty">
              <Bot />
              <b>No agents yet</b>
              <p>Delegated tasks will appear here.</p>
            </div>
          )}
          {list?.agents.map((agent) => {
            const open = selected === agent.id;
            const status = open && result ? result.status : agent.status;
            return (
              <article className="agent-card" key={agent.id}>
                <button
                  className="agent-summary"
                  aria-expanded={open}
                  onClick={() => {
                    setResult(null);
                    setResultError("");
                    setSelected(open ? "" : agent.id);
                  }}
                >
                  <Bot />
                  <span className="agent-name">
                    <b>{agent.name}</b>
                    <small>{agent.task || "Delegated task"}</small>
                  </span>
                  <span className={`agent-state ${status}`}>{agent.waiting || labels[status]}</span>
                  <ChevronRight className={open ? "expanded" : ""} />
                </button>
                {open && (
                  <div className="agent-detail">
                    {!result && !resultError && (
                      <p className="agents-note" role="status">
                        <LoaderCircle /> Loading result…
                      </p>
                    )}
                    {resultError && (
                      <p className="agents-error" role="status">
                        {resultError}
                      </p>
                    )}
                    {result?.error && <p className="agents-error">{result.error}</p>}
                    {result?.text ? (
                      <pre className="agent-result">{result.text}</pre>
                    ) : result ? (
                      <p className="agents-note">
                        {result.status === "running"
                          ? "Still working. Refresh later to view the final result."
                          : "No final result is available."}
                      </p>
                    ) : null}
                    {result?.truncated && (
                      <p className="agents-note">The result is longer than the preview limit.</p>
                    )}
                  </div>
                )}
              </article>
            );
          })}
          {list?.hasMore && (
            <p className="agents-note">Showing up to 50 recent and 50 archived agents.</p>
          )}
        </div>
      </section>
    </div>
  );
}
