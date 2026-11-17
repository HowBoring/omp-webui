import { ControlIoError } from "./errors.ts";

export type IoResult = { kind: "bytes"; count: number } | { kind: "blocked" | "interrupted" | "eof" };
/** Synchronous OS byte-I/O seam. No retained buffers, background syscall or fd duplication is permitted. */
export interface ControlIoSystem {
  /** Failure leaves the original descriptor with the caller; success transfers it exclusively. */
  adopt(fd: number): number;
  receive(handle: number, destination: Uint8Array): IoResult;
  send(handle: number, source: Uint8Array): IoResult;
  /** Invalidate before exactly one close attempt. An error is unresolved and must never be retried. */
  close(handle: number): void;
  dispose(): Promise<void>;
}
export interface ControlScheduler {
  /** Schedule a later turn (production uses 5ms). Must never invoke synchronously. */
  schedule(callback: () => void): number;
  cancel(token: number): void;
}
/** Exclusive owned byte stream; transport close is never process drainage. */
export interface ControlSocket {
  on(event: "data", listener: (bytes: Buffer) => void): void;
  on(event: "error" | "end" | "close", listener: () => void): void;
  write(bytes: Uint8Array, callback: (error?: Error | null) => void): void;
  destroy(): void;
}
export interface OwnedControlSocket extends ControlSocket {
  readonly failure: ControlIoError | undefined;
}
export interface OwnedControlIo {
  openControl(fd: number): OwnedControlSocket;
  /** Refuses while any socket, poll turn or user callback is active. */
  close(): Promise<void>;
}
type ControlListener = [event: "data", listener: (bytes: Buffer) => void]
  | [event: "error" | "end" | "close", listener: () => void];
type Write = { bytes: Uint8Array; offset: number; callback: (error?: Error | null) => void };
let processHandles = 0;
let processActivity = 0;

/** Public controlled-OS construction seam; production construction must use the approved loader. No import-time I/O. */
export function createOwnedControlIo(system: ControlIoSystem, scheduler: ControlScheduler): OwnedControlIo {
  const sockets = new Set<OwnedSocket>();
  let closed = false;
  let disposed = false;
  let uncertainClose: ControlIoError | undefined;
  let closing: Promise<void> | undefined;
  const run = (callback: () => void) => {
    processActivity++; try { callback(); } finally { processActivity--; }
  };
  return {
    openControl(fd) {
      if (closed || closing) throw new ControlIoError("CONTROL_IO_CLOSED");
      if (!Number.isInteger(fd) || fd < 0 || fd > 2_147_483_647) throw new ControlIoError("CONTROL_IO_ARGUMENT");
      if (processHandles >= 64) throw new ControlIoError("CONTROL_IO_LIMIT");
      let handle: number;
      try { handle = system.adopt(fd); }
      catch (error) { throw error instanceof ControlIoError ? error : new ControlIoError("CONTROL_IO_ADOPT_FAILED"); }
      if (!Number.isInteger(handle) || handle <= 0) throw new ControlIoError("CONTROL_IO_ADOPT_FAILED");
      // Register sole ownership before scheduling; scheduling failure closes the transferred handle.
      const socket = new OwnedSocket(system, scheduler, handle, run, failure => {
        sockets.delete(socket); processHandles--;
        if (failure?.code === "CONTROL_IO_CLOSE_UNCERTAIN") uncertainClose ??= failure;
      });
      sockets.add(socket); processHandles++;
      socket.start();
      return socket;
    },
    async close() {
      if (disposed) return;
      if (uncertainClose) { closed = true; throw uncertainClose; }
      if (processHandles || processActivity) throw new ControlIoError("CONTROL_IO_BUSY");
      if (closing) return closing;
      closed = true;
      try { closing = system.dispose(); await closing; disposed = true; }
      catch (error) { throw error instanceof ControlIoError ? error : new ControlIoError("CONTROL_IO_LOAD_FAILED"); }
      finally { closing = undefined; }
    },
  };
}

