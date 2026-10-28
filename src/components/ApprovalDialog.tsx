import { X } from "lucide-react";
import { useEffect, useRef } from "react";
import type { ApprovalDecision, UiItem } from "../types";
import { ApprovalCard } from "./ApprovalCard";

export function ApprovalDialog({
  item,
  close,
  respond,
}: {
  item: Extract<UiItem, { type: "approval" }>;
  close: () => void;
  respond: (decision: ApprovalDecision) => Promise<void>;
}) {
  const closeButton = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeButton.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
      if (event.key !== "Tab") return;
      const buttons = Array.from(
        dialog.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") || [],
      );
      if (!buttons.length) return;
      if (!buttons.includes(document.activeElement as HTMLButtonElement)) {
        event.preventDefault();
        (event.shiftKey ? buttons[buttons.length - 1] : buttons[0]).focus();
      } else if (event.shiftKey && document.activeElement === buttons[0]) {
        event.preventDefault();
        buttons[buttons.length - 1].focus();
      } else if (!event.shiftKey && document.activeElement === buttons[buttons.length - 1]) {
        event.preventDefault();
        buttons[0].focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (previous?.isConnected) previous.focus();
    };
  }, [close, item.id]);
  return (
    <div
      className="modal-layer approval-layer"
      onMouseDown={(event) => event.target === event.currentTarget && close()}
    >
      <section
        ref={dialog}
        className="approval-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Review approval request"
      >
        <header>
          <b>Review approval request</b>
          <button
            ref={closeButton}
            className="icon-button"
            aria-label="Close approval request"
            onClick={close}
          >
            <X />
          </button>
        </header>
        <ApprovalCard item={item} respond={respond} />
      </section>
    </div>
  );
}
