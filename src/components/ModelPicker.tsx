import { Sparkles } from "lucide-react";
import type { ModelOption } from "../types";
import { ComposerPicker } from "./ComposerPicker";

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
  const selected = models.find((item) => item.model === model || item.id === model);
  return (
    <ComposerPicker
      kind="model"
      label="Model"
      icon={Sparkles}
      value={selected?.model || model}
      placeholder="Choose model"
      options={models.map((item) => ({
        value: item.model,
        label: item.displayName,
        description: item.description,
      }))}
      disabled={disabled}
      onChange={(value) => {
        const next = models.find((item) => item.model === value);
        if (!next) return;
        onModel(next.model);
        if (
          next.model !== selected?.model &&
          effort &&
          !next.supportedReasoningEfforts.some((option) => option.reasoningEffort === effort)
        )
          onEffort(next.defaultReasoningEffort || "");
      }}
    />
  );
}
