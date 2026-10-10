import { useEffect, useRef, useState } from "react";
import { ArrowUp, Check, ChevronDown, FileText, Paperclip, ShieldCheck, Square, X } from "lucide-react";
import type { ModelOption } from "../types";
import type { CompactionStatus, ThreadUsage } from "./SettingsDrawer";
import { ModelPicker } from "./ModelPicker";

export type ComposerAttachment = { id: string; name: string; mime: string; kind: "image" | "audio" | "text" | "file"; data: string; size: number };
export type PermissionPreset = "ask" | "full" | "read-only" | "config";
const textTypes = new Set(["text/plain", "text/markdown", "application/json", "application/xml", "application/javascript", "application/typescript"]);
const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024;
const MAX_TOTAL_ATTACHMENT_SIZE = 10 * 1024 * 1024;
const asDataUrl = (file: File) => new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file); });
const isTextFile = (file: File) => file.type.startsWith("text/") || textTypes.has(file.type) || /\.(txt|md|mdx|json|jsonc|ya?ml|xml|csv|tsv|tsx?|jsx?|mjs|cjs|py|rs|go|java|c|cc|cpp|h|hpp|css|scss|sass|less|html?|sh|bash|zsh|fish|toml|ini|conf|cfg|log|sql|graphql|gql|vue|svelte|kt|kts|swift|rb|php|scala|lua|r|ps1|bat|cmd|diff|patch)$/i.test(file.name);
const fileKind = (file: File): ComposerAttachment["kind"] => file.type.startsWith("image/") ? "image" : file.type.startsWith("audio/") ? "audio" : isTextFile(file) ? "text" : "file";
const kindLabel = (kind: ComposerAttachment["kind"]) => kind === "image" ? "Image" : kind === "audio" ? "Audio" : kind === "text" ? "Text file" : "File";

const compactNumber = (value: number) => new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(value);
const permissionLabels: Record<PermissionPreset, string> = { ask: "Ask when needed", full: "Full access", "read-only": "Read-only", config: "Use config.toml" };

function PermissionPicker({ permission, configPermissionLabel, disabled, onPermission }: { permission: PermissionPreset; configPermissionLabel: string; disabled: boolean; onPermission: (permission: PermissionPreset) => void }) {
  const [open, setOpen] = useState(false); const root = useRef<HTMLDivElement>(null);
  useEffect(() => { const close = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); }; document.addEventListener("mousedown", close); return () => document.removeEventListener("mousedown", close); }, []);
  const values = Object.keys(permissionLabels) as PermissionPreset[];
  const activeLabel = permission === "config" ? configPermissionLabel : permissionLabels[permission];
  return <div className="permission-control" ref={root}>
    <button className="permission-trigger" type="button" disabled={disabled} aria-label="Session permission" aria-expanded={open} onClick={() => setOpen((value) => !value)}><ShieldCheck /><span>{activeLabel}</span><ChevronDown /></button>
    {open && <div className="permission-menu">{values.map((value) => <button type="button" className={value === permission ? "selected" : ""} key={value} onClick={() => { onPermission(value); setOpen(false); }}><span><b>{value === "config" ? "Use config.toml" : permissionLabels[value]}</b><small>{value === "config" ? configPermissionLabel : value === "full" ? "No sandbox or approval prompts" : value === "ask" ? "Workspace access with approvals" : "Inspect files without changes"}</small></span>{value === permission && <Check />}</button>)}</div>}
  </div>;
}

