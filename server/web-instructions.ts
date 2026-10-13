import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { codexHome } from "./config.js";

const START = "<!-- codex-web:thread-files:start -->";
const END = "<!-- codex-web:thread-files:end -->";
const THREAD_FILES_INSTRUCTIONS =
  "For turns that include a [Codex Web thread files] context, use the absolute session files directory supplied in that context for uploaded attachments and default standalone deliverables. Keep files directly in that directory unless the user requests a different layout. Respect an explicit user-specified destination. Keep project/source edits and required build outputs at their normal project paths, and preserve tool-managed originals. Treat uploaded originals as inputs unless the user asks to edit them. Report final file paths as clickable links, and explicitly report a failure to save a file. These conventions apply only to Codex Web turns; do not change the working directory or apply them to other sessions.";

/** Install only our managed block; preserve all other global instructions. */
export async function ensureWebInstructions() {
  const block = `${START}\n${THREAD_FILES_INSTRUCTIONS}\n${END}`;
  await fs.mkdir(codexHome, { recursive: true });
  const file = path.join(codexHome, "AGENTS.md");
  let content: string;
  try {
    content = await fs.readFile(file, "utf8");
  } catch (error: any) {
    if (error?.code !== "ENOENT") throw error;
    try {
      await fs.writeFile(file, `${block}\n`, { flag: "wx" });
      return;
    } catch (created: any) {
      if (created?.code !== "EEXIST") throw created;
    }
    content = await fs.readFile(file, "utf8");
  }
  const start = content.indexOf(START);
  const end = content.indexOf(END);
  if (start >= 0 && end > start && content.slice(start, end + END.length) === block) return;
  if ((start >= 0 || end >= 0) && !(start >= 0 && end > start))
    throw new Error(`Incomplete Codex Web instruction block in ${file}`);
  const next =
    start >= 0
      ? content.slice(0, start) + block + content.slice(end + END.length)
      : `${content}${content && !content.endsWith("\n") ? "\n" : ""}${content ? "\n" : ""}${block}\n`;
  const target = await fs.realpath(file);
  const stat = await fs.stat(target);
  const temporary = path.join(path.dirname(target), `.codex-web-agents-${crypto.randomUUID()}.tmp`);
  try {
    await fs.writeFile(temporary, next, { encoding: "utf8", flag: "wx", mode: stat.mode });
    if ((await fs.readFile(target, "utf8")) !== content)
      throw new Error(`Instructions changed during startup; retry starting Codex Web (${file})`);
    await fs.rename(temporary, target);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}
