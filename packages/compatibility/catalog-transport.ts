import { MAX_RPC_FRAME_BYTES, MAX_RPC_REASSEMBLED_BYTES } from "@oh-my-pi/pi-coding-agent/modes/rpc/rpc-frame";
import { CatalogClient } from "../contracts/generated/catalog-client.ts";
import { validateCatalogCommand } from "../contracts/generated/catalog.generated.ts";
import { BoundedStdioTransport, type ProcessSelection } from "./stdio-transport.ts";
export type { DrainResult } from "./stdio-transport.ts";

/** Isolated readonly catalog transport. No open/create/history/prompt commands are admitted. */
export class CatalogTransport {
  private constructor(private readonly transport: BoundedStdioTransport) {}

  static async open(selection: ProcessSelection): Promise<CatalogTransport> {
    return new CatalogTransport(await BoundedStdioTransport.open(selection, {
      validateCommand: validateCatalogCommand,
      acceptReady: frame => frame.protocolVersion === 1 && frame.supportedProtocolVersions?.includes(2) === true
        && frame.maxFrameBytes === MAX_RPC_FRAME_BYTES && frame.maxReassembledFrameBytes === MAX_RPC_REASSEMBLED_BYTES,
      remoteError: error => error?.startsWith("CATALOG_") ? error : "RPC_REMOTE_REJECTED",
      physicalFrameBytes: 262144, allowChunks: false, commandBytes: 16384,
    }));
  }

  get processId(): number { return this.transport.processId; }
  readonly catalog = new CatalogClient(command => this.transport.request(command));
  close() { return this.transport.close(); }
}
