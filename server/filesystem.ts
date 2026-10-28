import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";

const hidden = new Set([".git", "node_modules", "dist", "build", ".next", "coverage"]);
const MAX_TEXT_FILE_SIZE = 10 * 1024 * 1024;
const MAX_UPLOAD_SIZE = 10 * 1024 * 1024;
const textExtensions = new Set([
  ".txt",
  ".md",
  ".mdx",
  ".json",
  ".jsonc",
  ".yaml",
  ".yml",
  ".xml",
  ".csv",
  ".tsv",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".py",
  ".pyi",
  ".rs",
  ".go",
  ".java",
  ".c",
  ".cc",
  ".cpp",
  ".h",
  ".hpp",
  ".css",
  ".scss",
  ".sass",
  ".less",
  ".html",
  ".htm",
  ".sh",
  ".bash",
  ".zsh",
  ".fish",
  ".toml",
  ".ini",
  ".conf",
  ".cfg",
  ".log",
  ".sql",
  ".graphql",
  ".gql",
  ".vue",
  ".svelte",
  ".kt",
  ".kts",
  ".swift",
  ".rb",
  ".php",
  ".scala",
  ".lua",
  ".r",
  ".ps1",
  ".bat",
  ".cmd",
  ".diff",
  ".patch",
]);
const textNames = new Set([
  "dockerfile",
  "makefile",
  "procfile",
  "gemfile",
  "rakefile",
  "license",
  "readme",
  ".gitignore",
  ".gitattributes",
  ".editorconfig",
  ".npmrc",
  ".nvmrc",
]);
const canPreviewText = (file: string) => {
  const name = path.basename(file).toLowerCase();
  return (
    textNames.has(name) ||
    name === ".env" ||
    name.startsWith(".env.") ||
    textExtensions.has(path.extname(name))
  );
};
const imageMime = new Map([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".gif", "image/gif"],
  [".webp", "image/webp"],
  [".svg", "image/svg+xml"],
  [".bmp", "image/bmp"],
  [".avif", "image/avif"],
]);

export class WorkspaceFs {
  private root = "";
  private base = "";
  private start = "";
  private selected = false;
  constructor(
    private requestedRoot: string,
    selected = false,
    private sessionFiles = false,
  ) {
    this.selected = selected;
  }

  private internal(relative: string) {
    return (
      this.sessionFiles &&
      relative
        .replaceAll("\\", "/")
        .split("/")
        .some((part) => part.startsWith(".codex-web-") || part.startsWith(".manifest-"))
    );
  }

  async init() {
    this.root = await fs.realpath(this.requestedRoot);
    if (!(await fs.stat(this.root)).isDirectory()) throw new Error("Workspace must be a directory");
    this.base = path.parse(this.root).root;
    this.start = this.root;
    try {
      const home = await fs.realpath(os.homedir());
      if (this.inside(this.base, home)) this.start = home;
    } catch {
      /* Use the current directory when the home directory is unavailable. */
    }
  }
  get path() {
    return this.root;
  }
  get basePath() {
    return this.base;
  }
  get browseStart() {
    return this.start;
  }
  get isSelected() {
    return this.selected;
  }

  /** An immutable request scope; never change another browser's workspace. */
  async scoped(candidate: string) {
    const scope = new WorkspaceFs(candidate, true);
    await scope.init();
    return scope;
  }

