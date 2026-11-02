import { BrainCircuit } from "lucide-react";
import type { ModelOption } from "../types";
import { ComposerPicker } from "./ComposerPicker";

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
  return (
    <ComposerPicker
      kind="effort"
      label="Reasoning effort"
      icon={BrainCircuit}
      value={effort}
      options={[
        { value: "", label: "Default", description: "Use the model's default reasoning effort" },
        ...efforts.map((item) => ({
          value: item.reasoningEffort,
          label:
            item.reasoningEffort === "xhigh"
              ? "Extra high"
              : item.reasoningEffort.charAt(0).toUpperCase() + item.reasoningEffort.slice(1),
          description: item.description,
        })),
      ]}
      disabled={disabled}
      onChange={onEffort}
    />
  );
}
