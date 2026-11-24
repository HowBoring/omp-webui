import { BoundedStdioTransport, type ProcessSelection } from "./stdio-transport.ts";
import { StrictStartClient } from "../contracts/generated/strict-client.ts";
import command from "../contracts/generated/strict-command.js";
import strictPolicy from "../contracts/generated/strict-policy.js";
import state from "../contracts/generated/strict-state.js";
import notification from "../contracts/generated/strict-notification.js";
import uiRequest from "../contracts/generated/interaction-request.js";
import policy from "../contracts/generated/interaction-policy.js";
import type { StrictStartState } from "../contracts/generated/omp-wire.ts";

/** Mode-specific public validation over the shared bounded process transport. No browser-selected executable/argv. */
export class StrictTransport {
  readonly startup: StrictStartClient;
  private constructor(private readonly core: BoundedStdioTransport, startTimeoutMs?: number) {
    this.startup = new StrictStartClient(command => this.core.request(command, command.type === "strict_start" ? startTimeoutMs : undefined),
      (value): value is StrictStartState => state(value));
  }
  static async open(selection: ProcessSelection, options: { startTimeoutMs?: number } = {}): Promise<StrictTransport> {
    return new StrictTransport(await BoundedStdioTransport.open(selection, {
      validateCommand: command,
      acceptReady: frame => frame.strictStartup === "strict-start-v1" && policy(frame.interactionPolicy) && strictPolicy(frame.strictStartupPolicy),
      remoteError: error => error && /^(?:STRICT|GENERATION)_[A-Z_]+$/.test(error) ? error : "STRICT_REMOTE_REJECTED",
      physicalFrameBytes: 262_144, allowChunks: false, commandBytes: 16_384,
      notification: frame => notification(frame) || (uiRequest(frame) &&
        ["setWidget", "setStatus", "notify", "setTitle", "set_editor_text", "setWorkingMessage", "setFooter", "setHeader"].includes(String(Reflect.get(frame, "method")))),
    }), options.startTimeoutMs);
  }
  get processId(): number { return this.core.processId; }
  get exited(): Promise<number> { return this.core.exited; }
  close() { return this.core.close(); }
}