export function Composer({ running, queued = false, restoreDraft, disabled, send, stop, models, model, effort, permission, configPermissionLabel, threadUsage, compaction, onModel, onEffort, onPermission }: { running: boolean; queued?: boolean; restoreDraft?: { id: string; text: string; attachments: ComposerAttachment[] } | null; disabled: boolean; send: (text: string, attachments: ComposerAttachment[]) => Promise<boolean>; stop: () => void; models: ModelOption[]; model: string; effort: string; permission: PermissionPreset; configPermissionLabel: string; threadUsage: ThreadUsage | null; compaction: CompactionStatus; onModel: (model: string) => void; onEffort: (effort: string) => void; onPermission: (permission: PermissionPreset) => void }) {
  const [text, setText] = useState(""); const [attachments, setAttachments] = useState<ComposerAttachment[]>([]); const [attachmentError, setAttachmentError] = useState(""); const [preview, setPreview] = useState<ComposerAttachment | null>(null);
  const submitting = useRef(false); const adding = useRef(false); const composing = useRef(false);
  const [addingFiles, setAddingFiles] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null); const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (area.current) { area.current.style.height = "0"; area.current.style.height = `${Math.min(area.current.scrollHeight, 160)}px`; } }, [text]);
  useEffect(() => { if (!preview) return; const close = (event: KeyboardEvent) => event.key === "Escape" && setPreview(null); addEventListener("keydown", close); return () => removeEventListener("keydown", close); }, [preview]);
  useEffect(() => { if (restoreDraft) { setText(restoreDraft.text); setAttachments(restoreDraft.attachments); area.current?.focus(); } }, [restoreDraft]);
  const submit = async () => {
    if ((!text.trim() && !attachments.length) || running || disabled || submitting.current || adding.current || composing.current) return;
    submitting.current = true;
    try { if (await send(text.trim(), attachments)) { setText(""); setAttachments([]); setAttachmentError(""); } }
    catch (error) { setAttachmentError(error instanceof Error ? error.message : "Could not send; your draft is preserved"); }
    finally { submitting.current = false; }
  };
  const addFiles = async (files: FileList | File[] | null) => {
    if (!files || adding.current) return; adding.current = true; setAddingFiles(true); setAttachmentError("");
    try {
    const next: ComposerAttachment[] = [];
    let totalSize = attachments.reduce((sum, attachment) => sum + attachment.size, 0);
    for (const file of Array.from(files).slice(0, Math.max(0, 4 - attachments.length))) {
      const kind = fileKind(file);
      if (file.size > MAX_ATTACHMENT_SIZE) { setAttachmentError(`${file.name} is too large (maximum 10 MB)`); continue; }
      if (totalSize + file.size > MAX_TOTAL_ATTACHMENT_SIZE) { setAttachmentError("Attachments exceed the 10 MB total limit"); continue; }
      totalSize += file.size;
      next.push({ id: crypto.randomUUID(), name: file.name, mime: file.type || (kind === "image" ? "image/png" : kind === "audio" ? "audio/*" : kind === "text" ? "text/plain" : "application/octet-stream"), kind, data: await asDataUrl(file), size: file.size });
    }
    setAttachments((old) => [...old, ...next].slice(0, 4)); if (input.current) input.current.value = "";
    } catch (error) { setAttachmentError(error instanceof Error ? error.message : "Could not read attachment"); } finally { adding.current = false; setAddingFiles(false); }
  };
  const paste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData.items).filter((item) => item.kind === "file").map((item) => item.getAsFile()).filter((file): file is File => Boolean(file));
    if (!files.length) return;
    event.preventDefault(); void addFiles(files);
  };
  const contextPercent = threadUsage?.modelContextWindow ? Math.max(0, Math.min(100, threadUsage.last.inputTokens / threadUsage.modelContextWindow * 100)) : null;
  return <><div className="composer-wrap"><div className="composer">
    {attachments.length > 0 && <div className="attachment-list">{attachments.map((attachment) => <div className="attachment-chip" key={attachment.id}>{attachment.kind === "image" ? <button type="button" className="attachment-preview-button" aria-label={`View ${attachment.name}`} onClick={() => setPreview(attachment)}><img src={attachment.data} alt="" /></button> : <span><FileText /></span>}<div><b>{attachment.name}</b><small>{kindLabel(attachment.kind)} · {Math.max(1, Math.round(attachment.size / 1024))} KB</small></div><button type="button" className="attachment-remove" aria-label={`Remove ${attachment.name}`} onClick={() => setAttachments((old) => old.filter((item) => item.id !== attachment.id))}><X /></button></div>)}</div>}
    {attachmentError && <div className="attachment-error">{attachmentError}</div>}
    <textarea ref={area} value={text} disabled={disabled || running || addingFiles} rows={1} placeholder={disabled ? "Connect to Codex to start…" : queued ? "Waiting in queue…" : running ? "Codex is working…" : "Ask Codex to work on your code"} onPaste={paste} onChange={(event) => setText(event.target.value)} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} onKeyDown={(event) => { if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) return; if (event.key === "Enter" && !event.shiftKey && matchMedia("(min-width: 701px)").matches) { event.preventDefault(); submit(); } }} />
    <div className="composer-toolbar"><div className="composer-tools"><input ref={input} className="attachment-input" type="file" multiple disabled={disabled || running || addingFiles} onChange={(event) => addFiles(event.target.files)} /><button className="attach-button" type="button" disabled={disabled || running || addingFiles} aria-label="Add attachment" onClick={() => input.current?.click()}><Paperclip /></button><ModelPicker models={models} model={model} effort={effort} onModel={onModel} onEffort={onEffort} /><PermissionPicker permission={permission} configPermissionLabel={configPermissionLabel} disabled={running} onPermission={onPermission} />{effort && <span className="effort-chip">{effort}</span>}</div>
      <div className="composer-actions">{(contextPercent != null || compaction) && <div className={`context-indicator ${compaction?.status || ""}`} tabIndex={0} aria-label="Context window usage"><span style={{ "--context-used": `${contextPercent || 0}%` } as React.CSSProperties}><i /></span><div className="context-tooltip"><b>{compaction?.status === "running" ? "Compacting context…" : "Context window"}</b>{contextPercent != null && threadUsage?.modelContextWindow ? <><strong>{contextPercent.toFixed(0)}% used ({(100 - contextPercent).toFixed(0)}% left)</strong><em>{compactNumber(threadUsage.last.inputTokens)} / {compactNumber(threadUsage.modelContextWindow)} tokens used</em></> : <em>Usage appears after the next response</em>}{compaction?.status === "completed" && <small>Context compacted{compaction.at ? ` · ${new Date(compaction.at).toLocaleTimeString()}` : ""}</small>}</div></div>}<button className={`send ${running ? "stop" : ""}`} aria-label={running ? "Stop" : "Send"} disabled={!running && (disabled || addingFiles || (!text.trim() && !attachments.length))} onClick={running ? stop : submit}>{running ? <Square /> : <ArrowUp />}</button></div>
    </div>
  </div><div className="composer-hint">Codex can make mistakes. Review changes before committing.</div></div>{preview && <div className="image-lightbox" role="dialog" aria-label={preview.name} onMouseDown={(event) => event.target === event.currentTarget && setPreview(null)}><button type="button" aria-label="Close image preview" onClick={() => setPreview(null)}><X /></button><img src={preview.data} alt={preview.name} /></div>}</>;
}
