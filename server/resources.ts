import fs from "node:fs/promises";

async function rss(pid: number) {
  try { const value = (await fs.readFile(`/proc/${pid}/status`, "utf8")).match(/^VmRSS:\s+(\d+)\s+kB$/m); return value ? Number(value[1]) * 1024 : 0; } catch { return 0; }
}
export async function processTreeMemory(root: number, codexPid?: number) {
  if (process.platform !== "linux") return { codexRss: null, childRss: null, processCount: null };
  let childRss = 0; let codexRss = 0; const seen = new Set<number>([root]); const pending = [root];
  while (pending.length && seen.size < 2048) {
    const pid = pending.shift()!;
    if (pid !== root) { const bytes = await rss(pid); if (pid === codexPid) codexRss = bytes; else childRss += bytes; }
    try {
      // Children can be spawned by any thread, not only the process leader.
      const tasks = await fs.readdir(`/proc/${pid}/task`);
      for (const tid of tasks) {
        const children = await fs.readFile(`/proc/${pid}/task/${tid}/children`, "utf8").catch(() => "");
        for (const value of children.trim().split(/\s+/)) { const child = Number(value); if (child > 0 && !seen.has(child)) { seen.add(child); pending.push(child); } }
      }
    } catch { /* Processes can exit during a sample. */ }
  }
  return { codexRss, childRss, processCount: seen.size };
}
