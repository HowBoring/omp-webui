import type { PrivateHelperHandle } from "../supervision/adapter.ts";
import { validNegotiated, validReady, validResponse, type ReadyEvent } from "../contracts/preflight.ts";
import { PhysicalFrames } from "./framing.ts";
import { StdioWriteQueue } from "./stdio-write-queue.ts";

interface StdioTiming {
  timeoutMs?: number; signal?: AbortSignal;
  /** Bound ready plus negotiation independently; defaults to the existing request/drain timeout. */
  readyTimeoutMs?: number;
}
export interface ProcessSelection extends StdioTiming {
  argv: string[]; env: Record<string, string>; cwd?: string;
}
interface Pending {
  command: string;
  resolve(value: unknown): void;
  reject(reason: Error): void;
  timer: Timer;
  dispatched: boolean;
  cleanup: boolean;
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

export type GracefulDrainResult = { status: "closed"; drain: DrainResult }
  | { status: "pending"; completion: Promise<DrainResult>; stdoutEOF: boolean; stderrEOF: boolean };

/** Host-internal command envelope. Mode adapters retain their generated command/result interfaces. */
export interface StdioCommand { id: string; type: string }

/** Only the mode adapter decides which commands, ready capabilities and notifications are admissible. */
export interface StdioPolicy {
  validateCommand(value: unknown): boolean;
  /** Validate ready even after a retained Session fence, when publication is disabled. */
  acceptReady(frame: ReadyEvent, publish: boolean): boolean;
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
  /** Always validate known notifications. Owned retirement disables publication to the Session. Unknown frames return false. */
  notification?(frame: object, publish: boolean): boolean;
}

type OwnedRpcCode =
  | "RPC_CANCELLED" | "RPC_CLEANUP_CLOSED" | "RPC_CLOSED" | "RPC_COMMAND_LIMIT" | "RPC_COMMAND_SCHEMA"
  | "RPC_DRAIN_TIMEOUT" | "RPC_DUPLICATE_ID" | "RPC_NEGOTIATION" | "RPC_PENDING_LIMIT"
  | "RPC_PIPE_ATTACH_FAILED" | "RPC_PIPES_IN_USE" | "RPC_PROTOCOL" | "RPC_READY_TIMEOUT"
  | "RPC_REQUEST_TIMEOUT" | "RPC_ROOT_EXITED" | "RPC_ROOT_EXIT_UNOBSERVED" | "RPC_STARTUP_FAILED"
  | "RPC_SESSION_RETIRED" | "RPC_STDERR_LIMIT" | "RPC_STDIN" | "RPC_STDOUT_CLOSED" | "RPC_UNEXPECTED_EOF";

/** Stable local transport error for the retained Session attachment. */
export class OwnedRpcError extends Error {
  constructor(readonly code: OwnedRpcCode) { super(code); this.name = "OwnedRpcError"; }
}

/** Shared negotiation, correlation, framing and bounded pipe I/O. */
class BoundedStdioRpc {
  protected readonly stdoutReader;
  protected readonly stderrReader;
  private readonly frames: PhysicalFrames;
  private readonly ready = Promise.withResolvers<void>();
  private readonly unavailable = Promise.withResolvers<never>();
  private readonly pending = new Map<string, Pending>();
  private readonly settled = new Map<string, { command: string; awaitingLateResponse: boolean }>();
  protected readonly stdout: Promise<void>;
  protected readonly stderr: Promise<void>;
  protected readonly timeout: number;
  private readySeen = false;
  protected admitting = true;
  private fault: Error | undefined;
  private admissionFailure: Error | undefined;
  private retirement: { error: Error; cutoff: number } | undefined;
  private stderrBytes = 0;
  protected stdoutEOF = false;
  protected stderrEOF = false;
  protected observedTailNotifications = 0;
  protected readersCancelled = false;
  protected readonly writes: StdioWriteQueue;
  private readonly signal: AbortSignal | undefined;
  private readonly cancelled = () => { this.fail("RPC_CANCELLED"); };

