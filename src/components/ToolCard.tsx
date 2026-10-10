import { BrainCircuit, CheckCircle2, ChevronRight, FilePenLine, FileText, LoaderCircle, Terminal, XCircle } from "lucide-react";
import { memo, useEffect, useState } from "react";
import type { UiItem } from "../types";

type ToolItem = Exclude<UiItem, { type: "user_message" | "assistant_message" | "generated_image" | "approval" | "error" | "status" }>;
const diffStats = (diff = "") => ({ add: diff.split("\n").filter((line) => line.startsWith("+") && !line.startsWith("+++ ")).length, del: diff.split("\n").filter((line) => line.startsWith("-") && !line.startsWith("--- ")).length });

function TypeIcon({ item }: { item: ToolItem }) {
  if (item.type === "thinking") return <BrainCircuit />;
  if (item.type === "command") return <Terminal />;
  if (item.type === "file_change") return <FilePenLine />;
  return <FileText />;
}

export const ToolCard = memo(function ToolCard({ item }: { item: ToolItem }) {
  const live = (item.type === "thinking" || item.type === "command") && item.status === "running";
  const [open, setOpen] = useState(live);
  useEffect(() => { if (live) setOpen(true); }, [live]);
  const label = item.type === "thinking" ? "Reasoning" : item.type === "command" ? item.command || "Command" : item.type === "file_read" ? item.path : item.path;
  const kicker = item.type === "command" ? "Command" : item.type === "file_change" ? "Edited" : item.type === "file_read" ? "Read" : "Thinking";
  const detail = item.type === "thinking" ? item.text : item.type === "command" ? item.output : item.type === "file_change" ? item.diff : "";
  const stats = item.type === "file_change" ? diffStats(item.diff) : null;
  const failed = item.type === "command" && item.status === "error";
  return <div className={`tool-row ${item.type} ${open ? "open" : ""}`}>
    <button className="tool-summary" onClick={() => setOpen(!open)} aria-expanded={open}>
      <span className="tool-icon"><TypeIcon item={item} /></span><span className="tool-copy"><small>{kicker}</small><b>{label}</b></span>
      {stats && <span className="diff-stats"><b>+{stats.add}</b><i>−{stats.del}</i></span>}
      <span className={`tool-state ${live ? "running" : failed ? "failed" : "done"}`}>{live ? <LoaderCircle /> : failed ? <XCircle /> : <CheckCircle2 />}</span>
      {detail && <ChevronRight className="tool-chevron" />}
    </button>
    {open && detail && <pre className={item.type === "file_change" ? "diff" : "tool-output"}>{detail.slice(-65536).split("\n").slice(-1200).map((line, index) => <span key={index} className={line.startsWith("+") ? "added" : line.startsWith("-") ? "removed" : ""}>{line}{"\n"}</span>)}</pre>}
  </div>;
});
