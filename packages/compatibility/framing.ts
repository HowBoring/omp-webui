import { MAX_RPC_FRAME_BYTES, RpcFrameDecoder } from "@oh-my-pi/pi-coding-agent/modes/rpc/rpc-frame";

/** Physical byte carrier around the matched public OMP logical decoder. */
export class PhysicalFrames {
  private readonly bytes = new Uint8Array(MAX_RPC_FRAME_BYTES);
  private readonly decoder = new RpcFrameDecoder();
  private used = 0;
  private pendingChunk = false;
  private version: 1 | 2;

  constructor(version: 1 | 2 = 1) { this.version = version; }
  negotiate(version: 2): void { this.version = version; }

  push(chunk: Uint8Array): object[] {
    const output: object[] = [];
    let start = 0;
    while (start < chunk.byteLength) {
      const newline = chunk.indexOf(10, start);
      const end = newline < 0 ? chunk.byteLength : newline + 1;
      const length = end - start;
      if (this.used + length > MAX_RPC_FRAME_BYTES) throw new Error("RPC_PHYSICAL_LIMIT");
      this.bytes.set(chunk.subarray(start, end), this.used);
      this.used += length;
      if (newline >= 0) {
        const text = new TextDecoder("utf-8", { fatal: true }).decode(this.bytes.subarray(0, this.used - 1));
        const value: unknown = JSON.parse(text);
        if (isRecord(value) && value.type === "rpc_chunk" && this.version !== 2) {
          throw new Error("RPC_CHUNK_BEFORE_NEGOTIATION");
        }
        const frame = this.decoder.push(value);
        this.pendingChunk = frame === undefined;
        if (frame !== undefined) output.push(frame);
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