  constructor(pipes: Pick<PrivateHelperHandle, "stdin" | "stdout" | "stderr">, timing: StdioTiming,
    private readonly policy: StdioPolicy, private readonly onFault: () => void, private readonly ownedPipes = false) {
    this.frames = new PhysicalFrames(1, policy.physicalFrameBytes, policy.allowChunks);
    this.timeout = timing.timeoutMs ?? policy.defaultTimeoutMs ?? 3000;
    this.signal = timing.signal;
    this.writes = new StdioWriteQueue(pipes.stdin, policy.pendingLimit ?? 32,
      policy.queuedBytes ?? (policy.pendingLimit ?? 32) * policy.commandBytes);
    this.stdoutReader = pipes.stdout.getReader();
    try { this.stderrReader = pipes.stderr.getReader(); }
    catch (error) {
      this.stdoutReader.releaseLock();
      throw error;
    }
    void this.unavailable.promise.catch(() => {});
    this.stdout = this.readStdout().catch(() => { this.fail("RPC_PROTOCOL"); });
    this.stderr = this.readStderr().catch(() => { this.fail("RPC_STDERR_LIMIT"); });
    this.signal?.addEventListener("abort", this.cancelled, { once: true });
    if (this.signal?.aborted) this.cancelled();
  }

  protected async negotiate(timing: StdioTiming, gate?: Promise<unknown>): Promise<void> {
    const startupTimeout = timing.readyTimeoutMs ?? this.timeout;
    const timer = setTimeout(() => { this.fail("RPC_READY_TIMEOUT"); }, startupTimeout);
    try {
      if (gate) await Promise.race([gate, this.unavailable.promise]);
      await Promise.race([this.ready.promise, this.unavailable.promise]);
      const result = await this.request(
        { id: crypto.randomUUID(), type: "negotiate_protocol", protocolVersion: 2 }, startupTimeout);
      if (!validNegotiated(result) || result.protocolVersion !== 2) {
        if (this.ownedPipes) this.fail("RPC_NEGOTIATION");
        throw this.rpcError("RPC_NEGOTIATION");
      }
      if (this.ownedPipes && this.admissionFailure !== undefined) throw this.admissionFailure;
    } finally { clearTimeout(timer); }
  }

  request<Command extends StdioCommand>(command: Command, timeoutMs = this.timeout): Promise<unknown> {
    return this.sendRequest(command, timeoutMs, false);
  }

  protected retireForCleanup(cutoff: number): boolean {
    if (!this.admitting) return false;
    if (this.retirement === undefined) {
      const now = performance.now();
      this.retirement = { error: this.rpcError("RPC_SESSION_RETIRED"),
        cutoff: Number.isFinite(cutoff) && cutoff - now <= 30_000 ? cutoff : now };
      // Cleanup can only enqueue after this transition, so existing requests are all regular work.
      this.rejectPending(this.retirement.error);
    }
    return this.cleanupRemaining() > 0;
  }

  protected requestCleanup(command: StdioCommand): Promise<unknown> {
    return this.sendRequest(command, this.timeout, true);
  }

  private cleanupRemaining(): number {
    return this.retirement === undefined ? 0 : Math.max(0, this.retirement.cutoff - performance.now());
  }

  private sendRequest(command: StdioCommand, timeoutMs: number, cleanup: boolean): Promise<unknown> {
    if (!this.admitting) return Promise.reject(this.admissionFailure ?? this.rpcError("RPC_CLOSED"));
    if (!cleanup && this.retirement !== undefined) return Promise.reject(this.retirement.error);
    const remaining = cleanup ? this.cleanupRemaining() : Infinity;
    if (remaining <= 0) return Promise.reject(this.rpcError("RPC_CLEANUP_CLOSED"));
    if (!this.policy.validateCommand(command)) return Promise.reject(this.rpcError("RPC_COMMAND_SCHEMA"));
    if (this.pending.has(command.id) || this.settled.has(command.id)) return Promise.reject(this.rpcError("RPC_DUPLICATE_ID"));
    const line = JSON.stringify(command) + "\n";
    const bytes = Buffer.byteLength(line);
    if (bytes > this.policy.commandBytes) return Promise.reject(this.rpcError("RPC_COMMAND_LIMIT"));
    if (this.pending.size >= (this.policy.pendingLimit ?? 32) || !this.writes.hasCapacity(bytes)) {
      return Promise.reject(this.rpcError("RPC_PENDING_LIMIT"));
    }
    const result = Promise.withResolvers<unknown>();
    const timeoutCode = remaining <= timeoutMs ? "RPC_CLEANUP_CLOSED" : "RPC_REQUEST_TIMEOUT";
    const timer = setTimeout(() => this.expireRequest(command.id, pending, timeoutCode),
      Math.min(timeoutMs, Math.ceil(remaining)));
    const pending: Pending = { command: command.type, resolve: result.resolve, reject: result.reject,
      timer, dispatched: false, cleanup };
    this.pending.set(command.id, pending);
    void this.writes.enqueue(line, () => this.canDispatch(command.id, pending), () => {
      pending.dispatched = true;
    }).catch(() => {
      if (this.admissionFailure === undefined) this.fail("RPC_STDIN");
    });
    return result.promise;
  }

