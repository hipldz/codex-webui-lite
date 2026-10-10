import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import readline from "node:readline";
import type { JsonRpcId, JsonRpcMessage } from "./protocol.js";

export class CodexClient extends EventEmitter {
  private child?: ChildProcessWithoutNullStreams;
  private starting?: Promise<void>;
  private id = 0;
  private pending = new Map<JsonRpcId, { resolve: (value: any) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
  status: "starting" | "ready" | "error" | "stopped" = "stopped";
  userAgent = "Codex";

  constructor(private cwd: string) { super(); }
  get pid() { return this.child?.pid; }

  start(): Promise<void> {
    if (this.status === "ready") return Promise.resolve();
    if (this.starting) return this.starting;
    this.starting = this.startProcess().finally(() => { this.starting = undefined; });
    return this.starting;
  }

  private async startProcess() {
    if (this.status === "ready") return;
    if (this.status === "starting") throw new Error("Codex app-server is already starting");
    this.status = "starting";
    this.emit("status", this.status);
    const command = process.platform === "win32"
      ? (process.env.ComSpec || process.env.COMSPEC || "cmd.exe")
      : "codex";
    const args = process.platform === "win32"
      ? ["/d", "/s", "/c", "codex", "app-server", "--stdio"]
      : ["app-server", "--stdio"];
    const child = spawn(command, args, { cwd: this.cwd, env: process.env, windowsHide: true }); this.child = child;
    const lines = readline.createInterface({ input: child.stdout });
    lines.on("line", (line) => { if (this.child !== child) return; try { this.handle(JSON.parse(line)); } catch { this.emit("warning", `Malformed app-server message: ${line.slice(0, 100)}`); } });
    child.stderr.on("data", (chunk) => this.emit("stderr", chunk.toString()));
    child.stdin.on("error", (error) => {
      if (this.child !== child) return;
      for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
      this.pending.clear();
    });
    child.on("error", (error) => {
      if (this.child !== child) return;
      this.status = "error";
      for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
      this.pending.clear();
      this.emit("status", this.status);
    });
    child.on("exit", (code) => {
      if (this.child !== child) return;
      this.child = undefined;
      this.status = code === 0 ? "stopped" : "error";
      for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error(`Codex exited (${code})`)); }
      this.pending.clear(); this.emit("status", this.status);
    });
    try {
      const info = await this.request("initialize", { clientInfo: { name: "codex-web-harness", title: "Codex Web", version: "0.1.0" }, capabilities: { experimentalApi: true, requestAttestation: false } });
      if (this.child !== child) throw new Error("Codex startup was cancelled");
      this.notify("initialized", {});
      this.userAgent = info.userAgent || this.userAgent;
      this.status = "ready"; this.emit("status", this.status);
    } catch (error) { if (this.child === child) { await this.stop(); this.status = "error"; this.emit("status", this.status); } throw error; }
  }

  async ensureStarted() { if (this.status !== "ready") await this.start(); }

  private handle(message: JsonRpcMessage) {
    if (message.id !== undefined && (message.result !== undefined || message.error)) {
      const pending = this.pending.get(message.id); if (!pending) return;
      this.pending.delete(message.id); clearTimeout(pending.timer);
      message.error ? pending.reject(Object.assign(new Error(message.error.message), { code: message.error.code })) : pending.resolve(message.result);
      return;
    }
    this.emit("message", message);
  }

  private send(message: JsonRpcMessage) {
    if (!this.child?.stdin.writable) throw new Error("Codex app-server is not running");
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }
  request(method: string, params: Record<string, any> = {}) {
    if (this.pending.size >= 64) return Promise.reject(new Error("Codex is busy; retry shortly"));
    const id = ++this.id;
    return new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method} timed out`)); }, 60_000); timer.unref();
      this.pending.set(id, { resolve, reject, timer });
      try { this.send({ id, method, params }); } catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }
  notify(method: string, params: Record<string, any> = {}) { this.send({ method, params }); }
  respond(id: JsonRpcId, result: any) { this.send({ id, result }); }
  async stop() {
    const child = this.child; this.child = undefined;
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error("Codex app-server stopped")); } this.pending.clear();
    if (this.status !== "stopped") { this.status = "stopped"; this.emit("status", this.status); }
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    await new Promise<void>((resolve) => {
      let settled = false; let timer: NodeJS.Timeout; const finish = () => { if (settled) return; settled = true; if (timer) clearTimeout(timer); resolve(); };
      child.once("exit", finish); child.kill("SIGTERM");
      timer = setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); finish(); }, 3000);
    });
  }
}
