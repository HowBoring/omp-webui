import { MAX_RPC_FRAME_BYTES, RpcFrameDecoder } from "@oh-my-pi/pi-coding-agent/modes/rpc/rpc-frame";

/** Physical byte carrier around the matched public OMP logical decoder. */
export class PhysicalFrames {
  private readonly bytes: Uint8Array;
  private readonly decoder = new RpcFrameDecoder();
  private used = 0;
  private pendingChunk = false;
  private version: 1 | 2;

  constructor(version: 1 | 2 = 1, private readonly limit = MAX_RPC_FRAME_BYTES, private readonly allowChunks = true) {
    this.version = version; this.bytes = new Uint8Array(limit);
  }
  negotiate(version: 2): void { this.version = version; }

  /** A synchronous consumer can apply a correlated negotiation before decoding the next physical line. */
  push(chunk: Uint8Array, accept?: (frame: object) => void): object[] {
    const output: object[] = [];
    let start = 0;
    while (start < chunk.byteLength) {
      const newline = chunk.indexOf(10, start);
      const end = newline < 0 ? chunk.byteLength : newline + 1;
      const length = end - start;
      if (this.used + length > this.limit) throw new Error("RPC_PHYSICAL_LIMIT");
      this.bytes.set(chunk.subarray(start, end), this.used);
      this.used += length;
      if (newline >= 0) {
        const text = new TextDecoder("utf-8", { fatal: true }).decode(this.bytes.subarray(0, this.used - 1));
        const value: unknown = JSON.parse(text);
        if (isRecord(value) && value.type === "rpc_chunk" && (!this.allowChunks || this.version !== 2)) {
          throw new Error("RPC_CHUNK_BEFORE_NEGOTIATION");
        }
        const frame = this.decoder.push(value);
        this.pendingChunk = frame === undefined;
        if (frame !== undefined) {
          if (accept) accept(frame);
          else output.push(frame);
        }
        this.used = 0;
      }
      start = end;
    }
    return output;
  }

  finish(): void {
    if (this.used !== 0 || this.pendingChunk) throw new Error("RPC_PARTIAL_EOF");
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
