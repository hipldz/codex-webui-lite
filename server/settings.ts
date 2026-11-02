import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { codexHome } from "./config.js";

export type PermissionPreset = "ask" | "full" | "read-only" | "config";
type Settings = { permission: PermissionPreset; revision: number };
const isPermission = (value: unknown): value is PermissionPreset =>
  value === "ask" || value === "full" || value === "read-only" || value === "config";

export class WebUiSettings {
  private value: Settings = { permission: "ask", revision: 0 };
  private writes: Promise<unknown> = Promise.resolve();

  constructor(private file = path.join(codexHome, "web-ui", "settings.json")) {}

  get snapshot(): Settings {
    return { ...this.value };
  }

  async init() {
    let content: string;
    try {
      content = await fs.readFile(this.file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    const settings = JSON.parse(content);
    if (!isPermission(settings?.permission))
      throw new Error(`Invalid WebUI permission in ${this.file}`);
    this.value = {
      permission: settings.permission,
      revision:
        Number.isSafeInteger(settings.revision) && settings.revision >= 0 ? settings.revision : 0,
    };
  }

  async updatePermission(permission: unknown): Promise<Settings> {
    if (!isPermission(permission)) throw new Error("Unknown WebUI permission preset");
    const write = this.writes.then(async () => {
      if (permission === this.value.permission) return this.snapshot;
      const next = { permission, revision: this.value.revision + 1 };
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      const temporary = `${this.file}.${crypto.randomUUID()}.tmp`;
      try {
        await fs.writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, {
          encoding: "utf8",
          flag: "wx",
          mode: 0o600,
        });
        await fs.rename(temporary, this.file);
        this.value = next;
        return this.snapshot;
      } finally {
        await fs.rm(temporary, { force: true }).catch(() => {});
      }
    });
    this.writes = write.catch(() => {});
    return write;
  }
}
