import { validNegotiated, validReady, validResponse, type ReadyEvent } from "../contracts/preflight.ts";
import { PhysicalFrames } from "./framing.ts";
import { StdioWriteQueue } from "./stdio-write-queue.ts";

export interface ProcessSelection {
  argv: string[]; env: Record<string, string>; cwd?: string; timeoutMs?: number; signal?: AbortSignal;
  /** Bound ready plus negotiation independently; defaults to the existing request/drain timeout. */
  readyTimeoutMs?: number;
}
interface Pending {
  command: string;
  resolve(value: unknown): void;
  reject(reason: Error): void;
  timer: Timer;
}
export interface DrainPolicy {
  /** Cooperative stdin EOF/drain before SIGTERM. This does not attest native quiescence. */
  cooperativeMs: number;
  terminationGraceMs: number;
  readerGraceMs: number;
}
export interface DrainResult {
  code: number; forced: boolean; stderrBytes: number; protocolFailure?: string;
  terminationSent?: boolean; forceSent?: boolean; stdoutEOF?: boolean; stderrEOF?: boolean;
}

/** Host-internal command envelope. Mode adapters retain their generated command/result interfaces. */
export interface StdioCommand { id: string; type: string }

/** Only the mode adapter decides which commands, ready capabilities and notifications are admissible. */
export interface StdioPolicy {
  validateCommand(value: unknown): boolean;
  acceptReady(frame: ReadyEvent): boolean;
  remoteError(error: string | undefined): string;
  physicalFrameBytes: number;
  allowChunks: boolean;
  commandBytes: number;
  queuedBytes?: number;
  /** Defaults preserve the preflight/catalog bounded resource policy. */
  pendingLimit?: number;
  settledLimit?: number;
  stderrBytes?: number;
  defaultTimeoutMs?: number;
  /** Validate known notifications even during drain; callers fence retired generations. Unknown frames return false. */
  notification?(frame: object): boolean;
}

/** Bounded process lifecycle, correlation and write/drain mechanics shared by narrow public clients. */
export class BoundedStdioTransport {
  private readonly child;
  private readonly stdoutReader;
  private readonly stderrReader;
  private readonly frames: PhysicalFrames;
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
  private stdoutEOF = false;
  private stderrEOF = false;
  private processExited = false;
  private readonly writes: StdioWriteQueue;
  private closing: Promise<DrainResult> | undefined;
  private readonly signal: AbortSignal | undefined;
  private readonly cancelled = () => { this.fail("RPC_CANCELLED"); };

  private constructor(selection: ProcessSelection, private readonly policy: StdioPolicy) {
    this.frames = new PhysicalFrames(1, policy.physicalFrameBytes, policy.allowChunks);
    this.timeout = selection.timeoutMs ?? policy.defaultTimeoutMs ?? 3000;
    this.signal = selection.signal;
    this.child = Bun.spawn(selection.argv, {
      env: selection.env, ...(selection.cwd === undefined ? {} : { cwd: selection.cwd }),
      stdin: "pipe", stdout: "pipe", stderr: "pipe",
    });
    void this.child.exited.then(() => { this.processExited = true; });
    this.writes = new StdioWriteQueue(this.child.stdin, policy.pendingLimit ?? 32,
      policy.queuedBytes ?? (policy.pendingLimit ?? 32) * policy.commandBytes);
    this.stdoutReader = this.child.stdout.getReader();
    this.stderrReader = this.child.stderr.getReader();
    // Observe rejection immediately; open awaits the same promise after readers are attached.
    void this.ready.promise.catch(() => {});
    this.stdout = this.readStdout().catch(() => { this.fail("RPC_PROTOCOL"); });
    this.stderr = this.readStderr().catch(() => { this.fail("RPC_STDERR_LIMIT"); });
    this.signal?.addEventListener("abort", this.cancelled, { once: true });
    if (this.signal?.aborted) this.cancelled();
  }