class OwnedSocket implements OwnedControlSocket {
  readonly #system: ControlIoSystem;
  readonly #scheduler: ControlScheduler;
  readonly #handle: number;
  readonly #run: (callback: () => void) => void;
  readonly #release: (failure?: ControlIoError) => void;
  readonly #data: ((bytes: Buffer) => void)[] = [];
  readonly #events: Record<"error" | "end" | "close", (() => void)[]> = { error: [], end: [], close: [] };
  readonly #writes: Write[] = [];
  readonly #read = new Uint8Array(512);
  #queuedBytes = 0;
  #timer: number | undefined;
  #closed = false;
  #failure: ControlIoError | undefined;
  constructor(system: ControlIoSystem, scheduler: ControlScheduler, handle: number,
    run: (callback: () => void) => void, release: (failure?: ControlIoError) => void) {
    this.#system = system; this.#scheduler = scheduler; this.#handle = handle;
    this.#run = run; this.#release = release;
  }
  get failure() { return this.#failure; }
  on(event: "data", listener: (bytes: Buffer) => void): void;
  on(event: "error" | "end" | "close", listener: () => void): void;
  on(...args: ControlListener): void {
    if (args[0] === "data") {
      if (this.#data.length === 16) throw new ControlIoError("CONTROL_IO_LIMIT");
      this.#data.push(args[1]);
    } else {
      if (this.#events[args[0]].length === 16) throw new ControlIoError("CONTROL_IO_LIMIT");
      this.#events[args[0]].push(args[1]);
    }
  }
  start(): void {
    try { this.#timer = this.#scheduler.schedule(() => this.#run(() => this.#turn())); }
    catch { this.#terminate(new ControlIoError("CONTROL_IO_CLOSED")); }
  }
  write(bytes: Uint8Array, callback: (error?: Error | null) => void): void {
    if (this.#closed) { this.#invoke(() => callback(this.#failure ?? new ControlIoError("CONTROL_IO_CLOSED"))); return; }
    if (bytes.byteLength === 0 || bytes.byteLength > 512 || this.#writes.length === 16
      || this.#queuedBytes + bytes.byteLength > 8192) {
      const error = new ControlIoError("CONTROL_IO_LIMIT");
      this.#terminate(error, false, () => callback(error)); return;
    }
    this.#writes.push({ bytes: Uint8Array.from(bytes), offset: 0, callback });
    this.#queuedBytes += bytes.byteLength;
  }
  destroy(): void { this.#terminate(); }
  #invoke(callback: () => void): void {
    this.#run(() => {
      try { callback(); }
      catch { this.#terminate(new ControlIoError("CONTROL_IO_CALLBACK_FAILED")); }
    });
  }
  #emit(event: "error" | "end" | "close"): void {
    for (const listener of [...this.#events[event]]) this.#invoke(listener);
  }
  #terminate(error?: ControlIoError, eof = false, rejected?: () => void): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#failure = error;
    if (this.#timer !== undefined) {
      try { this.#scheduler.cancel(this.#timer); }
      catch { this.#failure ??= new ControlIoError("CONTROL_IO_CLOSED"); }
    }
    this.#timer = undefined;
    try { this.#system.close(this.#handle); }
    catch (failure) {
      this.#failure = failure instanceof ControlIoError ? failure : new ControlIoError("CONTROL_IO_CLOSE_UNCERTAIN");
    }
    // Ownership is invalidated before callbacks. The module activity guard still prevents reentrant dlclose.
    this.#release(this.#failure);
    const writes = this.#writes.splice(0); this.#queuedBytes = 0;
    const cancelled = this.#failure ?? new ControlIoError("CONTROL_IO_CLOSED");
    this.#run(() => {
      for (const write of writes) this.#invoke(() => write.callback(cancelled));
      if (rejected) this.#invoke(rejected);
      if (this.#failure) this.#emit("error");
      if (eof) this.#emit("end");
      this.#emit("close");
    });
  }
  #count(result: IoResult, maximum: number): number {
    if (result.kind !== "bytes") return 0;
    if (!Number.isInteger(result.count) || result.count <= 0 || result.count > maximum) {
      throw new ControlIoError("CONTROL_IO_ARGUMENT");
    }
    return result.count;
  }
  #send(maximum: number): number {
    const write = this.#writes[0];
    if (!write) return 0;
    const bytes = write.bytes.subarray(write.offset, write.offset + maximum);
    const result = this.#system.send(this.#handle, bytes);
    if (result.kind === "eof") throw new ControlIoError("CONTROL_IO_WRITE_FAILED");
    const count = this.#count(result, bytes.byteLength);
    write.offset += count;
    if (write.offset === write.bytes.byteLength) {
      this.#writes.shift(); this.#queuedBytes -= write.bytes.byteLength;
      this.#invoke(() => write.callback());
    }
    return count;
  }
  #receive(maximum: number): number {
    const destination = this.#read.subarray(0, Math.min(512, maximum));
    const result = this.#system.receive(this.#handle, destination);
    if (result.kind === "eof") { this.#terminate(undefined, true); return 0; }
    const count = this.#count(result, destination.byteLength);
    if (count) {
      const bytes = Buffer.from(destination.subarray(0, count));
      for (const listener of [...this.#data]) {
        if (this.#closed) break;
        this.#invoke(() => listener(bytes));
      }
    }
    return count;
  }
  #turn(): void {
    this.#timer = undefined;
    if (this.#closed) return;
    try {
      let bytes = 0;
      for (let calls = 0; calls < 64 && bytes < 16_384 && !this.#closed;) {
        let progress = 0;
        if (this.#writes.length) { calls++; progress += this.#send(16_384 - bytes); bytes += progress; }
        if (this.#closed || calls === 64 || bytes === 16_384) break;
        calls++;
        const read = this.#receive(16_384 - bytes); bytes += read; progress += read;
        if (!progress) break;
      }
    } catch (error) {
      this.#terminate(error instanceof ControlIoError ? error : new ControlIoError("CONTROL_IO_READ_FAILED"));
    }
    if (!this.#closed) this.start();
  }
}
