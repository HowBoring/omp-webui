import { MAX_RPC_FRAME_BYTES, MAX_RPC_REASSEMBLED_BYTES } from "@oh-my-pi/pi-coding-agent/modes/rpc/rpc-frame";
import { validCommand, validReport, type CompatibilityReport } from "../contracts/preflight.ts";
import { BoundedStdioTransport, type ProcessSelection } from "./stdio-transport.ts";
export type { DrainResult } from "./stdio-transport.ts";

/** Diagnostic-only external process client. It cannot admit Session commands or arbitrary RPC. */
export class PreflightTransport {
  private constructor(private readonly transport: BoundedStdioTransport) {}

  static async open(selection: ProcessSelection): Promise<PreflightTransport> {
    return new PreflightTransport(await BoundedStdioTransport.open(selection, {
      validateCommand: validCommand,
      acceptReady: frame => frame.protocolVersion === 1 && frame.supportedProtocolVersions?.includes(2) === true
        && frame.maxFrameBytes === MAX_RPC_FRAME_BYTES && frame.maxReassembledFrameBytes === MAX_RPC_REASSEMBLED_BYTES,
      remoteError: () => "RPC_REMOTE_REJECTED",
      physicalFrameBytes: MAX_RPC_FRAME_BYTES, allowChunks: true, commandBytes: MAX_RPC_FRAME_BYTES,
    }));
  }

  get processId(): number { return this.transport.processId; }

  async inspect(): Promise<CompatibilityReport> {
    const result = await this.transport.request({ id: crypto.randomUUID(), type: "get_compatibility" });
    if (!validReport(result)) throw new Error("RPC_RESULT_SCHEMA");
    return result;
  }

  close() { return this.transport.close(); }
}
