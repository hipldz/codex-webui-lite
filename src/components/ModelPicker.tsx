import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Sparkles } from "lucide-react";
import type { ModelOption } from "../types";

export function ModelPicker({
  models,
  model,
  effort,
  onModel,
  onEffort,
  disabled = false,
}: {
  models: ModelOption[];
  model: string;
  effort: string;
  onModel: (model: string) => void;
  onEffort: (effort: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const selected = models.find((item) => item.model === model || item.id === model);
  useEffect(() => {
    if (!open) return;
    if (disabled) {
      setOpen(false);
      return;
    }
    const close = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      root.current?.querySelector("button")?.focus();
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [open, disabled]);
  return (
    <div className="model-control" ref={root}>
      <button
        className="model-trigger"
        type="button"
        disabled={disabled || !models.length}
        aria-label={`Model: ${selected?.displayName || model || "Choose model"}`}
        title={selected?.displayName || model || "Choose model"}
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <Sparkles />
        <span>{selected?.displayName || model || "Choose model"}</span>
        <ChevronDown className="trigger-chevron" />
      </button>
      {open && (
        <div className="model-menu">
          <div className="model-menu-title">
            <Sparkles />
            Model
          </div>
          {models.map((item) => (
            <button
              type="button"
              className={item.model === selected?.model ? "selected" : ""}
              key={item.id}
              onClick={() => {
                onModel(item.model);
                if (
                  item.model !== selected?.model &&
                  effort &&
                  !item.supportedReasoningEfforts.some(
                    (option) => option.reasoningEffort === effort,
                  )
                )
                  onEffort(item.defaultReasoningEffort || "");
                setOpen(false);
              }}
            >
              <span>
                <b>{item.displayName}</b>
                <small>{item.description}</small>
              </span>
              {item.model === selected?.model && <Check />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
