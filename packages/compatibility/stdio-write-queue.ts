import type { FileSink } from "bun";

/** Bounded serialized writes to a process pipe. Count/bytes include an inflight flush. */
export class StdioWriteQueue {
  #writes = 0;
  #bytes = 0;
  #tail = Promise.resolve();

  constructor(private readonly sink: FileSink, private readonly countLimit: number, private readonly byteLimit: number) {}

  hasCapacity(bytes: number): boolean {
    return this.#writes < this.countLimit && this.#bytes + bytes <= this.byteLimit;
  }

  /** Check liveness when the write starts, so expiry behind backpressure cannot publish stale work. */
  enqueue(line: string, active: () => boolean, dispatched: () => void): Promise<void> {
    const bytes = Buffer.byteLength(line);
    if (!this.hasCapacity(bytes)) throw new Error("RPC_PENDING_LIMIT");
    this.#writes++; this.#bytes += bytes;
    const write = this.#tail.then(async () => {
      try {
        if (!active()) return;
        const written = this.sink.write(line);
        // A synchronous fence or write fault cannot authorize a late reply. An in-flight send can.
        dispatched();
        await Promise.all([written, Promise.try(() => this.sink.flush())]);
      } finally { this.#writes--; this.#bytes -= bytes; }
    });
    // Observe failures immediately and keep later slots releasable even after a failed predecessor.
    this.#tail = write.catch(() => {});
    return write;
  }

  drain(): Promise<void> { return this.#tail; }
}
