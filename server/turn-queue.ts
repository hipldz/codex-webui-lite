import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

type Job = { key: string; threadId: string; messageId: string; file: string; state: "saving" | "queued" | "starting" | "running"; cancelled: boolean; generation: number };

/** Queued uploads live on disk, never in closures retaining Base64 buffers. */
export class TurnQueue {
  private jobs = new Map<string, Job>();
  private receipts = new Map<string, any>();
  private directory?: Promise<string>;
  private generation = 0;
  private version = 0;
  constructor(private startJob: (payload: any, cancelled: () => boolean) => Promise<any>, private emit: (message: any) => void, readonly concurrency = 1, readonly capacity = 8, private externalActive: () => number = () => 0) {}
  get size() { return this.jobs.size; }
  get queued() { return [...this.jobs.values()].filter((job) => job.state === "queued" || job.state === "saving").length; }
  receipt(threadId: string, messageId: string) { return this.receipts.get(`${threadId}:${messageId}`); }
  async preview(threadId: string) {
    const job = [...this.jobs.values()].find((entry) => entry.threadId === threadId && entry.state !== "running" && entry.file);
    if (!job) return null;
    try {
      const payload = JSON.parse(await fs.readFile(job.file, "utf8"));
      return { type: "user_message", id: job.messageId, text: payload.text, delivery: "queued", attachments: (payload.attachments || []).map((item: any) => ({ name: item.name, kind: item.kind, mime: item.mime, size: item.size })) };
    } catch { return null; }
  }
  status(threadId: string) {
    const job = [...this.jobs.values()].find((entry) => entry.threadId === threadId);
    return job ? { queued: job.state !== "running", messageId: job.messageId } : null;
  }
  private remember(key: string, value: any) {
    value.receiptVersion = ++this.version;
    this.receipts.delete(key); this.receipts.set(key, value);
    while (this.receipts.size > 256) this.receipts.delete(this.receipts.keys().next().value!);
    return value;
  }
  async submit(payload: any) {
    const key = `${payload.threadId}:${payload.clientUserMessageId}`;
    if (this.receipts.has(key)) return this.receipts.get(key);
    if (this.jobs.get(key)?.state === "saving") throw new Error("This message is still being saved; retry shortly");
    if ([...this.jobs.values()].some((job) => job.threadId === payload.threadId)) throw new Error("This thread already has a pending turn");
    if (this.jobs.size >= this.capacity + this.concurrency) throw new Error("Task queue is full; try again when a task finishes");
    const job: Job = { key, threadId: payload.threadId, messageId: payload.clientUserMessageId, file: "", state: "saving", cancelled: false, generation: this.generation };
    this.jobs.set(key, job);
    try {
      const directory = await (this.directory ||= fs.mkdtemp(path.join(os.tmpdir(), "codex-web-queue-")));
      job.file = path.join(directory, `${crypto.randomUUID()}.json`);
      await fs.writeFile(job.file, JSON.stringify(payload), { mode: 0o600, flag: "wx" });
      if (job.cancelled || job.generation !== this.generation) throw new Error("Turn cancelled before it started");
      job.state = "queued";
      const receipt = this.remember(key, { type: "turn.queued", threadId: job.threadId, messageId: job.messageId });
      this.emit(receipt); this.pump(); return receipt;
    } catch (error) { this.jobs.delete(key); if (job.file) await fs.rm(job.file, { force: true }); throw error; }
  }
  pump() {
    let active = this.externalActive() + [...this.jobs.values()].filter((job) => job.state === "starting" || job.state === "running").length;
    for (const job of this.jobs.values()) {
      if (active >= this.concurrency) break;
      if (job.state !== "queued") continue;
      active++; job.state = "starting"; void this.run(job);
    }
  }
  private async run(job: Job) {
    try {
      const payload = JSON.parse(await fs.readFile(job.file, "utf8"));
      if (job.cancelled) throw new Error("Turn cancelled before it started");
      const receipt = await this.startJob(payload, () => job.cancelled || job.generation !== this.generation);
      if (job.generation !== this.generation) return;
      if (this.jobs.get(job.key) === job) job.state = "running";
      else receipt.running = false; // A very short turn can finish before the RPC response.
      this.remember(job.key, receipt); this.emit(receipt);
      if (receipt.running === false) { this.jobs.delete(job.key); this.pump(); }
    } catch (error) {
      if (job.generation !== this.generation) return;
      this.jobs.delete(job.key);
      const receipt = { type: "turn.failed", threadId: job.threadId, messageId: job.messageId, message: error instanceof Error ? error.message : String(error) };
      this.remember(job.key, receipt); this.emit(receipt); this.pump();
    } finally { if (job.file) await fs.rm(job.file, { force: true }).catch(() => {}); }
  }
  completed(threadId: string) {
    for (const [key, job] of this.jobs) if (job.threadId === threadId && (job.state === "running" || job.state === "starting")) {
      this.jobs.delete(key);
      const receipt = this.receipts.get(key);
      if (receipt?.type === "turn.accepted") this.remember(key, { ...receipt, running: false });
    }
    this.pump();
  }
  async cancel(threadId: string) {
    const job = [...this.jobs.values()].find((entry) => entry.threadId === threadId);
    if (!job || job.state === "running") return false;
    job.cancelled = true;
    if (job.state === "starting" || job.state === "saving") return true;
    this.jobs.delete(job.key); await fs.rm(job.file, { force: true });
    const receipt = { type: "turn.failed", threadId, messageId: job.messageId, message: "Queued turn cancelled" };
    this.remember(job.key, receipt); this.emit(receipt); this.pump(); return true;
  }
  async reset() {
    this.generation++;
    const jobs = [...this.jobs.values()]; this.jobs.clear(); this.receipts.clear();
    for (const job of jobs) { job.cancelled = true; this.emit({ type: "turn.failed", threadId: job.threadId, messageId: job.messageId, message: "Codex stopped; this turn was interrupted" }); }
    await Promise.all(jobs.filter((job) => job.file).map((job) => fs.rm(job.file, { force: true }).catch(() => {})));
  }
}
