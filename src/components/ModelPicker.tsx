import { useEffect, useRef, useState } from "react";
import { BrainCircuit, Check, ChevronDown, Sparkles } from "lucide-react";
import type { ModelOption } from "../types";

export function ModelPicker({ models, model, effort, onModel, onEffort }: {
  models: ModelOption[];
  model: string;
  effort: string;
  onModel: (model: string) => void;
  onEffort: (effort: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const selected = models.find((item) => item.model === model || item.id === model);
  const efforts = selected?.supportedReasoningEfforts || [];
  const effortIndex = Math.max(0, efforts.findIndex((item) => item.reasoningEffort === effort));
  const effortProgress = efforts.length > 1 ? effortIndex / (efforts.length - 1) * 100 : 0;
  useEffect(() => {
    const close = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close); return () => document.removeEventListener("mousedown", close);
  }, []);
  return <div className="model-control" ref={root}>
    <button className="model-trigger" type="button" onClick={() => setOpen(!open)} aria-expanded={open}>
      <Sparkles /><span>{selected?.displayName || model || "Choose model"}</span><ChevronDown className="trigger-chevron" />
    </button>
    {open && <div className="model-menu">
      <div className="model-menu-title"><Sparkles />Model</div>
      {models.map((item) => <button type="button" className={item.model === selected?.model ? "selected" : ""} key={item.id} onClick={() => { onModel(item.model); onEffort(item.defaultReasoningEffort); }}>
        <span><b>{item.displayName}</b><small>{item.description}</small></span>{item.model === selected?.model && <Check />}
      </button>)}
      {efforts.length > 0 && <><div className="model-menu-title effort-title"><BrainCircuit />Reasoning effort <strong>{efforts[effortIndex]?.reasoningEffort}</strong></div><div className="effort-slider" style={{ "--effort-progress": `${effortProgress}%` } as React.CSSProperties}><input className="effort-range" aria-label="Reasoning effort" type="range" min="0" max={Math.max(0, efforts.length - 1)} step="1" value={effortIndex} onChange={(event) => onEffort(efforts[Number(event.target.value)].reasoningEffort)} /><div className="effort-marks">{efforts.map((item, index) => <button type="button" title={item.description} className={index === effortIndex ? "active" : ""} key={item.reasoningEffort} onClick={() => onEffort(item.reasoningEffort)}>{item.reasoningEffort}</button>)}</div></div></>}
    </div>}
  </div>;
}
