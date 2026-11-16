import { MAX_RPC_FRAME_BYTES, MAX_RPC_REASSEMBLED_BYTES } from "@oh-my-pi/pi-coding-agent/modes/rpc/rpc-frame";
import { validNegotiated, validReady, validResponse,
  type PreflightCommand } from "../contracts/preflight.ts";
import { CatalogClient, type CatalogCommand } from "../contracts/generated/catalog-client.ts";
import { validateCatalogCommand } from "../contracts/generated/catalog.generated.ts";
import { PhysicalFrames } from "./framing.ts";

interface ProcessSelection {
  argv: string[]; env: Record<string, string>; cwd?: string; timeoutMs?: number; signal?: AbortSignal;
  /** One ready-plus-negotiation budget, independent of the selected request/drain timeout. */
  readyTimeoutMs?: number;
}
interface Pending {
  command: CatalogCommand["type"] | "negotiate_protocol";
  resolve(value: unknown): void;
  reject(reason: Error): void;
  timer: ReturnType<typeof setTimeout>;
}
export interface DrainResult { code: number; forced: boolean; stderrBytes: number; protocolFailure?: string }

/** Isolated readonly catalog transport. No open/create/history/prompt commands are admitted. */
export class CatalogTransport {
  private readonly child;
  private readonly stdoutReader;
  private readonly stderrReader;
  private readonly frames = new PhysicalFrames(1,262144,false);
  private readonly ready = Promise.withResolvers<void>();
  private readonly pending = new Map<string, Pending>();
  private readonly settled = new Map<string, { command: string; expired: boolean }>();
  private readonly stdout: Promise<void>;
  private readonly stderr: Promise<void>;
  private readonly timeout: number;
  private readySeen = false;
  private admitting = true;
  private fault: Error | undefined;
  private stderrBytes = 0;
  private queuedWrites = 0;
  private writeQueue = Promise.resolve();
  private closing: Promise<DrainResult> | undefined;
  private readonly signal: AbortSignal | undefined;
  private readonly cancelled = () => { this.fail("RPC_CANCELLED"); };

  private constructor(selection: ProcessSelection) {
    this.timeout = selection.timeoutMs ?? 3000;
    this.signal = selection.signal;
    this.child = Bun.spawn(selection.argv, {
      env: selection.env, ...(selection.cwd === undefined ? {} : { cwd: selection.cwd }),
      stdin: "pipe", stdout: "pipe", stderr: "pipe",
    });
    this.stdoutReader = this.child.stdout.getReader();
    this.stderrReader = this.child.stderr.getReader();
    // Observe rejection immediately; open awaits the same promise after readers are attached.
    void this.ready.promise.catch(() => {});
    this.stdout = this.readStdout().catch(() => { this.fail("RPC_PROTOCOL"); });
    this.stderr = this.readStderr().catch(() => { this.fail("RPC_STDERR_LIMIT"); });
    this.signal?.addEventListener("abort", this.cancelled, { once: true });
    if (this.signal?.aborted) this.cancelled();
  }

  static async open(selection: ProcessSelection): Promise<CatalogTransport> {
    const client = new CatalogTransport(selection);
    const startupTimeout = selection.readyTimeoutMs ?? client.timeout;
    const timer = setTimeout(() => { client.fail("RPC_READY_TIMEOUT"); }, startupTimeout);
    try {
      await client.ready.promise;
      const result = await client.send(
        { id: crypto.randomUUID(), type: "negotiate_protocol", protocolVersion: 2 }, startupTimeout);
      if (!validNegotiated(result) || result.protocolVersion !== 2) throw new Error("RPC_NEGOTIATION");
      client.frames.negotiate(2);
      return client;
    } catch (error) {
      await client.close();
      throw error;
    } finally { clearTimeout(timer); }
  }

  get processId(): number { return this.child.pid; }

  readonly catalog = new CatalogClient(command => this.send(command));

