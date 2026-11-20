import type { FileSink } from "bun";
import type { ControlSocket } from "../control-io/index.ts";
import { ControlDecoder, privateGeneration, type PrivateEvent, type PrivateHello } from "./control.ts";
import { PrivateHelperError, helperError } from "./errors.ts";
import { PrivateControlSession } from "./session.ts";
import { FencedNativeInput } from "./input.ts";

/** The public process/pipe seam. The OS remains the sole source of identities and direct-helper reap. */
export interface PrivateHelperProcess {
  pid: number;
  stdin: FileSink;
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
  exited: Promise<number>;
  readonly stdio: readonly unknown[];
}
export type PrivateHelperSocket = ControlSocket;
export interface PrivateHelperSystem {
  spawn(): PrivateHelperProcess;
  /** Success transfers fd ownership to the socket. Failure leaves it with the caller. */
  openControl(fd: number): PrivateHelperSocket;
  closeControl(fd: number): void;
}
export interface PrivateHelperControl {
  generation: string;
  registerHeldHelper(hello: Readonly<PrivateHello>): Promise<void>;
  readHostMonotonic?: () => bigint;
}
export type PrivateRootExit = Extract<PrivateEvent, { kind: "rootExit" }>;

export interface PrivateHelperHandle {
  control: PrivateControlSession;
  /** Synchronous Host-local sample from the original owner's selection. */
  readonly readHostMonotonic?: () => bigint;
  helperPid: number;
  /** Retain this handle and the selected lease even when startup fails. */
  ready: Promise<Readonly<PrivateHello>>;
  /** First accepted Native ROOT_EXIT. Rejects with PRIVATE_ROOT_EXIT_UNOBSERVED if control is lost first. */
  readonly rootExit: Promise<Readonly<PrivateRootExit>>;
  /** Direct helper reap only; never descendant extinction. */
  helperExited: Promise<number>;
  stdin: FileSink;
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
  /** Matched COMPLETE, fully decoded clean control EOF and successful helper reap, otherwise unresolved. */
  completed: Promise<void>;
  /** Fences Native input and closes control; never signals or abandons the helper. */
  disconnectControl(): void;
}

