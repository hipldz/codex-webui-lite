import { Activity, Check, CheckCircle2, ClipboardList, Copy, Download, FileImage, GitFork, Info, LoaderCircle, TriangleAlert, X } from "lucide-react";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ApprovalDecision, UiItem } from "../types";
import { visibleUserText } from "../user-message";
import { markdownUrlTransform, normalizeFilePath, workspaceFile, workspaceLinkUrl } from "../workspace-links";
import { ApprovalCard } from "./ApprovalCard";
import { CodexLogo } from "./CodexLogo";
import { ToolCard } from "./ToolCard";

type ToolItem = Exclude<UiItem, { type: "user_message" | "assistant_message" | "generated_image" | "approval" | "error" | "status" }>;
type Segment = { type: "item"; item: UiItem } | { type: "activity"; id: string; items: ToolItem[] };

function groupItems(items: UiItem[]): Segment[] {
  const result: Segment[] = [];
  for (const item of items) {
    const isTool = !["user_message", "assistant_message", "generated_image", "approval", "error", "status"].includes(item.type);
    const last = result.at(-1);
    if (isTool && last?.type === "activity") last.items.push(item as ToolItem);
    else if (isTool) result.push({ type: "activity", id: `activity-${item.id}`, items: [item as ToolItem] });
    else result.push({ type: "item", item });
  }
  return result;
}

function StatusLine({ item }: { item: Extract<UiItem, { type: "status" }> }) {
  const Icon = item.title.includes("Plan") ? ClipboardList : item.tone === "success" ? CheckCircle2 : item.tone === "warning" ? TriangleAlert : Info;
  return <section className={`status-line ${item.tone || "info"}`}><Icon /><div><b>{item.title}</b>{item.detail && <pre>{item.detail}</pre>}</div></section>;
}

const ActivityGroup = memo(function ActivityGroup({ items }: { items: ToolItem[] }) {
  const active = items.some((item) => (item.type === "thinking" || item.type === "command") && item.status === "running");
  const count = (type: ToolItem["type"]) => items.filter((item) => item.type === type).length;
  const summary = [[count("file_change"), "file"], [count("file_read"), "file read"], [count("command"), "command"], [count("thinking"), "reasoning step"]].filter(([total]) => total).map(([total, label]) => `${total} ${label}${total === 1 ? "" : "s"}`).join(", ") || `${items.length} activities`;
  return <section className={`activity-group ${active ? "running" : ""}`}>
    <header><span className="activity-icon">{active ? <LoaderCircle /> : <Activity />}</span><div><b>{active ? "Working" : summary}</b><small>{active ? "Codex is reasoning and using tools" : "Turn activity · open any row for details"}</small></div></header>
    <div className="activity-list">{items.map((item) => <ToolCard item={item} key={item.id} />)}</div>
  </section>;
}, (before, after) => before.items.length === after.items.length && before.items.every((item, index) => item === after.items[index]));

function MessageTime({ value }: { value?: number }) {
  if (!value) return null;
  const date = new Date(value); if (Number.isNaN(date.getTime())) return null;
  const label = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
  return <time className="message-time" dateTime={date.toISOString()} title={date.toLocaleString()}>{label}</time>;
}

