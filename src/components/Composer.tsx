import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ArrowUp,
  ClipboardList,
  Code2,
  CircleHelp,
  ChevronDown,
  Eye,
  FileText,
  FolderOpen,
  LoaderCircle,
  Paperclip,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  Square,
  X,
} from "lucide-react";
import type { CollaborationMode, ModelOption } from "../types";
import type { CompactionStatus, ThreadUsage } from "./SettingsDrawer";
import { ModelPicker } from "./ModelPicker";
import { EffortPicker } from "./EffortPicker";
import { ComposerPicker } from "./ComposerPicker";
import { MOBILE_LAYOUT_QUERY } from "../hooks/useMobileViewport";
import { DraftSubmissions } from "../draft-submissions";

export type ComposerAttachment = {
  id: string;
  name: string;
  mime: string;
  kind: "image" | "audio" | "text" | "file";
  data: string;
  size: number;
};
type ComposerDraft = { text: string; attachments: ComposerAttachment[]; submissionId?: string };
const hasDraft = (draft: ComposerDraft) => Boolean(draft.text || draft.attachments.length);

function resizeComposerInput(element: HTMLTextAreaElement | null) {
  if (!element) return;
  const scrollTop = element.scrollTop;
  element.style.height = "auto";
  element.style.overflowY = "hidden";
  if (!element.value) {
    element.style.removeProperty("height");
    element.scrollTop = 0;
    return;
  }
  const maximum = Number.parseFloat(getComputedStyle(element).maxHeight) || 160;
  element.style.height = `${Math.min(element.scrollHeight, maximum)}px`;
  const overflowing = element.scrollHeight > element.clientHeight;
  element.style.overflowY = overflowing ? "auto" : "hidden";
  element.scrollTop = overflowing ? scrollTop : 0;
}

export type PermissionPreset = "ask" | "full" | "read-only" | "config";
const textTypes = new Set([
  "text/plain",
  "text/markdown",
  "application/json",
  "application/xml",
  "application/javascript",
  "application/typescript",
]);
const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024;
const MAX_TOTAL_ATTACHMENT_SIZE = 10 * 1024 * 1024;
const asDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
const isTextFile = (file: File) =>
  file.type.startsWith("text/") ||
  textTypes.has(file.type) ||
  /\.(txt|md|mdx|json|jsonc|ya?ml|xml|csv|tsv|tsx?|jsx?|mjs|cjs|py|rs|go|java|c|cc|cpp|h|hpp|css|scss|sass|less|html?|sh|bash|zsh|fish|toml|ini|conf|cfg|log|sql|graphql|gql|vue|svelte|kt|kts|swift|rb|php|scala|lua|r|ps1|bat|cmd|diff|patch)$/i.test(
    file.name,
  );
const fileKind = (file: File): ComposerAttachment["kind"] =>
  file.type.startsWith("image/")
    ? "image"
    : file.type.startsWith("audio/")
      ? "audio"
      : isTextFile(file)
        ? "text"
        : "file";
const kindLabel = (kind: ComposerAttachment["kind"]) =>
  kind === "image" ? "Image" : kind === "audio" ? "Audio" : kind === "text" ? "Text file" : "File";

const compactNumber = (value: number) =>
  new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(value);
const permissionLabels: Record<PermissionPreset, string> = {
  ask: "Ask when needed",
  full: "Full access",
  "read-only": "Read-only",
  config: "Use config.toml",
};