  private canDispatch(id: string, request: Pending): boolean {
    if (this.pending.get(id) !== request) return false;
    if (!request.cleanup || this.cleanupRemaining() > 0) return true;
    this.expireRequest(id, request, "RPC_CLEANUP_CLOSED");
    return false;
  }

  private expireRequest(id: string, request: Pending, code: OwnedRpcCode): void {
    this.pending.delete(id);
    clearTimeout(request.timer);
    this.remember(id, request.command, !this.ownedPipes || request.dispatched);
    request.reject(this.rpcError(code));
  }

  private get publish(): boolean {
    return !this.ownedPipes || (this.admissionFailure === undefined && this.retirement === undefined);
  }

  private async readStdout(): Promise<void> {
    let framingFailed = false;
    while (true) {
      const next = await this.stdoutReader.read();
      if (next.done) break;
      if (framingFailed) continue;
      try { this.frames.push(next.value, frame => this.accept(frame)); }
      catch (error) {
        if (!this.ownedPipes) throw error;
        framingFailed = true;
        this.fail("RPC_PROTOCOL");
      }
    }
    if (this.readersCancelled) return;
    this.stdoutEOF = true;
    if (framingFailed) return;
    this.frames.finish();
    if (!this.readySeen || this.pending.size !== 0) this.fail("RPC_UNEXPECTED_EOF");
  }

  private accept(frame: object): void {
    if (validReady(frame)) {
      if (this.readySeen || !this.policy.acceptReady(frame, this.publish)) {
        throw new Error("RPC_READY");
      }
      this.readySeen = true;
      this.ready.resolve();
      return;
    }
    if (!this.readySeen) throw new Error("RPC_ENVELOPE_SCHEMA");
    if (!validResponse(frame)) {
      const publish = this.publish;
      if (!this.policy.notification?.(frame, publish)) throw new Error("RPC_ENVELOPE_SCHEMA");
      if (!publish) {
        this.observedTailNotifications = Math.min(this.observedTailNotifications + 1, Number.MAX_SAFE_INTEGER);
      }
      return;
    }
    if (frame.id === undefined) throw new Error("RPC_ENVELOPE_SCHEMA");
    const pending = this.pending.get(frame.id);
    if (pending === undefined) {
      const late = this.settled.get(frame.id);
      if (late?.awaitingLateResponse && late.command === frame.command) {
        if (this.ownedPipes) {
          this.remember(frame.id, frame.command, false);
          if (!this.acceptNegotiation(frame)) this.fail("RPC_NEGOTIATION");
        }
        return;
      }
      throw new Error("RPC_CORRELATION");
    }
    if (this.ownedPipes && !pending.dispatched) throw new Error("RPC_CORRELATION");
    if (frame.command !== pending.command) throw new Error("RPC_COMMAND_CORRELATION");
    this.pending.delete(frame.id);
    clearTimeout(pending.timer);
    this.remember(frame.id, frame.command, false);
    if (pending.cleanup && this.cleanupRemaining() <= 0) pending.reject(this.rpcError("RPC_CLEANUP_CLOSED"));
    else if (!frame.success) pending.reject(new Error(this.policy.remoteError(frame.error)));
    else {
      // Transition synchronously at the validated correlated ack, before another line in this read is decoded.
      this.acceptNegotiation(frame);
      pending.resolve(frame.data);
    }
  }

  private acceptNegotiation(frame: { command: string; success: boolean; data?: unknown }): boolean {
    if (!frame.success || frame.command !== "negotiate_protocol") return true;
    if (!validNegotiated(frame.data) || frame.data.protocolVersion !== 2) return false;
    this.frames.negotiate(2);
    return true;
  }

  private remember(id: string, command: string, awaitingLateResponse: boolean): void {
    this.settled.set(id, { command, awaitingLateResponse });
    if (this.settled.size > (this.policy.settledLimit ?? 256)) {
      const first = this.settled.keys().next().value;
      if (first !== undefined) this.settled.delete(first);
    }
  }