  private inside(parent: string, candidate: string) {
    const relative = path.relative(parent, candidate);
    return (
      relative === "" ||
      (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
    );
  }

  private async safeFrom(parent: string, relative = "", existing = true) {
    if (path.isAbsolute(relative)) throw new Error("Absolute paths are not allowed");
    const candidate = path.resolve(parent, relative);
    const resolved = existing ? await fs.realpath(candidate) : candidate;
    if (!this.inside(parent, resolved)) throw new Error("Path escapes allowed workspace root");
    return resolved;
  }

  private async safe(relative = "", existing = true) {
    if (this.internal(relative))
      throw new Error("Internal attachment metadata is managed by Codex Web");
    return this.safeFrom(this.root, relative, existing);
  }

  async resolveWorkspace(input: string) {
    const value = input;
    if (!value.trim()) throw new Error("Enter a folder path");
    const expanded =
      value === "~"
        ? os.homedir()
        : /^~[\\/]/.test(value)
          ? path.join(os.homedir(), value.slice(2))
          : value;
    const resolved = await fs.realpath(
      path.isAbsolute(expanded) ? expanded : path.resolve(this.base, expanded),
    );
    if (!(await fs.stat(resolved)).isDirectory()) throw new Error("Choose a directory");
    const base = path.parse(resolved).root;
    return { path: path.relative(base, resolved).replaceAll("\\", "/"), absolute: resolved, base };
  }

  async listWorkspaces(relative = "", showHidden = false) {
    const { absolute: dir } = await this.resolveWorkspace(relative || this.base);
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const folders = [];
    for (const entry of entries) {
      if (!showHidden && (hidden.has(entry.name) || entry.name.startsWith("."))) continue;
      let directory = entry.isDirectory();
      if (entry.isSymbolicLink()) {
        try {
          directory = (await fs.stat(path.join(dir, entry.name))).isDirectory();
        } catch {
          directory = false;
        }
      }
      if (directory)
        folders.push({
          name: entry.name,
          path: path.join(dir, entry.name).replaceAll("\\", "/"),
          type: "directory" as const,
        });
    }
    return folders.sort((a, b) => a.name.localeCompare(b.name));
  }

  async list(relative = "") {
    const dir = await this.safe(relative);
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries
      .filter((entry) => !hidden.has(entry.name) && !this.internal(entry.name))
      .map((entry) => ({
        name: entry.name,
        path: path.posix.join(relative.replaceAll("\\", "/"), entry.name),
        type: entry.isDirectory() ? "directory" : entry.isFile() ? "file" : "other",
      }))
      .filter((entry) => entry.type !== "other")
      .sort((a, b) =>
        a.type === b.type ? a.name.localeCompare(b.name) : a.type === "directory" ? -1 : 1,
      );
  }

  async read(relative: string) {
    const file = await this.safe(relative);
    const stat = await fs.stat(file);
    if (!stat.isFile()) throw new Error("Not a file");
    const mime = imageMime.get(path.extname(file).toLowerCase());
    if (mime)
      return {
        path: relative.replaceAll("\\", "/"),
        size: stat.size,
        previewable: true,
        kind: "image" as const,
        mime,
      };
    if (!canPreviewText(file))
      return {
        path: relative,
        size: stat.size,
        previewable: false,
        kind: "binary" as const,
        reason: "Preview is available only for images, common text and code files",
      };
    if (stat.size > MAX_TEXT_FILE_SIZE)
      return {
        path: relative,
        size: stat.size,
        previewable: false,
        reason: "Text file exceeds 10 MB preview limit",
      };
    const buffer = await fs.readFile(file);
    if (buffer.subarray(0, 8000).includes(0))
      return {
        path: relative,
        size: stat.size,
        previewable: false,
        reason: "Binary content cannot be previewed as text",
      };
    return {
      path: relative,
      content: buffer.toString("utf8"),
      revision: crypto.createHash("sha256").update(buffer).digest("hex"),
      size: stat.size,
      previewable: true,
      kind: "text" as const,
      mime: "text/plain; charset=utf-8",
    };
  }

  /** Resolve a regular workspace file for an HTTP download without reading it into memory. */
  async download(relative: string) {
    const file = await this.safe(relative);
    const stat = await fs.stat(file);
    if (!stat.isFile()) throw new Error("Not a file");
    return {
      path: file,
      name: path.basename(file),
      size: stat.size,
      mime: imageMime.get(path.extname(file).toLowerCase()) || "application/octet-stream",
    };
  }

  async write(relative: string, content: string, revision?: string) {
    if (Buffer.byteLength(content, "utf8") > MAX_TEXT_FILE_SIZE)
      throw new Error("File exceeds 10 MB edit limit");
    const file = await this.safe(relative);
    const stat = await fs.stat(file);
    if (!stat.isFile()) throw new Error("Not a file");
    if (!canPreviewText(file)) throw new Error("Only common text and code files can be edited");
    if (
      revision &&
      crypto
        .createHash("sha256")
        .update(await fs.readFile(file))
        .digest("hex") !== revision
    )
      throw new Error(
        "File changed on disk. Reopen it before saving to avoid overwriting newer changes.",
      );
    const temporary = path.join(path.dirname(file), `.codex-web-${crypto.randomUUID()}.tmp`);
    try {
      await fs.writeFile(temporary, content, { encoding: "utf8", flag: "wx", mode: stat.mode });
      await fs.rename(temporary, file);
    } finally {
      await fs.rm(temporary, { force: true });
    }
    return this.read(relative);
  }

  async search(query: string) {
    const needle = query.trim().toLowerCase().slice(0, 200);
    if (!needle) return { entries: [], truncated: false };
    const pending = [""];
    const entries: Array<{ name: string; path: string; type: "file" }> = [];
    let scanned = 0;
    const deadline = Date.now() + 250;
    while (pending.length) {
      const relative = pending.shift()!;
      try {
        const directory = await fs.opendir(await this.safe(relative));
        for await (const entry of directory) {
          if (++scanned > 5000 || Date.now() > deadline || entries.length >= 100)
            return { entries, truncated: true };
          if (hidden.has(entry.name) || this.internal(entry.name) || entry.isSymbolicLink())
            continue;
          const name = path.posix.join(relative, entry.name);
          if (entry.isDirectory()) pending.push(name);
          else if (entry.isFile() && name.toLowerCase().includes(needle))
            entries.push({ name: entry.name, path: name, type: "file" });
        }
      } catch {
        /* An inaccessible directory should not hide other matches. */
      }
    }
    return { entries, truncated: false };
  }

  async upload(directory: string, name: string, encoded: string) {
    if (this.internal(name)) throw new Error("Reserved session filename");
    if (!name || name === "." || name === ".." || name.includes("/") || name.includes("\\"))
      throw new Error("Invalid upload filename");
    if (encoded.length > Math.ceil(MAX_UPLOAD_SIZE / 3) * 4 + 4)
      throw new Error("Upload exceeds 10 MB limit");
    if (encoded && (encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)))
      throw new Error("Invalid base64 upload data");
    const parent = await this.safe(directory);
    const stat = await fs.stat(parent);
    if (!stat.isDirectory()) throw new Error("Upload destination is not a directory");
    const buffer = Buffer.from(encoded, "base64");
    if (buffer.length > MAX_UPLOAD_SIZE) throw new Error("Upload exceeds 10 MB limit");
    const file = path.join(parent, name);
    if (!this.inside(this.root, file)) throw new Error("Upload escapes workspace root");
    try {
      await fs.writeFile(file, buffer, { flag: "wx" });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST")
        throw new Error("A file with this name already exists");
      throw error;
    }
    return { path: path.posix.join(directory.replaceAll("\\", "/"), name), size: buffer.length };
  }

