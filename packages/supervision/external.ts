import { ControlDecoder, type PrivateHello, type PrivateEvent } from "./control.ts";
import type { PrivateHelperSocket } from "./controller.ts";

export type ExternalProtectorErrorCode = "EXTERNAL_SPAWN_FAILED" | "EXTERNAL_CONTROL_UNAVAILABLE"
  | "EXTERNAL_PROTOCOL" | "EXTERNAL_REGISTRATION_FAILED" | "EXTERNAL_CONTROL_WRITE_FAILED"
  | "EXTERNAL_UNRESOLVED" | "EXTERNAL_BUILD_UNSUPPORTED" | "EXTERNAL_BUILD_REQUIRES_FRESH_RELEASE"
  | "EXTERNAL_BUILD_DESTINATION_EXISTS" | "EXTERNAL_BUILD_FAILED" | "EXTERNAL_BUILD_IO_FAILED"
  | "EXTERNAL_LAUNCH_UNSUPPORTED" | "EXTERNAL_FENCE_CHANGED" | "EXTERNAL_MAINTENANCE_FAILED";
const externalSystemCodes = ["EACCES", "EPERM", "ENOENT", "EEXIST", "EIO", "EMFILE", "ENFILE", "ENOSPC",
  "ENOMEM", "ENOTDIR", "EISDIR", "ELOOP", "EBADF", "EPIPE", "ECONNRESET", "EINVAL"] as const;
