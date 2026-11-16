import { MAX_RPC_FRAME_BYTES, MAX_RPC_REASSEMBLED_BYTES } from "@oh-my-pi/pi-coding-agent/modes/rpc/rpc-frame";
import { z } from "zod";
import { BoundedStdioTransport, type ProcessSelection, type DrainPolicy } from "./stdio-transport.ts";
import { StrictStartClient } from "../contracts/generated/strict-client.ts";
import { HistoryClient } from "../contracts/generated/history-client.ts";
import { validateHistoryCommand } from "../contracts/generated/history.generated.ts";
import strictCommand from "../contracts/generated/strict-command.js";
import strictState from "../contracts/generated/strict-state.js";
import strictPolicy from "../contracts/generated/strict-policy.js";
import interactionCommand from "../contracts/generated/interaction-command.js";
import interactionPolicy from "../contracts/generated/interaction-policy.js";
import interactionRequest from "../contracts/generated/interaction-request.js";
import liveNotification from "../contracts/generated/live-notification.js";
import liveState from "../contracts/generated/live-state.js";
import controls from "../contracts/generated/session-controls.js";
import type { StrictStartState, SessionState } from "../contracts/generated/omp-wire.ts";
const frameSchema = z.object({ type: z.string() }).catchall(z.unknown());
export type SessionWorkerFrame = z.infer<typeof frameSchema>;
type Control = "abort_and_restore_queue" | "abort_branch_summary" | "abort_retry" | "abort_bash";

/** Combined fixed public RPC boundary. No prompt sender, browser RPC tunnel, executable selectors or private imports. */
export class SessionWorker {
  readonly startup: StrictStartClient;
  readonly history: HistoryClient;
  #retired = false;
  #notifications = 0;
  private constructor(private readonly core: BoundedStdioTransport, readonly frames: readonly SessionWorkerFrame[],
    private readonly subscribers: Set<(frame: SessionWorkerFrame) => void>, startTimeoutMs: number) {
    this.startup = new StrictStartClient(command => core.request(command,
      command.type === "strict_start" ? startTimeoutMs : undefined), (value): value is StrictStartState => strictState(value));
    this.history = new HistoryClient(command => core.request(command));
  }
  static async open(selection: ProcessSelection, options: { startTimeoutMs?: number } = {}): Promise<SessionWorker> {
    const buffered: SessionWorkerFrame[] = [], subscribers = new Set<(frame: SessionWorkerFrame) => void>();
    let bufferedBytes = 0, worker: SessionWorker | undefined;
    const publish = (value: object) => {
      const frame = frameSchema.parse(value);
      if (worker) ++worker.#notifications;
      if (subscribers.size === 0) {
        bufferedBytes += Buffer.byteLength(JSON.stringify(frame));
        if (buffered.length >= 32 || bufferedBytes > 262_144) throw new Error("SESSION_STARTUP_BUFFER_LIMIT");
        buffered.push(frame);
      }
      for (const subscriber of subscribers) subscriber(frame);
    };
    const core = await BoundedStdioTransport.open(selection, {
      validateCommand: value => strictCommand(value) || interactionCommand(value) || validateHistoryCommand(value) || controls(value),
      acceptReady: frame => {
        if (frame.protocolVersion !== 1 || frame.supportedProtocolVersions?.includes(2) !== true
          || frame.maxFrameBytes !== MAX_RPC_FRAME_BYTES || frame.maxReassembledFrameBytes !== MAX_RPC_REASSEMBLED_BYTES
          || frame.strictStartup !== "strict-start-v1" || !strictPolicy(frame.strictStartupPolicy)
          || !interactionPolicy(frame.interactionPolicy)) return false;
        publish(frame); return true;
      },
      remoteError: error => error && /^(?:(?:STRICT|GENERATION)_[A-Z_]+|history_[a-z_]+)$/.test(error)
        ? error : "RPC_NATIVE_REJECTED",
      physicalFrameBytes: MAX_RPC_FRAME_BYTES, allowChunks: true, commandBytes: 16_384,
      queuedBytes: 262_144, pendingLimit: 32, settledLimit: 256, stderrBytes: 65_536, defaultTimeoutMs: 10_000,
      notification: frame => {
        if (!interactionRequest(frame) && !liveNotification(frame)) return false;
        publish(frame); return true;
      },
    });
    worker = new SessionWorker(core, buffered, subscribers, options.startTimeoutMs ?? 30 * 60_000);
    return worker;
  }
  get exited(): Promise<number> { return this.core.exited; }
  get notificationCount(): number { return this.#notifications; }
  subscribe(listener: (frame: SessionWorkerFrame) => void): () => void {
    if (this.subscribers.size >= 64) throw new Error("SESSION_SUBSCRIBER_LIMIT");
    this.subscribers.add(listener); return () => this.subscribers.delete(listener);
  }
  /** InteractionBridge is the only caller; generated interaction schema enforces the family and payload. */
  async command(fields: object): Promise<unknown> {
    if (this.#retired) throw new Error("SESSION_WORKER_RETIRED");
    const command = { ...fields, id: crypto.randomUUID() };
    if (!interactionCommand(command) && !("type" in command && command.type === "abort" && controls(command))) {
      throw new Error("SESSION_INTERACTION_COMMAND_DENIED");
    }
    return this.core.request(z.object({ type: z.string(), id: z.string() }).passthrough().parse(command));
  }
  async state(): Promise<SessionState> {
    const value = await this.core.request({ type: "get_state", id: crypto.randomUUID() });
    if (!liveState(value)) throw new Error("SESSION_STATE_SCHEMA"); return value as SessionState;
  }
  control(type: Control): Promise<unknown> { return this.core.request({ type, id: crypto.randomUUID() }); }
  retireIdle(timeoutMs = 5000) { this.#retired = true; return this.core.closeGracefully(timeoutMs); }
  close(policy: DrainPolicy) { this.#retired = true; return this.core.close(policy); }
}
