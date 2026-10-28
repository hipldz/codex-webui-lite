import crypto from "node:crypto";
import { constants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { codexHome } from "./config.js";

export type AttachmentKind = "image" | "audio" | "text" | "file";

export type IncomingAttachment = {
  id?: unknown;
  name?: unknown;
  mime?: unknown;
  kind?: unknown;
  data?: unknown;
};

export type AttachmentSummary = {
  id: string;
  name: string;
  mime: string;
  kind: AttachmentKind;
  size: number;
  data?: string;
};

export type PreparedAttachment = AttachmentSummary & {
  bytes: Buffer;
  dataUrl: string;
  text?: string;
};

export type PersistedMessage = {
  messageId: string;
  prompt: string;
  attachments: AttachmentSummary[];
  prepared: PreparedAttachment[];
  paths: string[];
};

type ManifestAttachment = Omit<AttachmentSummary, "data"> & {
  relativePath: string;
  sha256: string;
};

type AttachmentManifest = {
  version: 1;
  threadId: string;
  messageId: string;
  turnId?: string;
  prompt: string;
  createdAt: number;
  attachments: ManifestAttachment[];
};

type DownloadableAttachment = {
  path: string;
  name: string;
  mime: string;
  size: number;
};

type AttachmentLocation = { root: string; layout: "flat" | "uploads" | "legacy" };

const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024;
const MAX_TOTAL_ATTACHMENT_SIZE = 10 * 1024 * 1024;
const TOKEN = /^[A-Za-z0-9_-]{1,160}$/;

const asToken = (value: unknown, fallback: string = crypto.randomUUID()): string => {
  const candidate = typeof value === "string" ? value : "";
  return TOKEN.test(candidate) ? candidate : fallback;
};

const safeName = (value: unknown) => {
  const original = typeof value === "string" ? value : "";
  const leaf = original.replaceAll("\\", "/").split("/").pop() || "attachment";
  const cleaned = leaf.replace(/[\u0000-\u001f<>:"|?*]/g, "_").trim();
  if (!cleaned || cleaned === "." || cleaned === "..") return "attachment";
  return cleaned;
};

const truncateUtf8 = (value: string, maxBytes: number) => {
  let result = "";
  let bytes = 0;
  for (const character of value) {
    bytes += Buffer.byteLength(character, "utf8");
    if (bytes > maxBytes) break;
    result += character;
  }
  return result;
};

/** Exclusive creation handles collisions with uploads, generated files and directories. */
async function createAttachmentFile(
  directory: string,
  originalName: string,
  create: (file: string) => Promise<void>,
) {
  let name = safeName(originalName);
  // Keep user uploads separate from the internal manifests hidden by Session files.
  if (name.startsWith(".codex-web-") || name.startsWith(".manifest-")) name = `_${name}`;
  const parsed = path.parse(name);
  const extension = truncateUtf8(parsed.ext, 240);
  for (let number = 1; ; number++) {
    const suffix = number === 1 ? "" : ` (${number})`;
    const fileName = `${truncateUtf8(parsed.name, 255 - Buffer.byteLength(extension + suffix, "utf8"))}${suffix}${extension}`;
    const file = path.join(directory, fileName);
    try {
      await create(file);
      return file;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
}

const dataUrl = (mime: string, bytes: Buffer) => `data:${mime};base64,${bytes.toString("base64")}`;

function decodeData(value: unknown) {
  if (typeof value !== "string") throw new Error("Attachment data is missing");
  const match = value.match(/^data:([^;,]+)?((?:;[^,]*)?),([\s\S]*)$/i);
  if (!match) return { bytes: Buffer.from(value, "utf8"), mime: "" };

  const metadata = match[2] || "";
  const encoded = match[3];
  if (/;base64(?:;|$)/i.test(metadata)) {
    const compact = encoded.replace(/\s/g, "");
    if (compact.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(compact))
      throw new Error("Invalid base64 attachment data");
    return { bytes: Buffer.from(compact, "base64"), mime: match[1] || "" };
  }
  try {
    return { bytes: Buffer.from(decodeURIComponent(encoded), "utf8"), mime: match[1] || "" };
  } catch {
    throw new Error("Invalid attachment data");
  }
}

function preparedAttachment(input: IncomingAttachment): PreparedAttachment {
  const kind =
    input.kind === "image" ||
    input.kind === "audio" ||
    input.kind === "text" ||
    input.kind === "file"
      ? input.kind
      : null;
  if (!kind) throw new Error("Unsupported attachment type");
  const decoded = decodeData(input.data);
  const providedMime = typeof input.mime === "string" ? input.mime.trim().toLowerCase() : "";
  const mime =
    providedMime ||
    decoded.mime ||
    (kind === "image"
      ? "image/png"
      : kind === "audio"
        ? "audio/mpeg"
        : kind === "text"
          ? "text/plain"
          : "application/octet-stream");
  if (decoded.bytes.length > MAX_ATTACHMENT_SIZE)
    throw new Error(`${safeName(input.name)} is too large (maximum 10 MB)`);
  if (kind === "image" && !mime.startsWith("image/"))
    throw new Error(`${safeName(input.name)} is not a supported image`);
  if (kind === "audio" && !mime.startsWith("audio/"))
    throw new Error(`${safeName(input.name)} is not a supported audio file`);
  const name = safeName(input.name);
  const id = asToken(input.id);
  const summary: AttachmentSummary = { id, name, mime, kind, size: decoded.bytes.length };
  return {
    ...summary,
    bytes: decoded.bytes,
    dataUrl: dataUrl(mime, decoded.bytes),
    text: kind === "text" ? decoded.bytes.toString("utf8") : undefined,
  };
}

export class AttachmentStore {
  private readonly legacyRoot: string;
  private root = path.join(codexHome, "web-ui");
  private readonly workspaces = new Map<string, string>();
  private readonly threads = new Set<string>();

  constructor() {
    this.legacyRoot = path.join(codexHome, "attachments", "codex-web");
  }

  async init() {
    await fs.mkdir(codexHome, { recursive: true });
    const home = await fs.realpath(codexHome);
    this.root = path.join(home, "web-ui");
    await fs.mkdir(this.root, { recursive: true });
    if ((await fs.realpath(this.root)) !== this.root)
      throw new Error("Session files directory cannot be a symlink");
  }

  get rootPath() {
    return this.root;
  }

  async directoryFor(threadId: string) {
    if (!TOKEN.test(threadId) || !this.threads.has(threadId))
      throw new Error("Session files are unavailable; reopen the session");
    if ((await fs.realpath(this.root)) !== this.root)
      throw new Error("Session files directory cannot be a symlink");
    const directory = path.join(this.root, threadId);
    await fs.mkdir(directory, { recursive: true });
    if ((await fs.realpath(directory)) !== directory)
      throw new Error("Session files directory cannot be a symlink");
    return directory;
  }

  bindThread(threadId: string, cwd: string) {
    if (!TOKEN.test(threadId) || !path.isAbsolute(cwd)) throw new Error("Invalid thread workspace");
    this.registerThread(threadId);
    this.workspaces.set(threadId, cwd);
  }

  registerThread(threadId: string) {
    if (!TOKEN.test(threadId)) throw new Error("Invalid thread ID");
    this.threads.add(threadId);
  }

  hasThread(threadId: string) {
    return this.threads.has(threadId);
  }

  workspaceFor(threadId: string) {
    return this.workspaces.get(threadId) || null;
  }

  private inside(root: string, candidate: string) {
    const relative = path.relative(root, candidate);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  }

  private async roots(threadId: string, create = false) {
    if (!TOKEN.test(threadId)) throw new Error("Invalid thread ID");
    const roots: AttachmentLocation[] = [];
    if (create) {
      await this.directoryFor(threadId);
      return [{ root: this.root, layout: "flat" as const }];
    }
    try {
      const directory = path.join(this.root, threadId);
      if ((await fs.realpath(directory)) === directory)
        roots.push({ root: this.root, layout: "flat" });
    } catch (error: any) {
      if (error?.code !== "ENOENT") throw error;
    }
    // Read existing workspace attachments in place; never migrate or delete
    // them merely because a conversation is reopened.
    const cwd = this.workspaces.get(threadId);
    if (cwd) {
      try {
        const workspace = await fs.realpath(cwd);
        const root = path.join(workspace, ".files");
        const threadRoot = path.join(root, threadId);
        const real = await fs.realpath(threadRoot);
        if (path.relative(threadRoot, real) === "") {
          roots.push({ root, layout: "flat" });
          roots.push({ root, layout: "uploads" });
        }
      } catch (error: any) {
        if (!["ENOENT", "ENOTDIR"].includes(error?.code)) throw error;
      }
    }
    try {
      roots.push({ root: await fs.realpath(this.legacyRoot), layout: "legacy" });
    } catch (error: any) {
      if (error?.code !== "ENOENT") throw error;
    }
    return roots;
  }

  private messageDirectory(
    root: string,
    layout: AttachmentLocation["layout"],
    threadId: unknown,
    messageId: unknown,
  ) {
    const thread = asToken(threadId, "");
    const message = asToken(messageId, "");
    if (!thread || !message) return null;
    return path.join(
      root,
      thread,
      ...(layout === "uploads" ? ["uploads"] : []),
      ...(layout === "flat" ? [] : [message]),
    );
  }

  private manifestFile(directory: string, layout: AttachmentLocation["layout"], messageId: string) {
    return path.join(
      directory,
      layout === "flat" ? `.codex-web-${messageId}.json` : "manifest.json",
    );
  }

  private async readManifest(file: string, root: string): Promise<AttachmentManifest | null> {
    try {
      const directory = await fs.realpath(path.dirname(file));
      const realFile = await fs.realpath(file);
      if (
        path.relative(path.dirname(file), directory) !== "" ||
        path.relative(file, realFile) !== "" ||
        !this.inside(root, realFile)
      )
        return null;
      const value = JSON.parse(await fs.readFile(file, "utf8")) as AttachmentManifest;
      if (
        value?.version !== 1 ||
        !Array.isArray(value.attachments) ||
        typeof value.messageId !== "string"
      )
        return null;
      return value;
    } catch {
      return null;
    }
  }

  private async findManifest(
    threadId: string,
    messageId: string,
    turnId?: string,
    attachmentId?: string,
  ) {
    if (!TOKEN.test(threadId)) return null;
    for (const location of await this.roots(threadId)) {
      const direct = this.messageDirectory(location.root, location.layout, threadId, messageId);
      if (!direct) continue;
      const matches = (manifest: AttachmentManifest | null) =>
        manifest?.threadId === threadId &&
        (!attachmentId || manifest.attachments.some((item) => item.id === attachmentId));
      const manifest = await this.readManifest(
        this.manifestFile(direct, location.layout, messageId),
        location.root,
      );
      if (matches(manifest)) return { manifest: manifest!, ...location, directory: direct };
      if (!turnId && !attachmentId) continue;
      const threadDirectory = location.layout === "flat" ? direct : path.dirname(direct);
      let entries: Array<import("node:fs").Dirent> = [];
      try {
        entries = await fs.readdir(threadDirectory, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (
          location.layout === "flat"
            ? !entry.isFile() || !/^\.codex-web-[A-Za-z0-9_-]{1,160}\.json$/.test(entry.name)
            : !entry.isDirectory() || !TOKEN.test(entry.name)
        )
          continue;
        const found = await this.readManifest(
          location.layout === "flat"
            ? path.join(threadDirectory, entry.name)
            : path.join(threadDirectory, entry.name, "manifest.json"),
          location.root,
        );
        if (
          matches(found) &&
          ((turnId && found!.turnId === turnId) ||
            (attachmentId && found!.attachments.some((item) => item.id === attachmentId)))
        )
          return {
            manifest: found!,
            ...location,
            directory:
              location.layout === "flat" ? threadDirectory : path.join(threadDirectory, entry.name),
          };
      }
    }
    return null;
  }

  private async attachmentFile(root: string, relativePath: string) {
    const file = path.resolve(root, relativePath);
    if (!this.inside(root, file)) return null;
    try {
      const real = await fs.realpath(file);
      if (!this.inside(root, real) || !(await fs.stat(real)).isFile()) return null;
      return real;
    } catch {
      return null;
    }
  }

  async save(
    threadId: string,
    messageId: string,
    prompt: string,
    inputs: IncomingAttachment[],
  ): Promise<PersistedMessage> {
    const prepared = inputs.map(preparedAttachment);
    if (
      prepared.reduce((total, attachment) => total + attachment.size, 0) > MAX_TOTAL_ATTACHMENT_SIZE
    )
      throw new Error("Attachments exceed the 10 MB total limit");
    const location = (await this.roots(threadId, true))[0];
    if (!location) throw new Error("Thread workspace is unavailable");
    const directory = this.messageDirectory(location.root, "flat", threadId, messageId);
    if (!directory) throw new Error("Invalid attachment message ID");
    const created: string[] = [];
    try {
      const threadToken = asToken(threadId, "thread");
      const manifestAttachments: ManifestAttachment[] = [];
      for (const attachment of prepared) {
        const file = await createAttachmentFile(directory, attachment.name, async (candidate) => {
          const handle = await fs.open(candidate, "wx");
          created.push(candidate);
          try {
            await handle.writeFile(attachment.bytes);
          } finally {
            await handle.close();
          }
        });
        manifestAttachments.push({
          id: attachment.id,
          name: attachment.name,
          mime: attachment.mime,
          kind: attachment.kind,
          size: attachment.size,
          relativePath: path.posix.join(threadToken, path.basename(file)),
          sha256: crypto.createHash("sha256").update(attachment.bytes).digest("hex"),
        });
      }
      const manifest: AttachmentManifest = {
        version: 1,
        threadId,
        messageId,
        prompt,
        createdAt: Date.now(),
        attachments: manifestAttachments,
      };
      const temporary = path.join(directory, `.manifest-${crypto.randomUUID()}.tmp`);
      created.push(temporary);
      await fs.writeFile(temporary, JSON.stringify(manifest, null, 2), "utf8");
      const manifestPath = this.manifestFile(directory, "flat", messageId);
      await fs.rename(temporary, manifestPath);
      created.push(manifestPath);
      return {
        messageId,
        prompt,
        attachments: prepared.map(
          ({ bytes: _bytes, dataUrl: _dataUrl, text: _text, ...summary }) => summary,
        ),
        prepared,
        paths: manifestAttachments.map((attachment) =>
          path.join(location.root, attachment.relativePath),
        ),
      };
    } catch (error) {
      await Promise.all(created.map((file) => fs.rm(file, { force: true })));
      throw error;
    }
  }

  async setTurnId(threadId: string, messageId: string, turnId: unknown) {
    const value = typeof turnId === "string" && turnId ? turnId : "";
    if (!value) return;
    const found = await this.findManifest(threadId, messageId);
    if (!found) return;
    const file = this.manifestFile(found.directory, found.layout, found.manifest.messageId);
    const manifest = await this.readManifest(file, found.root);
    if (!manifest) return;
    manifest.turnId = value;
    await fs.writeFile(file, JSON.stringify(manifest, null, 2), "utf8");
  }

  async cloneMessage(sourceThreadId: string, targetThreadId: string, messageId: string) {
    const found = await this.findManifest(sourceThreadId, messageId);
    const location = (await this.roots(targetThreadId, true))[0];
    if (!found || !location) return;
    const target = this.messageDirectory(location.root, "flat", targetThreadId, messageId);
    const targetThread = asToken(targetThreadId, "");
    const targetMessage = asToken(messageId, "");
    if (
      !target ||
      !targetThread ||
      !targetMessage ||
      (found.layout === "flat" && found.directory === target)
    )
      return;
    const targetManifest = this.manifestFile(target, "flat", messageId);
    try {
      await fs.access(targetManifest);
      return;
    } catch (error: any) {
      if (error?.code !== "ENOENT") throw error;
    }
    const manifest = structuredClone(found.manifest);
    manifest.threadId = targetThread;
    const created: string[] = [];
    try {
      for (const attachment of manifest.attachments) {
        const sourceFile = await this.attachmentFile(found.root, attachment.relativePath);
        if (!sourceFile) throw new Error("Missing source attachment");
        const destination = await createAttachmentFile(target, attachment.name, (candidate) =>
          fs.copyFile(sourceFile, candidate, constants.COPYFILE_EXCL),
        );
        created.push(destination);
        attachment.relativePath = path.posix.join(targetThread, path.basename(destination));
      }
      await fs.writeFile(targetManifest, JSON.stringify(manifest, null, 2), {
        encoding: "utf8",
        flag: "wx",
      });
    } catch (error) {
      await Promise.all(created.map((file) => fs.rm(file, { force: true })));
      throw error;
    }
  }

  async load(threadId: string, messageId: string, turnId?: string) {
    const found = await this.findManifest(threadId, messageId, turnId);
    if (!found) return null;
    const attachments: AttachmentSummary[] = [];
    for (const attachment of found.manifest.attachments) {
      if (!(await this.attachmentFile(found.root, attachment.relativePath))) continue;
      attachments.push({
        id: attachment.id,
        name: attachment.name,
        mime: attachment.mime,
        kind: attachment.kind,
        size: attachment.size,
      });
    }
    return { messageId: found.manifest.messageId, prompt: found.manifest.prompt, attachments };
  }

  async resolveDownload(
    threadId: string,
    messageId: string,
    attachmentId: string,
  ): Promise<DownloadableAttachment | null> {
    if (!TOKEN.test(attachmentId)) return null;
    const found = await this.findManifest(threadId, messageId, undefined, attachmentId);
    const attachment = found?.manifest.attachments.find((item) => item.id === attachmentId);
    if (!found || !attachment) return null;
    const file = await this.attachmentFile(found.root, attachment.relativePath);
    if (!file) return null;
    try {
      const stat = await fs.stat(file);
      if (!stat.isFile()) return null;
      return { path: file, name: attachment.name, mime: attachment.mime, size: stat.size };
    } catch {
      return null;
    }
  }

  async removeMessage(threadId: string, messageId: string) {
    const found = await this.findManifest(threadId, messageId);
    if (found?.layout === "flat") {
      for (const attachment of found.manifest.attachments) {
        const file = await this.attachmentFile(found.root, attachment.relativePath);
        // The manifest records ownership for both original and older ID-prefixed names.
        if (file && path.dirname(file) === found.directory) await fs.rm(file, { force: true });
      }
      await fs.rm(this.manifestFile(found.directory, "flat", messageId), { force: true });
    } else if (
      found?.layout === "uploads" &&
      this.inside(path.join(found.root, threadId, "uploads"), found.directory)
    )
      await fs.rm(found.directory, { recursive: true, force: true });
  }

  async removeThread(threadId: string) {
    const token = asToken(threadId, "");
    if (token) await fs.rm(path.join(this.legacyRoot, token), { recursive: true, force: true });
    this.workspaces.delete(threadId);
    this.threads.delete(threadId);
  }
}