const cleanCitations = (text: string) => text.replace(/cite[^]+/g, "");
async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); return; } catch { /* HTTP and older browsers can require the fallback below. */ }
  const input = document.createElement("textarea"); input.value = text; input.setAttribute("readonly", ""); input.style.position = "fixed"; input.style.opacity = "0"; document.body.appendChild(input); input.select();
  const copied = document.execCommand("copy"); input.remove(); if (!copied) throw new Error("Copy failed");
}
const MarkdownBody = memo(function MarkdownBody({ text, workspace, prefix, fileScope, openFile, setPreviewImage }: { text: string; workspace: string; prefix: string; fileScope: string; openFile: (path: string) => void; setPreviewImage: (image: { src: string; alt: string }) => void }) {
  const resolvedImage = (src: string) => {
    if (/^(https?:|data:|blob:)/i.test(src)) return src;
    const normalized = normalizeFilePath(src);
    if (normalized.startsWith("/") && normalized.includes("/generated_images/")) return `${prefix}/api/generated-images/raw?path=${encodeURIComponent(normalized)}`;
    const local = workspaceFile(src, workspace);
    return local && !local.unavailable ? `${prefix}/api/files/raw?path=${encodeURIComponent(local.path)}${fileScope}` : src;
  };
  return <ReactMarkdown remarkPlugins={[remarkGfm]} urlTransform={markdownUrlTransform} components={{ table: ({ children, ...props }) => <div className="markdown-table"><table {...props}>{children}</table></div>, a: ({ href = "", children, ...props }) => { if (!href) return <span className="unavailable-file-link" title="Invalid file link">{children}</span>; const local = workspaceFile(href, workspace); if (!local) return <a href={href} {...props}>{children}</a>; if (local.unavailable) return <span className="unavailable-file-link" title="This file is outside the selected workspace">{children}</span>; if (/\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i.test(local.path)) { const image = `${prefix}/api/files/raw?path=${encodeURIComponent(local.path)}${fileScope}`; return <span className="assistant-image-link"><button type="button" className="conversation-image" onClick={() => setPreviewImage({ src: image, alt: local.path.split("/").pop() || "Image" })}><img src={image} alt={local.path.split("/").pop()} loading="lazy" /></button><a href={`${prefix}/api/files/download?path=${encodeURIComponent(local.path)}${fileScope}`} download>{children}</a></span>; } return <a className="workspace-file-link" href={workspaceLinkUrl(local.path, prefix)} onClick={(event) => { event.preventDefault(); openFile(local.path); }}>{children}</a>; }, img: ({ src = "", alt = "" }) => { const image = resolvedImage(src); return <button type="button" className="conversation-image" onClick={() => setPreviewImage({ src: image, alt })}><img src={image} alt={alt} loading="lazy" /></button>; } }}>{cleanCitations(text)}</ReactMarkdown>;
});

