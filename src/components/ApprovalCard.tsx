import { ShieldCheck, Terminal } from "lucide-react";
import { useRef, useState } from "react";
import type { ApprovalDecision, UiItem } from "../types";

const decisionKey = (decision: ApprovalDecision) =>
  typeof decision === "string" ? decision : Object.keys(decision)[0] || "unknown";
export function ApprovalCard({
  item,
  respond,
}: {
  item: Extract<UiItem, { type: "approval" }>;
  respond?: (decision: ApprovalDecision) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submitting = useRef(false);
  const submit = async (decision: ApprovalDecision) => {
    if (!respond || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      await respond(decision);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not submit the approval.");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };
  const label: Record<string, string> = {
    accept: "Allow once",
    acceptForSession: "Allow this session",
    acceptWithExecpolicyAmendment: "Allow + update exec policy",
    applyNetworkPolicyAmendment: "Allow + update network policy",
    decline: "Deny",
    cancel: "Cancel",
  };
  return (
    <section id={`interaction-${item.id}`} className={`approval-card ${item.status}`}>
      <span className="approval-icon">
        <ShieldCheck />
      </span>
      <div className="approval-content">
        <header>
          <div>
            <b>Approval required</b>
            <span>
              Codex wants to {item.approvalKind === "command" ? "run a command" : "modify files"}
            </span>
          </div>
        </header>
        <code>
          {item.approvalKind === "command" && <Terminal />}
          {item.description}
        </code>
        {item.status === "pending" ? (
          <div className="approval-actions">
            {item.decisions.map((decision, index) => {
              const key = decisionKey(decision);
              return (
                <button
                  key={`${key}-${index}`}
                  className={
                    key.startsWith("accept") || key.startsWith("apply")
                      ? "primary"
                      : key === "decline"
                        ? "danger"
                        : ""
                  }
                  disabled={busy || !respond}
                  onClick={() => void submit(decision)}
                >
                  {label[key] || key}
                </button>
              );
            })}
          </div>
        ) : (
          <small>
            {item.status === "approved"
              ? "Approved"
              : item.status === "denied"
                ? "Denied"
                : "No longer pending"}
          </small>
        )}
        {error && (
          <p className="interaction-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