type ExternalCauseCode = ExternalProtectorErrorCode | typeof externalSystemCodes[number] | "UNCLASSIFIED";
/** A finite diagnostic category, without raw paths, compiler output, cause objects or messages. */
export class ExternalProtectorError extends Error {
  readonly causeCode: ExternalCauseCode | undefined;
  constructor(readonly code: ExternalProtectorErrorCode, cause?: unknown) {
    super(code); this.name = "ExternalProtectorError";
    this.causeCode = cause === undefined ? undefined : cause instanceof ExternalProtectorError ? cause.code
      : typeof cause === "object" && cause !== null && "code" in cause && typeof cause.code === "string"
        ? externalSystemCodes.find(code => code === cause.code) ?? "UNCLASSIFIED" : "UNCLASSIFIED";
  }
}
export type ExternalProtectorHello = Readonly<PrivateHello>;
/** Sole direct child of the actual dispatcher. No stdin/stdout RPC or signal interface is exposed. */
export interface ExternalProtectorProcess {
  pid: number;
  exited: Promise<number>;
  readonly stdio: readonly unknown[];
}
export interface ExternalProtectorSystem {
  spawn(): ExternalProtectorProcess;
  /** Success transfers fd ownership; a throw leaves the fd with the caller. */
  openControl(fd: number): PrivateHelperSocket;
  closeControl(fd: number): void;
}
export interface ExternalProtectorRegistration {
  generation: string;
  /** Actual dispatcher authenticates peer pidfd, direct parent, separate approval, scope and durable fence. */
  registerHeldProtector(hello: ExternalProtectorHello): Promise<void>;
}
export interface ExternalProtectorHandle {
  protectorPid: number;
  /** Startup rejects if root exit is observed before readiness, independently of terminal completion. */
  ready: Promise<ExternalProtectorHello>;
  /** Reap alone never proves tree extinction or dispatcher COMPLETE acknowledgement. */
  protectorExited: Promise<number>;
  /** COMPLETE is provisional; success also requires clean control EOF and successful direct protector reap. */
  completed: Promise<void>;
  /** Disconnect preserves the externally owned tree. No stop/force/mandatory policy exists here. */
  disconnectControl(): void;
}
/** Trusted dispatcher process/socket seam only. No ordinary client, Host or browser launch authority. */
export class ExternalProtectorController {
  readonly #system: ExternalProtectorSystem;
  constructor(system: ExternalProtectorSystem) { this.#system = system; }
  launch(input: ExternalProtectorRegistration): ExternalProtectorHandle {
    if (!/^[a-f0-9]{64}$/.test(input.generation)) throw new ExternalProtectorError("EXTERNAL_PROTOCOL");
    let process: ExternalProtectorProcess;
    try { process = this.#system.spawn(); }
    catch (error) { throw new ExternalProtectorError("EXTERNAL_SPAWN_FAILED", error); }
    const owned = new RetainedProtector(input, process);
    try {
      const fd = process.stdio[3];
      if (typeof fd !== "number" || !Number.isSafeInteger(fd) || fd < 0) {
        throw new ExternalProtectorError("EXTERNAL_CONTROL_UNAVAILABLE");
      }
      owned.holdControl(() => this.#system.closeControl(fd));
      owned.connect(this.#system.openControl(fd));
    } catch (error) { owned.fail(new ExternalProtectorError("EXTERNAL_CONTROL_UNAVAILABLE", error)); }
    return owned.handle;
  }
}
class RetainedProtector {
  readonly handle: ExternalProtectorHandle;
  readonly #input: ExternalProtectorRegistration;
  readonly #process: ExternalProtectorProcess;
  readonly #decoder: ControlDecoder;
  readonly #ready = Promise.withResolvers<ExternalProtectorHello>();
  readonly #ended = Promise.withResolvers<void>();
  #socket: PrivateHelperSocket | undefined;
  #closeRaw: (() => void) | undefined;
  #failure: ExternalProtectorError | undefined;
  #receivedHello = false;
  #receivedRootExit = false;
  #receivedComplete = false;
  #receivedEnd = false;
  #registered = false;
  #complete = false;
  #pendingBytes = 0;
  #chain = Promise.resolve();
  constructor(input: ExternalProtectorRegistration, process: ExternalProtectorProcess) {
    this.#input = input; this.#process = process; this.#decoder = new ControlDecoder(input.generation);
    const protectorExited = process.exited.catch(error => { throw new ExternalProtectorError("EXTERNAL_UNRESOLVED", error); });
    const completed = Promise.all([protectorExited, this.#ended.promise]).then(([code]) => {
      if (code !== 0 || this.#failure || !this.#complete) throw new ExternalProtectorError("EXTERNAL_UNRESOLVED");
    }, error => { throw new ExternalProtectorError("EXTERNAL_UNRESOLVED", error); });
    void this.#ready.promise.catch(() => {});
    void completed.catch(error => this.fail(error));
    this.handle = { protectorPid: process.pid, ready: this.#ready.promise, protectorExited, completed,
      disconnectControl: () => this.fail(new ExternalProtectorError("EXTERNAL_UNRESOLVED")) };
  }
  holdControl(close: () => void): void { this.#closeRaw = close; }
  fail(error: unknown): void {
    const first = this.#failure === undefined;
    this.#failure ??= error instanceof ExternalProtectorError ? error : new ExternalProtectorError("EXTERNAL_UNRESOLVED", error);
    if (first) { try { this.#socket?.destroy(); } catch { /* retain owning handle */ } }
    const closeRaw = this.#closeRaw;
    this.#closeRaw = undefined; // Invalidate before one attempt; an uncertain numeric fd must never be retried.
    try { closeRaw?.(); } catch { /* retain unresolved ownership; no cleanup or drain claim */ }
    this.#ready.reject(this.#failure); this.#ended.resolve();
  }
  connect(socket: PrivateHelperSocket): void {
    this.#closeRaw = undefined; this.#socket = socket;
    socket.on("data", bytes => this.receive(bytes));
    socket.on("error", () => this.fail(new ExternalProtectorError("EXTERNAL_UNRESOLVED")));
    socket.on("end", () => this.end(true)); socket.on("close", () => this.end(false));
    const timer = setTimeout(() => this.fail(new ExternalProtectorError("EXTERNAL_UNRESOLVED")), 10_000);
    void this.handle.ready.then(() => clearTimeout(timer), () => clearTimeout(timer));
  }
  private receive(bytes: Buffer): void {
    if (this.#failure) return;
    let events: PrivateEvent[];
    try {
      events = this.#decoder.push(bytes);
      this.validateReceived(events);
    } catch (error) {
      this.fail(error instanceof ExternalProtectorError ? error : new ExternalProtectorError("EXTERNAL_PROTOCOL", error));
      return;
    }
    this.#pendingBytes += bytes.length;
    if (this.#pendingBytes > 16_384) { this.fail(new ExternalProtectorError("EXTERNAL_PROTOCOL")); return; }
    this.#chain = this.#chain.then(async () => {
      if (this.#failure) return;
      for (const event of events) {
        if (event.kind === "hello") {
          try { await this.#input.registerHeldProtector(Object.freeze({ ...event })); }
          catch (error) { throw new ExternalProtectorError("EXTERNAL_REGISTRATION_FAILED", error); }
          if (this.#failure) return;
          this.#registered = true;
          if (this.#receivedRootExit) continue;
          await this.start();
          if (!this.#receivedRootExit && !this.#failure) this.#ready.resolve(event);
        } else if (event.kind === "complete") this.#complete = true;
      }
    }).finally(() => { this.#pendingBytes -= bytes.length; });
    void this.#chain.catch(error => this.fail(error));
  }
  private validateReceived(events: readonly PrivateEvent[]): void {
    // All receipt-known failures must precede asynchronous registration and START.
    if (events.some(event => event.kind === "state" && event.phase === "incomplete")) {
      throw new ExternalProtectorError("EXTERNAL_UNRESOLVED");
    }
    for (const event of events) {
      if (this.#receivedComplete) throw new ExternalProtectorError("EXTERNAL_PROTOCOL");
      if (event.kind === "hello") {
        if (this.#receivedHello || event.helperPid !== this.#process.pid) {
          throw new ExternalProtectorError("EXTERNAL_PROTOCOL");
        }
        this.#receivedHello = true;
      } else {
        if (!this.#receivedHello) throw new ExternalProtectorError("EXTERNAL_PROTOCOL");
        if (event.kind === "rootExit") {
          if (this.#receivedRootExit) throw new ExternalProtectorError("EXTERNAL_PROTOCOL");
          this.#receivedRootExit = true;
        } else if (event.kind === "complete") {
          if (!this.#registered || !this.#receivedRootExit) throw new ExternalProtectorError("EXTERNAL_PROTOCOL");
          this.#receivedComplete = true;
        } else if (event.phase !== "waiting" && event.phase !== "running") {
          throw new ExternalProtectorError("EXTERNAL_PROTOCOL");
        }
      }
    }
    // Valid root death closes startup, not the independently verified terminal drain.
    if (this.#receivedRootExit) this.#ready.reject(new ExternalProtectorError("EXTERNAL_UNRESOLVED"));
  }
  private start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const done = (error?: Error | null): void => {
        if (error) reject(new ExternalProtectorError("EXTERNAL_CONTROL_WRITE_FAILED", error)); else resolve();
      };
      try {
        if (!this.#socket) throw new ExternalProtectorError("EXTERNAL_CONTROL_UNAVAILABLE");
        this.#socket.write(new TextEncoder().encode(`START ${this.#input.generation}\n`), done);
      } catch (error) { reject(new ExternalProtectorError("EXTERNAL_CONTROL_WRITE_FAILED", error)); }
    });
  }
  private end(cleanEof: boolean): void {
    if (this.#failure || this.#receivedEnd) return;
    if (!cleanEof) { this.fail(new ExternalProtectorError("EXTERNAL_UNRESOLVED")); return; }
    this.#receivedEnd = true;
    // Before registration, no valid completion can precede this loss of control.
    if (!this.#registered) { this.fail(new ExternalProtectorError("EXTERNAL_UNRESOLVED")); return; }
    this.#chain = this.#chain.then(() => {
      this.#decoder.finish();
      if (!this.#complete) this.fail(new ExternalProtectorError("EXTERNAL_UNRESOLVED"));
      this.#ended.resolve();
    });
    void this.#chain.catch(error => this.fail(error));
  }
}
