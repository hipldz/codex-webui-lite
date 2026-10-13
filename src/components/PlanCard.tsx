import { ArrowUpRight, ClipboardList, LoaderCircle, Pencil } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import type { UiItem } from "../types";

export function PlanCard({
  item,
  actionable,
  disabled,
  children,
  implement,
  revise,
}: {
  item: Extract<UiItem, { type: "plan" }>;
  actionable: boolean;
  disabled: boolean;
  children: ReactNode;
  implement: () => Promise<boolean>;
  revise: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState("");
  const run = async () => {
    if (lock.current || disabled) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      if (!(await implement())) setError("Could not start execution. Please retry.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not start execution.");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  return (
    <section className="plan-card">
      <header>
        <span className="interaction-icon">
          {item.streaming ? <LoaderCircle /> : <ClipboardList />}
        </span>
        <div>
          <b>{item.streaming ? "Preparing a plan" : "Proposed plan"}</b>
          <small>
            {actionable
              ? "Review the plan, then choose what happens next"
              : item.streaming
                ? "Codex is working through the approach"
                : "Plan saved in this conversation"}
          </small>
        </div>
      </header>
      <details open={item.streaming || actionable}>
        <summary>View plan</summary>
        <div className="assistant-body plan-body">{children}</div>
      </details>
      {actionable && (
        <footer>
          <button
            type="button"
            className="interaction-secondary"
            disabled={disabled || busy}
            onClick={revise}
          >
            <Pencil />
            Revise plan
          </button>
          <button
            type="button"
            className="interaction-primary"
            disabled={disabled || busy}
            onClick={() => void run()}
          >
            {busy ? <LoaderCircle /> : <ArrowUpRight />}
            {busy ? "Starting…" : "Implement this plan"}
          </button>
        </footer>
      )}
      {error && (
        <p className="interaction-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