function PermissionPicker({
  permission,
  disabled,
  onPermission,
}: {
  permission: PermissionPreset;
  disabled: boolean;
  onPermission: (permission: PermissionPreset) => void;
}) {
  const values = Object.keys(permissionLabels) as PermissionPreset[];
  const activeLabel = permissionLabels[permission];
  const icons = { ask: ShieldCheck, full: ShieldAlert, "read-only": Eye, config: Settings2 };
  return (
    <ComposerPicker
      kind="permission"
      label="Permission for all sessions"
      icon={icons[permission]}
      value={permission}
      disabled={disabled}
      title={`${activeLabel} · All sessions · Applies from the next turn`}
      note="All sessions · Next turns and queued tasks"
      options={values.map((value) => ({
        value,
        label: permissionLabels[value],
        description:
          value === "config"
            ? "Follow each workspace's Codex configuration"
            : value === "full"
              ? "No sandbox or approval prompts"
              : value === "ask"
                ? "Workspace access with approvals"
                : "Inspect files without changes",
      }))}
      onChange={(value) => onPermission(value as PermissionPreset)}
    />
  );
}

export function Composer({
  running,
  sending = false,
  queued = false,
  restoreDraft,
  submissionReceipts,
  draftKey,
  disabled,
  send,
  stop,
  models,
  model,
  effort,
  permission,
  permissionError,
  workspace,
  onChooseWorkspace,
  threadUsage,
  compaction,
  onModel,
  onEffort,
  onPermission,
  mode,
  onMode,
  pendingQuestions = 0,
  pendingApprovals = 0,
  blockingQuestion = false,
  onAnswerQuestion,
  onReviewApproval,
}: {
  running: boolean;
  sending?: boolean;
  queued?: boolean;
  restoreDraft?: {
    id: string;
    threadId: string;
    text: string;
    attachments: ComposerAttachment[];
    submissionId?: string;
    preserveCurrent?: boolean;
  } | null;
  submissionReceipts: ReadonlyMap<string, boolean>;
  draftKey: string;
  disabled: boolean;
  send: (text: string, attachments: ComposerAttachment[], submissionId: string) => Promise<boolean>;
  stop: () => void;
  models: ModelOption[];
  model: string;
  effort: string;
  permission: PermissionPreset;
  permissionError?: string;
  workspace: string;
  onChooseWorkspace: () => void;
  threadUsage: ThreadUsage | null;
  compaction: CompactionStatus;
  onModel: (model: string) => void;
  onEffort: (effort: string) => void;
  onPermission: (permission: PermissionPreset) => void;
  mode: CollaborationMode;
  onMode: (mode: CollaborationMode) => void;
  pendingQuestions?: number;
  pendingApprovals?: number;
  blockingQuestion?: boolean;
  onAnswerQuestion: () => void;
  onReviewApproval: () => void;
}) {
  const unavailable = disabled || sending;
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const drafts = useRef(new Map<string, ComposerDraft>());
  const submissions = useRef(new DraftSubmissions());
  const alternateDrafts = useRef(new Map<string, ComposerDraft[]>());
  const [alternateCount, setAlternateCount] = useState(0);
  const currentDraftKey = useRef(draftKey);
  const currentDraft = useRef({ text, attachments });
  const attachmentTarget = useRef<{ key: string } | null>(null);
  const restoredDraftId = useRef("");
  currentDraft.current = { text, attachments };
  const [attachmentError, setAttachmentError] = useState("");
  const [preview, setPreview] = useState<ComposerAttachment | null>(null);
  const submitting = useRef(false);
  const adding = useRef(false);
  const composing = useRef(false);
  const [addingFiles, setAddingFiles] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (currentDraftKey.current === draftKey) return;
    const previousKey = currentDraftKey.current;
    drafts.current.set(previousKey, currentDraft.current);
    const firstWorkspace =
      previousKey === "workspace:unselected" &&
      draftKey.startsWith("workspace:") &&
      draftKey !== previousKey;
    const createdThread =
      previousKey.startsWith("workspace:") && draftKey.startsWith("thread:") && submitting.current;
    const existing = drafts.current.get(draftKey);
    const transferring =
      (firstWorkspace || createdThread) &&
      (hasDraft(currentDraft.current) || attachmentTarget.current?.key === previousKey);
    if (transferring && existing && hasDraft(existing)) {
      const alternates = alternateDrafts.current.get(draftKey) || [];
      alternates.push(existing);
      alternateDrafts.current.set(draftKey, alternates);
    }
    const next = transferring ? currentDraft.current : existing || { text: "", attachments: [] };
    if (firstWorkspace || createdThread) {
      submissions.current.transfer(previousKey, draftKey);
      drafts.current.delete(previousKey);
      if (attachmentTarget.current?.key === previousKey) attachmentTarget.current.key = draftKey;
    }
    currentDraftKey.current = draftKey;
    currentDraft.current = next;
    setText(next.text);
    setAttachments(next.attachments);
    setAlternateCount(alternateDrafts.current.get(draftKey)?.length || 0);
    setAttachmentError("");
    setPreview(null);
  }, [draftKey]);
  const settleSubmission = (id: string, accepted: boolean) => {
    const key = submissions.current.settle(id, accepted);
    if (!key) return;
    drafts.current.delete(key);
    if (currentDraftKey.current === key) {
      currentDraft.current = { text: "", attachments: [] };
      setText("");
      setAttachments([]);
      setAttachmentError("");
    }
  };
  useEffect(() => {
    for (const [id, accepted] of submissionReceipts) settleSubmission(id, accepted);
  }, [submissionReceipts]);
  useEffect(() => {
    const element = wrapper.current;
    const parent = element?.closest<HTMLElement>(".chat-main");
    if (!element || !parent) return;
    const measure = () =>
      parent.style.setProperty("--composer-height", `${element.getBoundingClientRect().height}px`);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => {
      observer.disconnect();
      parent.style.removeProperty("--composer-height");
    };
  }, []);
  useLayoutEffect(() => {
    resizeComposerInput(area.current);
  }, [text]);
  useEffect(() => {
    const element = area.current;
    if (!element) return;
    const resize = () => resizeComposerInput(element);
    let width = -1;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry || entry.contentRect.width === width) return;
      width = entry.contentRect.width;
      resize();
    });
    observer.observe(element);
    window.addEventListener("resize", resize);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", resize);
    };
  }, []);
  useEffect(() => {
    if (!preview) return;
    const close = (event: KeyboardEvent) => event.key === "Escape" && setPreview(null);
    addEventListener("keydown", close);
    return () => removeEventListener("keydown", close);
  }, [preview]);
  useEffect(() => {
    if (
      restoreDraft &&
      restoreDraft.id !== restoredDraftId.current &&
      !addingFiles &&
      draftKey === `thread:${restoreDraft.threadId}`
    ) {
      restoredDraftId.current = restoreDraft.id;
      if (restoreDraft.submissionId && submissionReceipts.get(restoreDraft.submissionId)) return;
      const current = currentDraft.current;
      const same =
        current.text === restoreDraft.text &&
        current.attachments.length === restoreDraft.attachments.length &&
        current.attachments.every((item, index) => item.id === restoreDraft.attachments[index].id);
      if (!same && hasDraft(current)) {
        const key = currentDraftKey.current;
        const alternates = alternateDrafts.current.get(key) || [];
        if (restoreDraft.preserveCurrent) {
          alternates.push({
            text: restoreDraft.text,
            attachments: restoreDraft.attachments,
            submissionId: restoreDraft.submissionId,
          });
          alternateDrafts.current.set(key, alternates);
          setAlternateCount(alternates.length);
          return;
        }
        alternates.push(current);
        alternateDrafts.current.set(key, alternates);
        setAlternateCount(alternates.length);
      }
      currentDraft.current = { text: restoreDraft.text, attachments: restoreDraft.attachments };
      submissions.current.edit(currentDraftKey.current);
      if (restoreDraft.submissionId)
        submissions.current.restore(currentDraftKey.current, restoreDraft.submissionId);
      setText(restoreDraft.text);
      setAttachments(restoreDraft.attachments);
      area.current?.focus();
    }
  }, [restoreDraft, addingFiles, draftKey, submissionReceipts]);
  const switchDraft = () => {
    const key = currentDraftKey.current;
    const alternates = alternateDrafts.current.get(key);
    if (!alternates?.length || adding.current || submitting.current) return;
    const next = alternates.shift()!;
    if (hasDraft(currentDraft.current)) alternates.push(currentDraft.current);
    if (!alternates.length) alternateDrafts.current.delete(key);
    setAlternateCount(alternates.length);
    currentDraft.current = next;
    submissions.current.edit(key);
    if (next.submissionId) submissions.current.restore(key, next.submissionId);
    setText(next.text);
    setAttachments(next.attachments);
    setAttachmentError("");
    setPreview(null);
    area.current?.focus();
  };
  const submit = async () => {
    if (
      (!text.trim() && !attachments.length) ||
      running ||
      sending ||
      disabled ||
      submitting.current ||
      adding.current ||
      composing.current
    )
      return;
    submitting.current = true;
    const submissionId = submissions.current.begin(currentDraftKey.current);
    try {
      if (await send(text.trim(), attachments, submissionId)) settleSubmission(submissionId, true);
    } catch (error) {
      setAttachmentError(
        error instanceof Error ? error.message : "Could not send; your draft is preserved",
      );
    } finally {
      submitting.current = false;
    }
  };
  const addFiles = async (files: FileList | File[] | null) => {
    if (!files || adding.current) return;
    adding.current = true;
    const target = { key: currentDraftKey.current };
    attachmentTarget.current = target;
    setAddingFiles(true);
    setAttachmentError("");
    try {
      const next: ComposerAttachment[] = [];
      let totalSize = attachments.reduce((sum, attachment) => sum + attachment.size, 0);
      for (const file of Array.from(files).slice(0, Math.max(0, 4 - attachments.length))) {
        const kind = fileKind(file);
        if (file.size > MAX_ATTACHMENT_SIZE) {
          setAttachmentError(`${file.name} is too large (maximum 10 MB)`);
          continue;
        }
        if (totalSize + file.size > MAX_TOTAL_ATTACHMENT_SIZE) {
          setAttachmentError("Attachments exceed the 10 MB total limit");
          continue;
        }
        totalSize += file.size;
        next.push({
          id: crypto.randomUUID(),
          name: file.name,
          mime:
            file.type ||
            (kind === "image"
              ? "image/png"
              : kind === "audio"
                ? "audio/*"
                : kind === "text"
                  ? "text/plain"
                  : "application/octet-stream"),
          kind,
          data: await asDataUrl(file),
          size: file.size,
        });
      }
      if (currentDraftKey.current === target.key) submissions.current.edit(target.key);
      if (currentDraftKey.current === target.key)
        setAttachments((old) => [...old, ...next].slice(0, 4));
      else {
        submissions.current.edit(target.key);
        const saved = drafts.current.get(target.key) || { text: "", attachments: [] };
        drafts.current.set(target.key, {
          ...saved,
          attachments: [...saved.attachments, ...next].slice(0, 4),
        });
      }
      if (input.current) input.current.value = "";
    } catch (error) {
      setAttachmentError(error instanceof Error ? error.message : "Could not read attachment");
    } finally {
      attachmentTarget.current = null;
      adding.current = false;
      setAddingFiles(false);
    }
  };
  const paste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === "file")
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file));
    if (!files.length) return;
    event.preventDefault();
    void addFiles(files);
  };
  const workspacePath = workspace.replaceAll("\\", "/");
  const workspaceParts = workspacePath.split("/").filter(Boolean);
  const workspaceLabel =
    workspaceParts.length > 2 ? `…/${workspaceParts.slice(-2).join("/")}` : workspacePath;
  const selectedModel = models.find((item) => item.model === model || item.id === model);
  const contextPercent = threadUsage?.modelContextWindow
    ? Math.max(
        0,
        Math.min(100, (threadUsage.last.inputTokens / threadUsage.modelContextWindow) * 100),
      )
    : null;
  return (
    <>
      <div className="composer-wrap" ref={wrapper}>
        {pendingApprovals > 0 && (
          <button
            type="button"
            className="question-banner approval-banner"
            onClick={onReviewApproval}
          >
            <ShieldCheck />
            <span>
              {pendingApprovals === 1
                ? "Approval is needed to continue"
                : `${pendingApprovals} approvals need review`}
            </span>
            <b>Review</b>
          </button>
        )}
        {pendingQuestions > 0 && (
          <button type="button" className="question-banner" onClick={onAnswerQuestion}>
            <CircleHelp />
            <span>
              {blockingQuestion
                ? "Your answer is needed to continue"
                : `${pendingQuestions} question${pendingQuestions === 1 ? "" : "s"} from Codex`}
            </span>
            <b>Answer ↑</b>
          </button>
        )}
        <div className="composer-workspace">
          <button
            type="button"
            className={`workspace-trigger${workspace ? "" : " unselected"}`}
            disabled={addingFiles || sending}
            aria-label={workspace ? `Change working folder: ${workspace}` : "Choose working folder"}
            title={workspace || "Choose working folder"}
            onClick={onChooseWorkspace}
          >
            <FolderOpen aria-hidden="true" />
            <span className="workspace-trigger-label">Folder</span>
            <span className="workspace-trigger-path">{workspaceLabel || "Choose folder"}</span>
            <ChevronDown aria-hidden="true" />
          </button>
        </div>
        <div className="composer">
          {alternateCount > 0 && (
            <button
              type="button"
              className="composer-draft-switch"
              disabled={unavailable || running || addingFiles}
              onClick={switchDraft}
            >
              Switch to saved draft ({alternateCount})
            </button>
          )}
          {attachments.length > 0 && (
            <div className="attachment-list">
              {attachments.map((attachment) => (
                <div className="attachment-chip" key={attachment.id}>
                  {attachment.kind === "image" ? (
                    <button
                      type="button"
                      className="attachment-preview-button"
                      aria-label={`View ${attachment.name}`}
                      onClick={() => setPreview(attachment)}
                    >
                      <img src={attachment.data} alt="" />
                    </button>
                  ) : (
                    <span>
                      <FileText />
                    </span>
                  )}
                  <div>
                    <b>{attachment.name}</b>
                    <small>
                      {kindLabel(attachment.kind)} ·{" "}
                      {Math.max(1, Math.round(attachment.size / 1024))} KB
                    </small>
                  </div>
                  <button
                    type="button"
                    className="attachment-remove"
                    aria-label={`Remove ${attachment.name}`}
                    onClick={() => {
                      submissions.current.edit(currentDraftKey.current);
                      setAttachments((old) => old.filter((item) => item.id !== attachment.id));
                    }}
                  >
                    <X />
                  </button>
                </div>
              ))}
            </div>
          )}
          {attachments.length > 0 && (
            <p className="attachment-location-hint">
              Attachments will be saved in Session files when sent.
            </p>
          )}
          {attachmentError && <div className="attachment-error">{attachmentError}</div>}
          {permissionError && (
            <div className="attachment-error" role="alert">
              {permissionError}
            </div>
          )}
          <textarea
            ref={area}
            value={text}
            disabled={unavailable || running || addingFiles}
            rows={1}
            placeholder={
              disabled
                ? "Connect to Codex to start…"
                : queued
                  ? "Waiting in queue…"
                  : blockingQuestion
                    ? "Answer the question above to continue…"
                    : running
                      ? "Codex is working…"
                      : mode === "plan"
                        ? "Describe what you want to plan…"
                        : "Ask Codex to work on your code"
            }
            onPaste={paste}
            onChange={(event) => {
              submissions.current.edit(currentDraftKey.current);
              setText(event.target.value);
            }}
            onCompositionStart={() => {
              composing.current = true;
            }}
            onCompositionEnd={() => {
              composing.current = false;
            }}
            onKeyDown={(event) => {
              if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229)
                return;
              if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !matchMedia(MOBILE_LAYOUT_QUERY).matches
              ) {
                event.preventDefault();
                submit();
              }
            }}
          />
          <div className="composer-toolbar">
            <div className="composer-tools">
              <input
                ref={input}
                className="attachment-input"
                type="file"
                multiple
                disabled={unavailable || running || addingFiles}
                onChange={(event) => addFiles(event.target.files)}
              />
              <button
                className="attach-button"
                type="button"
                disabled={unavailable || running || addingFiles}
                aria-label="Add attachment"
                title="Attach files to this conversation"
                onClick={() => input.current?.click()}
              >
                <Paperclip />
              </button>
              <ModelPicker
                models={models}
                model={model}
                effort={effort}
                onModel={onModel}
                onEffort={onEffort}
                disabled={unavailable || running}
              />
              <EffortPicker
                model={selectedModel}
                effort={effort}
                disabled={unavailable || running}
                onEffort={onEffort}
              />
              <button
                type="button"
                className={`mode-toggle ${mode}`}
                disabled={unavailable || running}
                aria-label={
                  mode === "plan" ? "Plan mode: switch to Code" : "Code mode: switch to Plan"
                }
                aria-pressed={mode === "plan"}
                title={
                  mode === "plan"
                    ? "Explore and plan before making changes"
                    : "Work on the task directly"
                }
                onClick={() => onMode(mode === "plan" ? "default" : "plan")}
              >
                {mode === "plan" ? <ClipboardList /> : <Code2 />}
                <span>{mode === "plan" ? "Plan" : "Code"}</span>
              </button>
              <PermissionPicker
                permission={permission}
                disabled={unavailable}
                onPermission={onPermission}
              />
            </div>
            <div className="composer-actions">
              {(contextPercent != null || compaction) && (
                <div
                  className={`context-indicator ${compaction?.status || ""}`}
                  tabIndex={0}
                  aria-label="Context window usage"
                >
                  <span
                    style={{ "--context-used": `${contextPercent || 0}%` } as React.CSSProperties}
                  >
                    <i />
                  </span>
                  <div className="context-tooltip">
                    <b>
                      {compaction?.status === "running" ? "Compacting context…" : "Context window"}
                    </b>
                    {contextPercent != null && threadUsage?.modelContextWindow ? (
                      <>
                        <strong>
                          {contextPercent.toFixed(0)}% used ({(100 - contextPercent).toFixed(0)}%
                          left)
                        </strong>
                        <em>
                          {compactNumber(threadUsage.last.inputTokens)} /{" "}
                          {compactNumber(threadUsage.modelContextWindow)} tokens used
                        </em>
                      </>
                    ) : (
                      <em>Usage appears after the next response</em>
                    )}
                    {compaction?.status === "completed" && (
                      <small>
                        Context compacted
                        {compaction.at ? ` · ${new Date(compaction.at).toLocaleTimeString()}` : ""}
                      </small>
                    )}
                  </div>
                </div>
              )}
              <button
                className={`send ${running ? "stop" : ""}`}
                aria-label={running ? "Stop" : sending ? "Sending" : "Send"}
                disabled={
                  !running &&
                  (sending || disabled || addingFiles || (!text.trim() && !attachments.length))
                }
                onClick={running ? stop : submit}
              >
                {running ? <Square /> : sending ? <LoaderCircle /> : <ArrowUp />}
              </button>
            </div>
          </div>
        </div>
        <div className="composer-hint">
          Codex can make mistakes. Review changes before committing.
        </div>
      </div>
      {preview && (
        <div
          className="image-lightbox"
          role="dialog"
          aria-label={preview.name}
          onMouseDown={(event) => event.target === event.currentTarget && setPreview(null)}
        >
          <button type="button" aria-label="Close image preview" onClick={() => setPreview(null)}>
            <X />
          </button>
          <img src={preview.data} alt={preview.name} />
        </div>
      )}
    </>
  );
}