export function Conversation({ items, threadId, running, queued = false, retry, scrollRequest, workspace, basePath, hasEarlier, loadingEarlier, loadEarlier, openFile, branch, respond }: { items: UiItem[]; threadId: string; running: boolean; queued?: boolean; retry?: (id: string) => void; scrollRequest: number; workspace: string; basePath: string; hasEarlier: boolean; loadingEarlier: boolean; loadEarlier: () => void; openFile: (path: string) => void; branch: (turnId: string) => void; respond: (item: Extract<UiItem, { type: "approval" }>, decision: ApprovalDecision) => void }) {
  const scroll = useRef<HTMLDivElement>(null); const newestUser = useRef<HTMLElement>(null); const lastScrollRequest = useRef(0); const prependHeight = useRef(0); const copiedTimer = useRef<number | undefined>(undefined); const [following, setFollowing] = useState(true); const [previewImage, setPreviewImage] = useState<{ src: string; alt: string } | null>(null); const [copiedId, setCopiedId] = useState("");
  const segments = useMemo(() => groupItems(items.map((item) => item.type === "user_message" ? { ...item, text: visibleUserText(item.text) } : item)), [items]);
  const branchableItems = useMemo(() => {
    const result = new Set<string>(); const turns = new Set<string>();
    // Finishing one reply does not finish the turn; hide all branch actions while busy.
    if (running || queued) return result;
    for (let index = items.length - 1; index >= 0; index--) {
      const item = items[index];
      if ((item.type === "assistant_message" || item.type === "generated_image") && item.turnId && !turns.has(item.turnId)) { result.add(item.id); turns.add(item.turnId); }
    }
    return result;
  }, [items, running, queued]);
  const prefix = basePath === "/" ? "" : basePath;
  const fileScope = `&${new URLSearchParams(threadId ? { threadId } : { workspace })}`;
  const resolvedImage = (src: string) => {
    if (/^(https?:|data:|blob:)/i.test(src)) return src;
    const normalized = normalizeFilePath(src);
    if (normalized.startsWith("/") && normalized.includes("/generated_images/")) return `${prefix}/api/generated-images/raw?path=${encodeURIComponent(normalized)}`;
    const local = workspaceFile(src, workspace);
    return local && !local.unavailable ? `${prefix}/api/files/raw?path=${encodeURIComponent(local.path)}${fileScope}` : src;
  };
  const copyResponse = async (item: UiItem) => { if (item.type !== "assistant_message") return; try { await copyText(item.text); setCopiedId(item.id); window.clearTimeout(copiedTimer.current); copiedTimer.current = window.setTimeout(() => setCopiedId(""), 1600); } catch { setCopiedId(""); } };
  useLayoutEffect(() => { setFollowing(true); setPreviewImage(null); setCopiedId(""); const element = scroll.current; if (element) element.scrollTop = element.scrollHeight; }, [threadId]);
  useEffect(() => () => window.clearTimeout(copiedTimer.current), []);
  useLayoutEffect(() => { const element = scroll.current; if (!element || !prependHeight.current) return; element.scrollTop += element.scrollHeight - prependHeight.current; prependHeight.current = 0; }, [items]);
  useEffect(() => { if (following) scroll.current?.scrollTo({ top: scroll.current.scrollHeight, behavior: "smooth" }); }, [items, following]);
  useEffect(() => { if (scrollRequest === lastScrollRequest.current) return; lastScrollRequest.current = scrollRequest; newestUser.current?.scrollIntoView({ block: "start", behavior: "smooth" }); }, [items, scrollRequest]);
  return <div className="conversation" ref={scroll} onScroll={() => { const element = scroll.current; if (element) setFollowing(element.scrollHeight - element.scrollTop - element.clientHeight < 100); }}>
    <div className="conversation-inner">{hasEarlier && <button type="button" className="load-earlier" disabled={loadingEarlier} onClick={() => { prependHeight.current = scroll.current?.scrollHeight || 0; loadEarlier(); }}>{loadingEarlier && <LoaderCircle />}<span>{loadingEarlier ? "Loading…" : "Show earlier messages"}</span></button>}{items.length === 0 && <div className="empty-chat"><span className="empty-logo"><CodexLogo /></span><h1>What are we coding next?</h1><p>Describe a task, ask a question, or explore this workspace with Codex.</p></div>}
    {segments.map((segment) => segment.type === "activity" ? <ActivityGroup items={segment.items} key={segment.id} /> : segment.item.type === "user_message" ? <article className="message user" key={segment.item.id} ref={(element) => { if (element && segment.item.id === items.at(-1)?.id) newestUser.current = element; }}><div className="user-bubble">{segment.item.attachments?.length ? <div className="user-attachments">{segment.item.attachments.map((attachment, index) => { const ownerThreadId = (segment.item as Extract<UiItem, { type: "user_message" }>).attachmentThreadId || threadId; const attachmentUrl = attachment.id && ownerThreadId ? `${prefix}/attachments/${encodeURIComponent(ownerThreadId)}/${encodeURIComponent(segment.item.id)}/${encodeURIComponent(attachment.id)}` : ""; const image = attachment.data || (attachment.kind === "image" && attachmentUrl ? `${attachmentUrl}?inline=1` : ""); return attachment.kind === "image" && image ? <div className="user-attachment-file user-attachment-image" key={`${attachment.name}-${index}`}><button type="button" className="user-attachment-preview" aria-label={`View ${attachment.name}`} onClick={() => setPreviewImage({ src: image, alt: attachment.name })}><img src={image} alt="" loading="lazy" /></button><span title={attachment.name}>{attachment.name}</span>{attachmentUrl && <a className="user-attachment-download" href={attachmentUrl} download={attachment.name} aria-label={`Download ${attachment.name}`}><Download /></a>}</div> : <div className="user-attachment-file" key={`${attachment.name}-${index}`}><FileImage /><span title={`${attachment.name} · ${attachment.mime || "application/octet-stream"}`}>{attachment.name}</span>{attachmentUrl && <a className="user-attachment-download" href={attachmentUrl} download={attachment.name} aria-label={`Download ${attachment.name}`}><Download /></a>}</div>; })}</div> : null}{segment.item.text && <p>{segment.item.text}</p>}<MessageTime value={segment.item.timestamp} />{segment.item.delivery === "queued" && <small className="delivery-state">Waiting in queue</small>}{segment.item.delivery === "failed" && <div className="delivery-failed"><span>{segment.item.failure || "Message failed"}</span><button type="button" disabled={running} onClick={() => retry?.(segment.item.id)}>Restore draft</button></div>}</div></article>
      : segment.item.type === "assistant_message" ? <article className={`message assistant ${segment.item.streaming ? "is-streaming" : ""}`} key={segment.item.id}><div className="assistant-body"><MarkdownBody text={segment.item.text} workspace={workspace} prefix={prefix} fileScope={fileScope} openFile={openFile} setPreviewImage={setPreviewImage} />{segment.item.streaming && <span className="stream-cursor" />}<MessageTime value={segment.item.timestamp} />{!segment.item.streaming && <div className="message-actions"><button type="button" className={copiedId === segment.item.id ? "copied" : ""} aria-label={copiedId === segment.item.id ? "Copied response" : "Copy response"} title={copiedId === segment.item.id ? "Copied" : "Copy response"} onClick={() => copyResponse(segment.item)}>{copiedId === segment.item.id ? <Check /> : <Copy />}</button>{segment.item.turnId && branchableItems.has(segment.item.id) && <button type="button" disabled={running} aria-label="Branch from this response" title="Branch from this response" onClick={() => branch(segment.item.turnId!)}><GitFork /></button>}</div>}</div></article>
      : segment.item.type === "generated_image" ? <article className="message assistant generated-image" key={segment.item.id}><div className="assistant-media"><button type="button" className="conversation-image" onClick={() => { const image = segment.item as Extract<UiItem, { type: "generated_image" }>; setPreviewImage({ src: resolvedImage(image.src), alt: image.alt }); }}><img src={resolvedImage(segment.item.src)} alt={segment.item.alt} loading="lazy" /></button><MessageTime value={segment.item.timestamp} />{segment.item.turnId && branchableItems.has(segment.item.id) && <div className="message-actions"><button type="button" disabled={running} aria-label="Branch from this response" title="Branch from this response" onClick={() => branch(segment.item.turnId!)}><GitFork /></button></div>}</div></article>
      : segment.item.type === "approval" ? <ApprovalCard key={segment.item.id} item={segment.item} respond={(decision) => respond(segment.item as Extract<UiItem, { type: "approval" }>, decision)} />
      : segment.item.type === "status" ? <StatusLine key={segment.item.id} item={segment.item} />
      : segment.item.type === "error" ? <div className="error-card" key={segment.item.id}>{segment.item.message}</div> : null)}
    {running && !items.some((item) => (item.type === "thinking" && item.status === "running") || (item.type === "assistant_message" && item.streaming)) && <div className="thinking-live"><LoaderCircle /><div><b>{queued ? "Queued" : "Starting"}</b><span>{queued ? "Waiting for another task to finish. You can cancel with Stop." : "Codex is preparing the turn"}</span></div></div>}
    </div>{previewImage && <div className="image-lightbox" role="dialog" aria-label={previewImage.alt || "Image preview"} onMouseDown={(event) => event.target === event.currentTarget && setPreviewImage(null)}><button type="button" aria-label="Close image preview" onClick={() => setPreviewImage(null)}><X /></button><img src={previewImage.src} alt={previewImage.alt} /></div>}
  </div>;
}
