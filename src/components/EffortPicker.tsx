import { BrainCircuit, ChevronDown } from "lucide-react";
import type { ModelOption } from "../types";

export function EffortPicker({
  model,
  effort,
  disabled,
  onEffort,
}: {
  model?: ModelOption;
  effort: string;
  disabled: boolean;
  onEffort: (effort: string) => void;
}) {
  const efforts = model?.supportedReasoningEfforts || [];
  if (!efforts.length) return null;
  const selected = efforts.find((item) => item.reasoningEffort === effort);
  return (
    <label className="effort-control" title={selected?.description || "Reasoning effort"}>
      <BrainCircuit aria-hidden="true" />
      <select
        aria-label="Reasoning effort"
        value={effort}
        disabled={disabled}
        onChange={(event) => onEffort(event.target.value)}
      >
        <option value="">Default</option>
        {efforts.map((item) => (
          <option key={item.reasoningEffort} value={item.reasoningEffort}>
            {item.reasoningEffort === "xhigh"
              ? "Extra high"
              : item.reasoningEffort.charAt(0).toUpperCase() + item.reasoningEffort.slice(1)}
          </option>
        ))}
      </select>
      <ChevronDown aria-hidden="true" />
    </label>
  );
}