  private send(command: CatalogCommand | Extract<PreflightCommand,{type:"negotiate_protocol"}>,
    timeoutMs = this.timeout): Promise<unknown> {
    if (!this.admitting || this.fault !== undefined) return Promise.reject(this.fault ?? new Error("RPC_CLOSED"));
    if (!validateCatalogCommand(command)) return Promise.reject(new Error("RPC_COMMAND_SCHEMA"));
    if (this.pending.size >= 32 || this.queuedWrites >= 32) return Promise.reject(new Error("RPC_PENDING_LIMIT"));
    const line = JSON.stringify(command) + "\n";
    if (Buffer.byteLength(line) > 16384) return Promise.reject(new Error("RPC_COMMAND_LIMIT"));
    const result = Promise.withResolvers<unknown>();
    const timer = setTimeout(() => {
      this.pending.delete(command.id);
      this.remember(command.id, command.type, true);
      result.reject(new Error("RPC_REQUEST_TIMEOUT"));
    }, timeoutMs);
    this.pending.set(command.id, { command: command.type, resolve: result.resolve, reject: result.reject, timer });
    this.queuedWrites++;
    this.writeQueue = this.writeQueue.then(async () => {
      try {
        // Expiry before this write starts must not publish a stale readonly request later.
        if (!this.pending.has(command.id)) return;
        this.child.stdin.write(line);
        await this.child.stdin.flush();
      } finally { this.queuedWrites--; }
    }).catch(() => { this.fail("RPC_STDIN"); });
    return result.promise;
  }

  private async readStdout(): Promise<void> {
    while (true) {
      const next = await this.stdoutReader.read();
      if (next.done) break;
      for (const frame of this.frames.push(next.value)) this.accept(frame);
    }
    this.frames.finish();
    if (!this.readySeen || this.pending.size !== 0) this.fail("RPC_UNEXPECTED_EOF");
  }

  private accept(frame: object): void {
    if (validReady(frame)) {
      if (this.readySeen || frame.protocolVersion !== 1 || !frame.supportedProtocolVersions?.includes(2)
        || frame.maxFrameBytes !== MAX_RPC_FRAME_BYTES || frame.maxReassembledFrameBytes !== MAX_RPC_REASSEMBLED_BYTES) {
        throw new Error("RPC_READY");
      }
      this.readySeen = true;
      this.ready.resolve();
      return;
    }
    if (!this.readySeen || !validResponse(frame) || frame.id === undefined) throw new Error("RPC_ENVELOPE_SCHEMA");
    const pending = this.pending.get(frame.id);
    if (pending === undefined) {
      const late = this.settled.get(frame.id);
      if (late?.expired && late.command === frame.command) return;
      throw new Error("RPC_CORRELATION");
    }
    if (frame.command !== pending.command) throw new Error("RPC_COMMAND_CORRELATION");
    this.pending.delete(frame.id);
    clearTimeout(pending.timer);
    this.remember(frame.id, frame.command, false);
    if (!frame.success) pending.reject(new Error(frame.error?.startsWith("CATALOG_") ? frame.error : "RPC_REMOTE_REJECTED"));
    else pending.resolve(frame.data);
  }

  private remember(id: string, command: string, expired: boolean): void {
    this.settled.set(id, { command, expired });
    if (this.settled.size > 256) {
      const first = this.settled.keys().next().value;
      if (first !== undefined) this.settled.delete(first);
    }
  }

  private async readStderr(): Promise<void> {
    while (true) {
      const next = await this.stderrReader.read();
      if (next.done) break;
      this.stderrBytes += next.value.byteLength;
      if (this.stderrBytes > 65_536) throw new Error("RPC_STDERR_LIMIT");
      // Never retain or return stderr content. Only the bounded byte count is diagnostic data.
    }
  }

  private fail(code: string): void {
    if (this.fault !== undefined) return;
    this.fault = new Error(code);
    this.admitting = false;
    this.ready.reject(this.fault);
    for (const item of this.pending.values()) {
      clearTimeout(item.timer);
      item.reject(this.fault);
    }
    this.pending.clear();
    this.child.kill("SIGTERM");
  }

  close(): Promise<DrainResult> {
    return this.closing ??= this.drain();
  }

  private async drain(): Promise<DrainResult> {
    this.admitting = false;
    let forced = false;
    const terminate = setTimeout(() => { forced = true; this.child.kill("SIGTERM"); }, this.timeout);
    const kill = setTimeout(() => { forced = true; this.child.kill("SIGKILL"); }, this.timeout + 500);
    const stopReaders = setTimeout(() => {
      this.fail("RPC_DRAIN_TIMEOUT");
      void this.stdoutReader.cancel();
      void this.stderrReader.cancel();
    }, this.timeout + 1000);
    try {
      await this.writeQueue;
      try { this.child.stdin.end(); } catch {}
      const code = await this.child.exited;
      await Promise.all([this.stdout, this.stderr]);
      return { code, forced, stderrBytes: this.stderrBytes,
        ...(this.fault === undefined ? {} : { protocolFailure: this.fault.message }) };
    } finally {
      clearTimeout(terminate); clearTimeout(kill); clearTimeout(stopReaders);
      this.signal?.removeEventListener("abort", this.cancelled);
    }
  }
}
