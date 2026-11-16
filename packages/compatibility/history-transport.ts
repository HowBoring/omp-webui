import { MAX_RPC_FRAME_BYTES, MAX_RPC_REASSEMBLED_BYTES } from "@oh-my-pi/pi-coding-agent/modes/rpc/rpc-frame";
import { HistoryClient } from "../contracts/generated/history-client.ts";
import { validateHistoryCommand, validHistoryNotification } from "../contracts/generated/history.generated.ts";
import { BoundedStdioTransport, type ProcessSelection } from "./stdio-transport.ts";
export type { DrainResult } from "./stdio-transport.ts";

/** Narrow isolated history adapter. No prompts, native paths, UI answers or private product admission. */
export class HistoryTransport {
  readonly #transport: BoundedStdioTransport;
  private constructor(transport: BoundedStdioTransport) { this.#transport = transport; }

  static async open(selection: ProcessSelection): Promise<HistoryTransport> {
    return new HistoryTransport(await BoundedStdioTransport.open(selection, {
      validateCommand: validateHistoryCommand,
      acceptReady: frame => frame.protocolVersion === 1 && frame.supportedProtocolVersions?.includes(2) === true
        && frame.maxFrameBytes === MAX_RPC_FRAME_BYTES && frame.maxReassembledFrameBytes === MAX_RPC_REASSEMBLED_BYTES,
      remoteError: error => error !== undefined && error.length <= 96 && /^history_[a-z_]+$/.test(error)
        ? error : "RPC_REMOTE_REJECTED",
      physicalFrameBytes: MAX_RPC_FRAME_BYTES, allowChunks: false, commandBytes: 16_384,
      pendingLimit: 32, settledLimit: 256, stderrBytes: 65_536, defaultTimeoutMs: 10_000,
      // This read-only fixture ignores only validated public command-catalog metadata.
      // Future live projection must supply its own declared event schemas and bounded reconciliation.
      notification: frame => validHistoryNotification(frame),
    }));
  }

  get processId(): number { return this.#transport.processId; }
  readonly history = new HistoryClient(command => this.#transport.request(command));
  close() { return this.#transport.close(); }
}
