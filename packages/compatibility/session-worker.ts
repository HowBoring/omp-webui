import { MAX_RPC_FRAME_BYTES, MAX_RPC_REASSEMBLED_BYTES } from "@oh-my-pi/pi-coding-agent/modes/rpc/rpc-frame";
import { z } from "zod";
import { nativeWorkerFailureCode } from "../contracts/session-errors.ts";
import { BoundedStdioTransport, attachOwnedStdio, OwnedRpcError, type ProcessSelection, type DrainPolicy, type StdioOutput,
  type StdioPolicy } from "./stdio-transport.ts";
import type { PrivateHelperHandle } from "../supervision/adapter.ts";
import { PrivateHelperError } from "../supervision/errors.ts";
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

type SessionOptions = { startTimeoutMs?: number };
type OwnedSessionOptions = SessionOptions & Pick<ProcessSelection, "timeoutMs" | "readyTimeoutMs" | "signal">;

class SessionNotifications {
  readonly frames: SessionWorkerFrame[] = [];
  readonly subscribers = new Set<(frame: SessionWorkerFrame) => void>();
  count = 0;
  #bufferedBytes = 0;

  publish(value: object): void {
    const frame = frameSchema.parse(value);
    ++this.count;
    if (this.subscribers.size === 0) {
      this.#bufferedBytes += Buffer.byteLength(JSON.stringify(frame));
      if (this.frames.length >= 32 || this.#bufferedBytes > 262_144) throw new Error("SESSION_STARTUP_BUFFER_LIMIT");
      this.frames.push(frame);
    }
    for (const subscriber of this.subscribers) subscriber(frame);
  }
}

function sessionPolicy(notifications: SessionNotifications): StdioPolicy {
  return {
    validateCommand: value => strictCommand(value) || interactionCommand(value) || validateHistoryCommand(value) || controls(value),
    acceptReady: frame => {
      if (frame.protocolVersion !== 1 || frame.supportedProtocolVersions?.includes(2) !== true
        || frame.maxFrameBytes !== MAX_RPC_FRAME_BYTES || frame.maxReassembledFrameBytes !== MAX_RPC_REASSEMBLED_BYTES
        || frame.strictStartup !== "strict-start-v1" || !strictPolicy(frame.strictStartupPolicy)
        || !interactionPolicy(frame.interactionPolicy)) return false;
      notifications.publish(frame);
      return true;
    },
    remoteError: nativeWorkerFailureCode,
    physicalFrameBytes: MAX_RPC_FRAME_BYTES, allowChunks: true, commandBytes: 16_384,
    queuedBytes: 262_144, pendingLimit: 32, settledLimit: 256, stderrBytes: 65_536, defaultTimeoutMs: 10_000,
    notification: (frame, publish) => {
      if (!interactionRequest(frame) && !liveNotification(frame)) return false;
      if (publish) notifications.publish(frame);
      return true;
    },
  };
}

/** Fixed public Session RPC operations shared across the two construction paths. */
class SessionRpc {
  readonly startup: StrictStartClient;
  readonly history: HistoryClient;
  readonly frames: readonly SessionWorkerFrame[];
  #retired = false;
  readonly #initialCount: number;

  constructor(private readonly core: Pick<BoundedStdioTransport, "request">,
    private readonly notifications: SessionNotifications, options: SessionOptions) {
    const startTimeoutMs = options.startTimeoutMs ?? 30 * 60_000;
    this.frames = notifications.frames;
    this.#initialCount = notifications.count;
    this.startup = new StrictStartClient(command => core.request(command,
      command.type === "strict_start" ? startTimeoutMs : undefined), (value): value is StrictStartState => strictState(value));
    this.history = new HistoryClient(command => core.request(command));
  }

  get notificationCount(): number { return this.notifications.count - this.#initialCount; }
  subscribe(listener: (frame: SessionWorkerFrame) => void): () => void {
    const subscribers = this.notifications.subscribers;
    if (subscribers.size >= 64) throw new Error("SESSION_SUBSCRIBER_LIMIT");
    subscribers.add(listener); return () => subscribers.delete(listener);
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
  protected retire(): void { this.#retired = true; }
}

export interface OwnedSessionConnection {
  /** Resolves after helper HELLO and correlated public RPC negotiation. */
  readonly ready: Promise<SessionRpc>;
  readonly rootExit: PrivateHelperHandle["rootExit"];
  readonly completed: PrivateHelperHandle["completed"];
  /** Settles after the attached readers finish. A failed pipe attachment rejects this observation. */
  readonly output: Promise<StdioOutput>;
}

/** Combined fixed public RPC boundary. No prompt sender, browser RPC tunnel, executable selectors or private imports. */
export class SessionWorker extends SessionRpc {
  private constructor(private readonly transport: BoundedStdioTransport, notifications: SessionNotifications,
    options: SessionOptions) {
    super(transport, notifications, options);
  }

  static async open(selection: ProcessSelection, options: SessionOptions = {}): Promise<SessionWorker> {
    const notifications = new SessionNotifications();
    const transport = await BoundedStdioTransport.open(selection, sessionPolicy(notifications));
    return new SessionWorker(transport, notifications, options);
  }

  /** The caller retains the original helper and its cleanup authority, including when RPC startup rejects. */
  static attachOwned(helper: PrivateHelperHandle, options: OwnedSessionOptions = {}): OwnedSessionConnection {
    const { rootExit, completed } = helper;
    try {
      const notifications = new SessionNotifications();
      const transport = attachOwnedStdio(helper, options, sessionPolicy(notifications));
      const ready = transport.ready.then(core => new SessionRpc(core, notifications, options)).catch(error => {
        throw error instanceof OwnedRpcError || error instanceof PrivateHelperError
          ? error : new OwnedRpcError("RPC_STARTUP_FAILED");
      });
      void ready.catch(() => {});
      return { ready, rootExit, completed, output: transport.output };
    } catch (error) {
      const unavailable = Promise.reject<never>(error instanceof OwnedRpcError
        ? error : new OwnedRpcError("RPC_PIPE_ATTACH_FAILED"));
      void unavailable.catch(() => {});
      return { ready: unavailable, rootExit, completed, output: unavailable };
    }
  }

  get exited(): Promise<number> { return this.transport.exited; }
  retireIdle(timeoutMs = 5000) { this.retire(); return this.transport.closeGracefully(timeoutMs); }
  close(policy: DrainPolicy) { this.retire(); return this.transport.close(policy); }
}