  private async readStderr(): Promise<void> {
    const limit = this.policy.stderrBytes ?? 65_536;
    let exceeded = false;
    while (true) {
      const next = await this.stderrReader.read();
      if (next.done) break;
      if (exceeded) continue;
      // Never retain or return stderr content. Only the bounded byte count is diagnostic data.
      this.stderrBytes += next.value.byteLength;
      if (this.stderrBytes <= limit) continue;
      if (!this.ownedPipes) throw new Error("RPC_STDERR_LIMIT");
      this.stderrBytes = limit;
      exceeded = true;
      this.fail("RPC_STDERR_LIMIT");
    }
    this.stderrEOF = !this.readersCancelled;
  }

  private rejectWork(error: Error): void {
    this.admitting = false;
    this.admissionFailure ??= error;
    this.unavailable.reject(error);
    this.rejectPending(error);
  }

  private rejectPending(error: Error): void {
    for (const [id, item] of this.pending) {
      clearTimeout(item.timer);
      if (this.ownedPipes) this.remember(id, item.command, item.dispatched);
      item.reject(error);
    }
    this.pending.clear();
  }

  private rpcError(code: OwnedRpcCode): Error {
    return this.ownedPipes ? new OwnedRpcError(code) : new Error(code);
  }

  protected fail(code: OwnedRpcCode): void {
    if (this.fault !== undefined) return;
    this.fault = this.rpcError(code);
    this.rejectWork(this.fault);
    this.onFault();
  }

  protected fence(code: OwnedRpcCode): void {
    if (this.admissionFailure === undefined) this.rejectWork(this.rpcError(code));
  }

  protected outputFacts() {
    return { stderrBytes: this.stderrBytes, stdoutEOF: this.stdoutEOF, stderrEOF: this.stderrEOF,
      ...(this.fault === undefined ? {} : { protocolFailure: this.fault.message }) };
  }

  protected detachSignal(): void { this.signal?.removeEventListener("abort", this.cancelled); }
}

/** Bounded transport for directly spawned preflight, catalog and Session fixtures. */
export class BoundedStdioTransport extends BoundedStdioRpc {
  private readonly child;
  private readonly processState: { exited: boolean };
  private terminationObserved = false;
  private forceObserved = false;
  private closing: Promise<DrainResult> | undefined;
  private graceful: Promise<DrainResult> | undefined;

  private constructor(selection: ProcessSelection, policy: StdioPolicy) {
    const child = Bun.spawn(selection.argv, {
      env: selection.env, ...(selection.cwd === undefined ? {} : { cwd: selection.cwd }),
      stdin: "pipe", stdout: "pipe", stderr: "pipe",
    });
    const state = { exited: false };
    super(child, selection, policy, () => { if (!state.exited) child.kill("SIGTERM"); });
    this.child = child; this.processState = state;
    void child.exited.then(() => { state.exited = true; this.admitting = false; });
  }

  static async open(selection: ProcessSelection, policy: StdioPolicy): Promise<BoundedStdioTransport> {
    const client = new BoundedStdioTransport(selection, policy);
    try {
      await client.negotiate(selection);
      return client;
    } catch (error) {
      await client.close();
      throw error;
    }
  }

  get processId(): number { return this.child.pid; }
  get exited(): Promise<number> { return this.child.exited; }

  /** Idle retirement has no signal timers. Timeout retains the exact handle; a later authorized shutdown may escalate it. */
  async closeGracefully(timeoutMs = 5000): Promise<GracefulDrainResult> {
    if (!Number.isFinite(timeoutMs) || timeoutMs < 0 || timeoutMs > 10_000) throw new Error("RPC_DRAIN_POLICY");
    const completion = this.graceful ??= this.gracefulDrain();
    const elapsed = Promise.withResolvers<void>();
    const timer = setTimeout(() => elapsed.resolve(), timeoutMs);
    try {
      return await Promise.race([completion.then(drain => ({ status: "closed" as const, drain })),
        elapsed.promise.then(() => ({ status: "pending" as const, completion,
          stdoutEOF: this.stdoutEOF, stderrEOF: this.stderrEOF }))]);
    } finally { clearTimeout(timer); }
  }

  private async gracefulDrain(): Promise<DrainResult> {
    this.admitting = false;
    await this.writes.drain();
    try { this.child.stdin.end(); } catch {}
    const code = await this.child.exited;
    await Promise.all([this.stdout, this.stderr]);
    this.detachSignal();
    return { code, forced: this.terminationObserved || this.forceObserved,
      terminationSent: this.terminationObserved, forceSent: this.forceObserved, ...this.outputFacts() };
  }

