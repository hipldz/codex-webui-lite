import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const hidden = new Set([".git", "node_modules", "dist", "build", ".next", "coverage"]);
const MAX_TEXT_FILE_SIZE = 10 * 1024 * 1024;
const MAX_UPLOAD_SIZE = 10 * 1024 * 1024;
const textExtensions = new Set([".txt", ".md", ".mdx", ".json", ".jsonc", ".yaml", ".yml", ".xml", ".csv", ".tsv", ".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".py", ".pyi", ".rs", ".go", ".java", ".c", ".cc", ".cpp", ".h", ".hpp", ".css", ".scss", ".sass", ".less", ".html", ".htm", ".sh", ".bash", ".zsh", ".fish", ".toml", ".ini", ".conf", ".cfg", ".log", ".sql", ".graphql", ".gql", ".vue", ".svelte", ".kt", ".kts", ".swift", ".rb", ".php", ".scala", ".lua", ".r", ".ps1", ".bat", ".cmd", ".diff", ".patch"]);
const textNames = new Set(["dockerfile", "makefile", "procfile", "gemfile", "rakefile", "license", "readme", ".gitignore", ".gitattributes", ".editorconfig", ".npmrc", ".nvmrc"]);
const canPreviewText = (file: string) => { const name = path.basename(file).toLowerCase(); return textNames.has(name) || name === ".env" || name.startsWith(".env.") || textExtensions.has(path.extname(name)); };
const imageMime = new Map([[".png", "image/png"], [".jpg", "image/jpeg"], [".jpeg", "image/jpeg"], [".gif", "image/gif"], [".webp", "image/webp"], [".svg", "image/svg+xml"], [".bmp", "image/bmp"], [".avif", "image/avif"]]);

export class WorkspaceFs {
  private root = "";
  private base = "";
  private selected = false;
  constructor(private requestedRoot: string, private requestedBase = requestedRoot, selected = false) { this.selected = selected; }

  async init() {
    this.root = await fs.realpath(this.requestedRoot);
    if (!(await fs.stat(this.root)).isDirectory()) throw new Error("Workspace must be a directory");
    this.base = await fs.realpath(this.requestedBase);
    if (!this.inside(this.base, this.root)) this.base = path.dirname(this.root);
  }
  get path() { return this.root; }
  get basePath() { return this.base; }
  get isSelected() { return this.selected; }

  /** An immutable request scope; never change another browser's workspace. */
  async scoped(candidate: string) {
    const resolved = await fs.realpath(candidate);
    if (!this.inside(this.base, resolved)) throw new Error("Workspace is outside the browsable root");
    const scope = new WorkspaceFs(resolved, this.base, true);
    await scope.init();
    return scope;
  }

  private inside(parent: string, candidate: string) {
    const relative = path.relative(parent, candidate);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  }

  private async safeFrom(parent: string, relative = "", existing = true) {
    if (path.isAbsolute(relative)) throw new Error("Absolute paths are not allowed");
    const candidate = path.resolve(parent, relative);
    const resolved = existing ? await fs.realpath(candidate) : candidate;
    if (!this.inside(parent, resolved)) throw new Error("Path escapes allowed workspace root");
    return resolved;
  }

  private async safe(relative = "", existing = true) {
    return this.safeFrom(this.root, relative, existing);
  }

  async listWorkspaces(relative = "") {
    const dir = await this.safeFrom(this.base, relative);
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && !hidden.has(entry.name) && !entry.name.startsWith("."))
      .map((entry) => ({ name: entry.name, path: path.posix.join(relative.replaceAll("\\", "/"), entry.name), type: "directory" as const }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async select(relative = "") {
    const selected = await this.safeFrom(this.base, relative);
    const stat = await fs.stat(selected);
    if (!stat.isDirectory()) throw new Error("Workspace must be a directory");
    this.root = selected;
    this.selected = true;
    return { path: this.root, relative: path.relative(this.base, this.root).replaceAll("\\", "/") };
  }

  async selectAbsolute(candidate: string) {
    const resolved = await fs.realpath(candidate);
    if (!this.inside(this.base, resolved)) throw new Error("Session workspace is outside the browsable root");
    const stat = await fs.stat(resolved);
    if (!stat.isDirectory()) throw new Error("Workspace must be a directory");
    this.root = resolved;
    this.selected = true;
    return { path: this.root, relative: path.relative(this.base, this.root).replaceAll("\\", "/") };
  }

  async list(relative = "") {
    const dir = await this.safe(relative);
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries
      .filter((entry) => !hidden.has(entry.name))
      .map((entry) => ({ name: entry.name, path: path.posix.join(relative.replaceAll("\\", "/"), entry.name), type: entry.isDirectory() ? "directory" : entry.isFile() ? "file" : "other" }))
      .filter((entry) => entry.type !== "other")
      .sort((a, b) => a.type === b.type ? a.name.localeCompare(b.name) : a.type === "directory" ? -1 : 1);
  }

  async read(relative: string) {
    const file = await this.safe(relative);
    const stat = await fs.stat(file);
    if (!stat.isFile()) throw new Error("Not a file");
    const mime = imageMime.get(path.extname(file).toLowerCase());
    if (mime) return { path: relative.replaceAll("\\", "/"), size: stat.size, previewable: true, kind: "image" as const, mime };
    if (!canPreviewText(file)) return { path: relative, size: stat.size, previewable: false, kind: "binary" as const, reason: "Preview is available only for images, common text and code files" };
    if (stat.size > MAX_TEXT_FILE_SIZE) return { path: relative, size: stat.size, previewable: false, reason: "Text file exceeds 10 MB preview limit" };
    const buffer = await fs.readFile(file);
    if (buffer.subarray(0, 8000).includes(0)) return { path: relative, size: stat.size, previewable: false, reason: "Binary content cannot be previewed as text" };
    return { path: relative, content: buffer.toString("utf8"), revision: crypto.createHash("sha256").update(buffer).digest("hex"), size: stat.size, previewable: true, kind: "text" as const, mime: "text/plain; charset=utf-8" };
  }

  /** Resolve a regular workspace file for an HTTP download without reading it into memory. */
  async download(relative: string) {
    const file = await this.safe(relative);
    const stat = await fs.stat(file);
    if (!stat.isFile()) throw new Error("Not a file");
    return { path: file, name: path.basename(file), size: stat.size, mime: imageMime.get(path.extname(file).toLowerCase()) || "application/octet-stream" };
  }

  async write(relative: string, content: string, revision?: string) {
    if (Buffer.byteLength(content, "utf8") > MAX_TEXT_FILE_SIZE) throw new Error("File exceeds 10 MB edit limit");
    const file = await this.safe(relative);
    const stat = await fs.stat(file);
    if (!stat.isFile()) throw new Error("Not a file");
    if (!canPreviewText(file)) throw new Error("Only common text and code files can be edited");
    if (revision && crypto.createHash("sha256").update(await fs.readFile(file)).digest("hex") !== revision) throw new Error("File changed on disk. Reopen it before saving to avoid overwriting newer changes.");
    const temporary = path.join(path.dirname(file), `.codex-web-${crypto.randomUUID()}.tmp`);
    try { await fs.writeFile(temporary, content, { encoding: "utf8", flag: "wx", mode: stat.mode }); await fs.rename(temporary, file); }
    finally { await fs.rm(temporary, { force: true }); }
    return this.read(relative);
  }

  async search(query: string) {
    const needle = query.trim().toLowerCase().slice(0, 200);
    if (!needle) return { entries: [], truncated: false };
    const pending = [""]; const entries: Array<{ name: string; path: string; type: "file" }> = [];
    let scanned = 0; const deadline = Date.now() + 250;
    while (pending.length) {
      const relative = pending.shift()!;
      try {
        const directory = await fs.opendir(await this.safe(relative));
        for await (const entry of directory) {
          if (++scanned > 5000 || Date.now() > deadline || entries.length >= 100) return { entries, truncated: true };
          if (hidden.has(entry.name) || entry.isSymbolicLink()) continue;
          const name = path.posix.join(relative, entry.name);
          if (entry.isDirectory()) pending.push(name);
          else if (entry.isFile() && name.toLowerCase().includes(needle)) entries.push({ name: entry.name, path: name, type: "file" });
        }
      } catch { /* An inaccessible directory should not hide other matches. */ }
    }
    return { entries, truncated: false };
  }

  async upload(directory: string, name: string, encoded: string) {
    if (!name || name === "." || name === ".." || name.includes("/") || name.includes("\\")) throw new Error("Invalid upload filename");
    if (encoded.length > Math.ceil(MAX_UPLOAD_SIZE / 3) * 4 + 4) throw new Error("Upload exceeds 10 MB limit");
    if (encoded && (encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))) throw new Error("Invalid base64 upload data");
    const parent = await this.safe(directory);
    const stat = await fs.stat(parent);
    if (!stat.isDirectory()) throw new Error("Upload destination is not a directory");
    const buffer = Buffer.from(encoded, "base64");
    if (buffer.length > MAX_UPLOAD_SIZE) throw new Error("Upload exceeds 10 MB limit");
    const file = path.join(parent, name);
    if (!this.inside(this.root, file)) throw new Error("Upload escapes workspace root");
    try { await fs.writeFile(file, buffer, { flag: "wx" }); } catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error("A file with this name already exists"); throw error; }
    return { path: path.posix.join(directory.replaceAll("\\", "/"), name), size: buffer.length };
  }

  async create(directory: string, name: string) {
    if (!name || name === "." || name === ".." || name.includes("/") || name.includes("\\")) throw new Error("Invalid filename");
    const parent = await this.safe(directory);
    const stat = await fs.stat(parent);
    if (!stat.isDirectory()) throw new Error("File destination is not a directory");
    const file = path.join(parent, name);
    if (!this.inside(this.root, file)) throw new Error("File escapes workspace root");
    try { await fs.writeFile(file, "", { encoding: "utf8", flag: "wx" }); } catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error("A file with this name already exists"); throw error; }
    return this.read(path.posix.join(directory.replaceAll("\\", "/"), name));
  }

  async delete(relative: string) {
    if (!relative || path.isAbsolute(relative)) throw new Error("Invalid file path");
    const candidate = path.resolve(this.root, relative);
    if (!this.inside(this.root, candidate)) throw new Error("Path escapes workspace root");
    const parent = await fs.realpath(path.dirname(candidate));
    if (!this.inside(this.root, parent)) throw new Error("Path escapes workspace root");
    const stat = await fs.lstat(candidate);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error("Only regular files can be deleted");
    await fs.unlink(candidate);
    return { path: relative.replaceAll("\\", "/") };
  }
}