  async create(directory: string, name: string) {
    if (this.internal(name)) throw new Error("Reserved session filename");
    if (!name || name === "." || name === ".." || name.includes("/") || name.includes("\\"))
      throw new Error("Invalid filename");
    const parent = await this.safe(directory);
    const stat = await fs.stat(parent);
    if (!stat.isDirectory()) throw new Error("File destination is not a directory");
    const file = path.join(parent, name);
    if (!this.inside(this.root, file)) throw new Error("File escapes workspace root");
    try {
      await fs.writeFile(file, "", { encoding: "utf8", flag: "wx" });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST")
        throw new Error("A file with this name already exists");
      throw error;
    }
    return this.read(path.posix.join(directory.replaceAll("\\", "/"), name));
  }

  async delete(relative: string) {
    if (this.internal(relative))
      throw new Error("Internal attachment metadata is managed by Codex Web");
    if (!relative || path.isAbsolute(relative)) throw new Error("Invalid file path");
    const candidate = path.resolve(this.root, relative);
    if (!this.inside(this.root, candidate)) throw new Error("Path escapes workspace root");
    const parent = await fs.realpath(path.dirname(candidate));
    if (!this.inside(this.root, parent)) throw new Error("Path escapes workspace root");
    const stat = await fs.lstat(candidate);
    if (stat.isSymbolicLink() || !stat.isFile())
      throw new Error("Only regular files can be deleted");
    await fs.unlink(candidate);
    return { path: relative.replaceAll("\\", "/") };
  }
}
