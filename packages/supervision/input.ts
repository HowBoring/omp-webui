import type { FileSink } from "bun";
import { PrivateHelperError, helperError } from "./errors.ts";

/** Logical admission closes synchronously even when the underlying OS pipe cannot finish closing. */
export class FencedNativeInput implements FileSink {
  #closed = false;
  readonly #sink: FileSink;
  constructor(sink: FileSink) { this.#sink = sink; }
  write(chunk: Parameters<FileSink["write"]>[0]): number | Promise<number> {
    return this.perform(() => this.#sink.write(chunk));
  }
  flush(): number | Promise<number> { return this.perform(() => this.#sink.flush()); }
  end(): number | Promise<number> {
    if (this.#closed) return 0;
    this.#closed = true;
    try {
      return Promise.resolve(this.#sink.end()).catch(error => { throw helperError("NATIVE_ADMISSION_CLOSE_FAILED", error); });
    } catch (error) { throw helperError("NATIVE_ADMISSION_CLOSE_FAILED", error); }
  }
  start(options?: { highWaterMark?: number }): void {
    if (this.#closed) throw new PrivateHelperError("NATIVE_ADMISSION_CLOSED");
    try { this.#sink.start(options); } catch (error) { throw helperError("NATIVE_INPUT_FAILED", error); }
  }
  ref(): void { this.#sink.ref(); }
  unref(): void { this.#sink.unref(); }
  private perform(operation: () => number | Promise<number>): number | Promise<number> {
    if (this.#closed) throw new PrivateHelperError("NATIVE_ADMISSION_CLOSED");
    try {
      const result = operation();
      return typeof result === "number" ? result
        : result.catch(error => { throw helperError("NATIVE_INPUT_FAILED", error); });
    } catch (error) { throw helperError("NATIVE_INPUT_FAILED", error); }
  }
}