  static async open(selection: ProcessSelection, policy: StdioPolicy): Promise<BoundedStdioTransport> {
    const client = new BoundedStdioTransport(selection, policy);
    const startupTimeout = selection.readyTimeoutMs ?? client.timeout;
    const timer = setTimeout(() => { client.fail("RPC_READY_TIMEOUT"); }, startupTimeout);
    try {
      await client.ready.promise;
      const result = await client.request(
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
  get exited(): Promise<number> { return this.child.exited; }

  request<Command extends StdioCommand>(command: Command, timeoutMs = this.timeout): Promise<unknown> {
    if (!this.admitting || this.fault !== undefined) return Promise.reject(this.fault ?? new Error("RPC_CLOSED"));
    if (!this.policy.validateCommand(command)) return Promise.reject(new Error("RPC_COMMAND_SCHEMA"));
    if (this.pending.has(command.id) || this.settled.has(command.id)) return Promise.reject(new Error("RPC_DUPLICATE_ID"));
    const line = JSON.stringify(command) + "\n";
    const bytes = Buffer.byteLength(line);
    if (bytes > this.policy.commandBytes) return Promise.reject(new Error("RPC_COMMAND_LIMIT"));
    if (this.pending.size >= (this.policy.pendingLimit ?? 32) || !this.writes.hasCapacity(bytes)) {
      return Promise.reject(new Error("RPC_PENDING_LIMIT"));
    }
    const result = Promise.withResolvers<unknown>();
    const timer = setTimeout(() => {
      this.pending.delete(command.id);
      this.remember(command.id, command.type, true);
      result.reject(new Error("RPC_REQUEST_TIMEOUT"));
    }, timeoutMs);
    this.pending.set(command.id, { command: command.type, resolve: result.resolve, reject: result.reject, timer });
    void this.writes.enqueue(line, () => this.pending.has(command.id)).catch(() => { this.fail("RPC_STDIN"); });
    return result.promise;
  }

  private async readStdout(): Promise<void> {
    while (true) {
      const next = await this.stdoutReader.read();
      if (next.done) break;
      this.frames.push(next.value, frame => this.accept(frame));
    }
    this.stdoutEOF = true;
    this.frames.finish();
    if (!this.readySeen || this.pending.size !== 0) this.fail("RPC_UNEXPECTED_EOF");
  }

  private accept(frame: object): void {
    if (validReady(frame)) {
      if (this.readySeen || !this.policy.acceptReady(frame)) {
        throw new Error("RPC_READY");
      }
      this.readySeen = true;
      this.ready.resolve();
      return;
    }
    if (!this.readySeen) throw new Error("RPC_ENVELOPE_SCHEMA");
    if (!validResponse(frame)) {
      if (this.policy.notification?.(frame)) return;
      throw new Error("RPC_ENVELOPE_SCHEMA");
    }
    if (frame.id === undefined) throw new Error("RPC_ENVELOPE_SCHEMA");
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
    if (!frame.success) pending.reject(new Error(this.policy.remoteError(frame.error)));
    else {
      // Transition synchronously at the validated correlated ack, before another line in this read is decoded.
      if (pending.command === "negotiate_protocol" && validNegotiated(frame.data) && frame.data.protocolVersion === 2) {
        this.frames.negotiate(2);
      }
      pending.resolve(frame.data);
    }
  }

  private remember(id: string, command: string, expired: boolean): void {
    this.settled.set(id, { command, expired });
    if (this.settled.size > (this.policy.settledLimit ?? 256)) {
      const first = this.settled.keys().next().value;
      if (first !== undefined) this.settled.delete(first);
    }
  }

  private async readStderr(): Promise<void> {
    while (true) {
      const next = await this.stderrReader.read();
      if (next.done) { this.stderrEOF = true; break; }
      this.stderrBytes += next.value.byteLength;
      if (this.stderrBytes > (this.policy.stderrBytes ?? 65_536)) throw new Error("RPC_STDERR_LIMIT");
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
    if (!this.processExited) this.child.kill("SIGTERM");
  }

  close(policy?: DrainPolicy): Promise<DrainResult> {
    if (policy && (!Object.values(policy).every(value => Number.isFinite(value) && value >= 0)
      || policy.cooperativeMs > 30_000 || policy.terminationGraceMs > 5_000 || policy.readerGraceMs > 5_000)) {
      return Promise.reject(new Error("RPC_DRAIN_POLICY"));
    }
    return this.closing ??= this.drain(policy);
  }

  private async drain(policy?: DrainPolicy): Promise<DrainResult> {
    this.admitting = false;
    let forced = false, terminationSent = false, forceSent = false;
    const cooperative = policy?.cooperativeMs ?? this.timeout;
    const grace = policy?.terminationGraceMs ?? 500;
    const readerGrace = policy?.readerGraceMs ?? 500;
    const terminate = setTimeout(() => {
      if (this.processExited) return;
      forced = true; terminationSent = true; this.child.kill("SIGTERM");
    }, cooperative);
    const kill = setTimeout(() => {
      if (this.processExited) return;
      forced = true; forceSent = true; this.child.kill("SIGKILL");
    }, cooperative + grace);
    const stopReaders = setTimeout(() => {
      this.fail("RPC_DRAIN_TIMEOUT");
      void this.stdoutReader.cancel();
      void this.stderrReader.cancel();
    }, cooperative + grace + readerGrace);
    try {
      await this.writes.drain();
      try { this.child.stdin.end(); } catch {}
      const code = await this.child.exited;
      await Promise.all([this.stdout, this.stderr]);
      return { code, forced, stderrBytes: this.stderrBytes,
        ...(policy ? { terminationSent, forceSent, stdoutEOF: this.stdoutEOF, stderrEOF: this.stderrEOF } : {}),
        ...(this.fault === undefined ? {} : { protocolFailure: this.fault.message }) };
    } finally {
      clearTimeout(terminate); clearTimeout(kill); clearTimeout(stopReaders);
      this.signal?.removeEventListener("abort", this.cancelled);
    }
  }
}
