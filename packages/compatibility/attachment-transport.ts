/** Matched public native preparation/submission adapter; no browser-selected executable, path or raw command. */
import { MAX_RPC_FRAME_BYTES, MAX_RPC_REASSEMBLED_BYTES } from "@oh-my-pi/pi-coding-agent/modes/rpc/rpc-frame";
import { BoundedStdioTransport } from "./stdio-transport.ts";
import type { ProcessSelection } from "./stdio-transport.ts";
import { AttachmentClient, isAttachmentReceipt } from "../contracts/attachments.ts";
import { SubmissionClient, isSubmissionResult } from "../contracts/submissions.ts";
import { StrictStartClient } from "../contracts/generated/strict-client.ts";
import attachmentCommand from "../contracts/generated/attachment-command.js";
import submissionCommand from "../contracts/generated/submission-command.js";
import strictCommand from "../contracts/generated/strict-command.js";
import strictState from "../contracts/generated/strict-state.js";
import strictPolicy from "../contracts/generated/strict-policy.js";
import interactionPolicy from "../contracts/generated/interaction-policy.js";
import notification from "../contracts/generated/live-notification.js";
import type { ReadyEvent, RpcWireCommands, StrictStartState } from "../contracts/generated/omp-wire.ts";

/** Large stdin commands are opt-in and distinct from negotiated server stdout chunks. */
export function acceptsAttachmentInputPolicy(frame: ReadyEvent): boolean {
  const input = frame.rpcInputPolicy;
  return input?.version === "bounded-jsonl-input-v1" && input.encoding === "fatal-utf8" && input.framing === "unchunked-jsonl"
    && input.malformed === "sanitized-drop-line" && input.partialEof === "reject" && input.maxLineBytes === 48 * 1024 * 1024
    && input.maxPendingBytes === 64 * 1024 * 1024 && input.maxPendingFrames === 32
    && input.maxStartupBytes === 48 * 1024 * 1024 && input.maxStartupFrames === 8;
}
export class AttachmentTransport {
  #opened = false;
  readonly attachments: AttachmentClient;
  readonly submissions: SubmissionClient;
  readonly #startup: StrictStartClient;
  private constructor(private readonly core: BoundedStdioTransport) {
    this.attachments = new AttachmentClient(command => {
      this.#assertOpen(); return this.core.request({ ...command, id: command.id ?? crypto.randomUUID() }, 65_000);
    }, isAttachmentReceipt);
    this.submissions = new SubmissionClient(command => { this.#assertOpen(); return this.core.request(command); }, isSubmissionResult);
    this.#startup = new StrictStartClient(command => this.core.request(command, 30_000),
      (value): value is StrictStartState => strictState(value));
  }
  static async open(selection: ProcessSelection): Promise<AttachmentTransport> {
    return new AttachmentTransport(await BoundedStdioTransport.open(selection, {
      validateCommand: value => attachmentCommand(value) || submissionCommand(value) || strictCommand(value),
      acceptReady: frame => frame.strictStartup === "strict-start-v1" && strictPolicy(frame.strictStartupPolicy)
        && interactionPolicy(frame.interactionPolicy) && acceptsAttachmentInputPolicy(frame)
        && frame.supportedProtocolVersions?.includes(2) === true && frame.maxFrameBytes === MAX_RPC_FRAME_BYTES
        && frame.maxReassembledFrameBytes === MAX_RPC_REASSEMBLED_BYTES,
      remoteError: error => error && /^(?:ATTACHMENT|SUBMISSION|STRICT|GENERATION)_[A-Z_]+$/.test(error)
        ? error : "ATTACHMENT_NATIVE_REJECTED",
      physicalFrameBytes: MAX_RPC_FRAME_BYTES, allowChunks: true, commandBytes: 48 * 1024 * 1024,
      queuedBytes: 64 * 1024 * 1024, pendingLimit: 32, settledLimit: 256, stderrBytes: 65_536,
      defaultTimeoutMs: 10_000, notification: frame => notification(frame),
    }));
  }
  async start(input: RpcWireCommands["strict_start"]["params"]): Promise<StrictStartState> {
    if (this.#opened) throw Error("ATTACHMENT_SESSION_ALREADY_OPEN");
    const state = await this.#startup.start(input);
    if (state.phase !== "open") throw Error("ATTACHMENT_SESSION_NOT_OPEN");
    this.#opened = true; return state;
  }
  #assertOpen(): void { if (!this.#opened) throw Error("ATTACHMENT_SESSION_NOT_OPEN"); }
  get processId(): number { return this.core.processId; }
  close() { this.#opened = false; return this.core.close(); }
}