/** Host transport controller. It does not verify a release, authenticate a dispatcher or admit a Session. */
export class PrivateHelperController {
  readonly #system: PrivateHelperSystem;
  constructor(system: PrivateHelperSystem) { this.#system = system; }
  launch(input: PrivateHelperControl): PrivateHelperHandle {
    privateGeneration(input.generation);
    let process: PrivateHelperProcess;
    try { process = this.#system.spawn(); }
    catch (error) { throw helperError("HELPER_SPAWN_FAILED", error); }
    const owned = new RetainedHelper(input, process);
    try {
      const fd = process.stdio[3];
      if (typeof fd !== "number" || !Number.isSafeInteger(fd) || fd < 0) {
        throw new PrivateHelperError("HELPER_CONTROL_UNAVAILABLE");
      }
      owned.holdControl(() => this.#system.closeControl(fd));
      owned.connect(this.#system.openControl(fd));
    } catch (error) { owned.fail(new PrivateHelperError("HELPER_CONTROL_UNAVAILABLE", error)); }
    return owned.handle;
  }
}

class RetainedHelper {
  readonly handle: PrivateHelperHandle;
  readonly #input: PrivateHelperControl;
  readonly #process: PrivateHelperProcess;
  readonly #decoder: ControlDecoder;
  readonly #session: PrivateControlSession;
  readonly #nativeInput: FencedNativeInput;
  readonly #resolveReady: (hello: Readonly<PrivateHello>) => void;
  readonly #rejectReady: (error: Error) => void;
  readonly #resolveEnded: () => void;
  readonly #rootExit = Promise.withResolvers<Readonly<PrivateRootExit>>();
  #socket: PrivateHelperSocket | undefined;
  #closeRawControl: (() => void) | undefined;
  #failed: PrivateHelperError | undefined;
  #receivedEnd = false;
  #pendingBytes = 0;
  #pendingWrites = 0;
  #chain = Promise.resolve();

  constructor(input: PrivateHelperControl, process: PrivateHelperProcess) {
    this.#input = input;
    this.#process = process;
    this.#nativeInput = new FencedNativeInput(process.stdin);
    this.#decoder = new ControlDecoder(input.generation);
    const ready = Promise.withResolvers<Readonly<PrivateHello>>();
    const ended = Promise.withResolvers<void>();
    this.#resolveReady = ready.resolve;
    this.#rejectReady = ready.reject;
    this.#resolveEnded = () => ended.resolve();
    this.#session = this.createSession();
    const helperExited = process.exited.catch(error => { throw helperError("PRIVATE_DOMAIN_UNRESOLVED", error); });
    const completed = Promise.all([helperExited, ended.promise]).then(([code]) => {
      if (code !== 0 || this.#failed || !this.#session.helperReportedComplete) {
        throw new PrivateHelperError("PRIVATE_DOMAIN_UNRESOLVED", this.#failed);
      }
    }, error => { throw helperError("PRIVATE_DOMAIN_UNRESOLVED", error); });
    // Callers may observe these later; retain failures without process-level unhandled rejections.
    void ready.promise.catch(() => {});
    void this.#rootExit.promise.catch(() => {});
    void completed.catch(error => this.fail(error));
    this.handle = { control: this.#session, helperPid: process.pid, ready: ready.promise,
      ...(input.readHostMonotonic && { readHostMonotonic: input.readHostMonotonic }),
      rootExit: this.#rootExit.promise, helperExited, stdin: this.#nativeInput, stdout: process.stdout, stderr: process.stderr,
      completed, disconnectControl: () => this.fail(new PrivateHelperError("PRIVATE_DOMAIN_UNRESOLVED")) };
  }

  private createSession(): PrivateControlSession {
    return new PrivateControlSession({ generation: this.#input.generation, now: () => performance.now(),
      registerHeldHelper: async hello => {
        if (hello.helperPid !== this.#process.pid) throw new PrivateHelperError("HELPER_IDENTITY_MISMATCH");
        await this.#input.registerHeldHelper(hello);
      },
      closeNativeAdmission: async () => this.closeInput(),
      write: bytes => this.write(bytes),
    });
  }

  private closeInput(): void {
    try { void Promise.resolve(this.#nativeInput.end()).catch(() => {}); } catch { /* logical admission stays closed */ }
  }

  fail(error: unknown): void {
    const firstFailure = this.#failed === undefined;
    this.#failed ??= helperError("PRIVATE_DOMAIN_UNRESOLVED", error);
    this.closeInput();
    if (firstFailure) {
      try { this.#socket?.destroy(); } catch { /* ownership and unresolved result remain retained */ }
    }
    const closeRaw = this.#closeRawControl;
    this.#closeRawControl = undefined; // Invalidate before one attempt; an uncertain numeric fd must never be retried.
    try { closeRaw?.(); }
    catch { /* retain unresolved ownership; no disposal or drain claim */ }
    this.#rejectReady(this.#failed);
    this.#rootExit.reject(new PrivateHelperError("PRIVATE_ROOT_EXIT_UNOBSERVED", this.#failed));
    this.#resolveEnded();
  }

  private write(bytes: Uint8Array): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.#failed || ++this.#pendingWrites > 16 || !this.#socket) {
        const error = this.#failed ?? new PrivateHelperError("CONTROL_WRITE_LIMIT");
        reject(error); this.fail(error); return;
      }
      const written = (error?: unknown): void => {
        this.#pendingWrites--;
        if (error) { const failure = helperError("CONTROL_WRITE_FAILED", error); reject(failure); this.fail(failure); }
        else resolve();
      };
      try { this.#socket.write(bytes, written); }
      catch (error) { written(error); }
    });
  }

  holdControl(close: () => void): void { this.#closeRawControl = close; }

  connect(socket: PrivateHelperSocket): void {
    this.#closeRawControl = undefined;
    this.#socket = socket;
    socket.on("data", bytes => this.receive(bytes));
    socket.on("error", () => this.fail(new PrivateHelperError("PRIVATE_DOMAIN_UNRESOLVED")));
    socket.on("end", () => this.end(true));
    socket.on("close", () => this.end(false));
    const startupTimer = setTimeout(() => this.fail(new PrivateHelperError("PRIVATE_DOMAIN_UNRESOLVED")), 10_000);
    void this.handle.ready.then(() => clearTimeout(startupTimer), () => clearTimeout(startupTimer));
  }

  private receive(bytes: Buffer): void {
    this.#pendingBytes += bytes.length;
    if (this.#pendingBytes > 16_384) { this.fail(new PrivateHelperError("CONTROL_LIMIT")); return; }
    this.#chain = this.#chain.then(async () => {
      if (this.#failed) return;
      for (const event of this.#decoder.push(bytes)) {
        await this.#session.accept(event);
        if (this.#failed) return;
        if (event.kind === "hello") this.#resolveReady(event);
        else if (event.kind === "rootExit") this.#rootExit.resolve(Object.freeze(event));
      }
    }).finally(() => { this.#pendingBytes -= bytes.length; });
    void this.#chain.catch(error => this.fail(error));
  }

  private end(cleanEof: boolean): void {
    if (this.#failed || this.#receivedEnd) return;
    if (!cleanEof) { this.fail(new PrivateHelperError("PRIVATE_DOMAIN_UNRESOLVED")); return; }
    this.#receivedEnd = true;
    this.#chain = this.#chain.then(() => {
      this.#decoder.finish();
      if (!this.#session.helperReportedComplete) this.fail(new PrivateHelperError("PRIVATE_DOMAIN_UNRESOLVED"));
      this.#resolveEnded();
    });
    void this.#chain.catch(error => this.fail(error));
  }
}