  close(policy?: DrainPolicy): Promise<DrainResult> {
    if (policy && (![policy.cooperativeMs, policy.terminationGraceMs, policy.readerGraceMs].every(value => Number.isFinite(value) && value >= 0)
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
      if (this.processState.exited) return;
      forced = true; terminationSent = true; this.terminationObserved = true; this.child.kill("SIGTERM");
    }, cooperative);
    const kill = setTimeout(() => {
      if (this.processState.exited) return;
      forced = true; forceSent = true; this.forceObserved = true; this.child.kill("SIGKILL");
    }, cooperative + grace);
    const stopReaders = setTimeout(() => {
      this.fail("RPC_DRAIN_TIMEOUT");
      // Cancellation resolves pending reads with done: true.
      this.readersCancelled = true;
      void this.stdoutReader.cancel();
      void this.stderrReader.cancel();
    }, cooperative + grace + readerGrace);
    try {
      await this.writes.drain();
      try { this.child.stdin.end(); } catch {}
      const code = await this.child.exited;
      await Promise.all([this.stdout, this.stderr]);
      return { code, forced, terminationSent, forceSent, ...this.outputFacts() };
    } finally {
      clearTimeout(terminate); clearTimeout(kill); clearTimeout(stopReaders);
      this.detachSignal();
    }
  }
}

/** Owned Native pipes carry public RPC; only the retained helper controls the process lifecycle. */
class OwnedStdioRpc extends BoundedStdioRpc {
  readonly output: Promise<StdioOutput>;
  readonly negotiated: Promise<void>;
  private readonly closeInput: () => void;
  private negotiatedV2 = false;

  constructor(helper: PrivateHelperHandle, timing: StdioTiming, policy: StdioPolicy) {
    const closeInput = () => {
      try { void Promise.resolve(helper.stdin.end()).catch(() => {}); }
      catch { /* The Native input fence closes before the underlying pipe. */ }
    };
    super(helper, timing, policy, closeInput, true);
    this.closeInput = closeInput;
    // The HELLO promise supplies the startup verdict. After HELLO, observe root exit and control loss directly.
    void helper.ready.then(() => {
      void helper.rootExit.then(
        () => this.fenceInput("RPC_ROOT_EXITED"), () => this.fenceInput("RPC_ROOT_EXIT_UNOBSERVED"));
    }, () => {});
    void this.stdout.then(() => {
      if (this.stdoutEOF) this.fenceInput("RPC_STDOUT_CLOSED");
    });
    this.output = Promise.all([this.stdout, this.stderr]).then(() => {
      this.detachSignal();
      return { ...this.outputFacts(), observedTailNotifications: this.observedTailNotifications };
    });
    this.negotiated = this.negotiate(timing, helper.ready).then(() => { this.negotiatedV2 = true; }, error => {
      this.fenceInput("RPC_STARTUP_FAILED");
      throw error;
    });
  }

  beginCleanup(cutoff: number): ((command: StdioCommand) => Promise<unknown>) | undefined {
    if (!this.negotiatedV2) {
      this.fenceInput("RPC_SESSION_RETIRED");
      return;
    }
    if (this.retireForCleanup(cutoff)) return command => this.requestCleanup(command);
  }

  private fenceInput(code: OwnedRpcCode): void {
    this.fence(code);
    this.closeInput();
  }
}

export interface StdioOutput {
  stdoutEOF: boolean; stderrEOF: boolean; stderrBytes: number; protocolFailure?: string;
  /**
   * Validated notifications after admission closed, capped at the maximum safe integer.
   * Validation can stop before EOF after a stdout framing fault.
   */
  observedTailNotifications: number;
}

/** @internal The fixed Session mode adapter supplies the policy for the retained Native pipes. */
export function attachOwnedStdio(helper: PrivateHelperHandle, timing: StdioTiming, policy: StdioPolicy) {
  if (helper.stdout.locked || helper.stderr.locked) throw new OwnedRpcError("RPC_PIPES_IN_USE");
  const core = new OwnedStdioRpc(helper, timing, policy);
  const ready: Promise<Pick<BoundedStdioRpc, "request">> = core.negotiated.then(() => ({
    request: (command, timeoutMs) => core.request(command, timeoutMs),
  }));
  return { ready, output: core.output, beginCleanup: (cutoff: number) => core.beginCleanup(cutoff) };
}
