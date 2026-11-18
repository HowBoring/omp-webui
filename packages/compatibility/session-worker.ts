import { MAX_RPC_FRAME_BYTES, MAX_RPC_REASSEMBLED_BYTES } from "@oh-my-pi/pi-coding-agent/modes/rpc/rpc-frame";
import { z } from "zod";
import { InteractionBridge, type InteractionCleanupOutcome,
  type InteractionCleanupReply } from "../interactions/bridge.ts";
import { interactionReplySchema } from "../contracts/interactions.ts";
import { nativeWorkerFailureCode } from "../contracts/session-errors.ts";
import { BoundedStdioTransport, attachOwnedStdio, OwnedRpcError, type ProcessSelection, type DrainPolicy, type StdioOutput,
  type StdioCommand, type StdioPolicy } from "./stdio-transport.ts";
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
import type { StrictStartState, SessionState, RespondUiParams } from "../contracts/generated/omp-wire.ts";
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
  #retired = false;
  #interactionSubscriber: ((frame: SessionWorkerFrame) => void) | undefined;

  retire(): void { this.#retired = true; }

  /** Internal observation leaves the pre-subscriber replay buffer available to the Session caller. */
  observeInteractions(listener: (frame: SessionWorkerFrame) => void): () => void {
    this.#interactionSubscriber = listener;
    return () => { this.#interactionSubscriber = undefined; };
  }

  publish(value: object): void {
    if (this.#retired) return;
    const frame = frameSchema.parse(value);
    ++this.count;
    if (this.subscribers.size === 0) {
      this.#bufferedBytes += Buffer.byteLength(JSON.stringify(frame));
      if (this.frames.length >= 32 || this.#bufferedBytes > 262_144) throw new Error("SESSION_STARTUP_BUFFER_LIMIT");
      this.frames.push(frame);
    }
    this.#interactionSubscriber?.(frame);
    for (const subscriber of this.subscribers) {
      if (this.#retired) break;
      subscriber(frame);
    }
  }
}

function sessionPolicy(notifications: SessionNotifications): StdioPolicy {
  return {
    validateCommand: value => strictCommand(value) || interactionCommand(value) || validateHistoryCommand(value) || controls(value),
    acceptReady: (frame, publish) => {
      if (frame.protocolVersion !== 1 || frame.supportedProtocolVersions?.includes(2) !== true
        || frame.maxFrameBytes !== MAX_RPC_FRAME_BYTES || frame.maxReassembledFrameBytes !== MAX_RPC_REASSEMBLED_BYTES
        || frame.strictStartup !== "strict-start-v1" || !strictPolicy(frame.strictStartupPolicy)
        || !interactionPolicy(frame.interactionPolicy)) return false;
      if (publish) notifications.publish(frame);
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

type Request = (command: StdioCommand) => Promise<unknown>;

async function readSessionState(request: Request): Promise<SessionState> {
  const value = await request({ type: "get_state", id: crypto.randomUUID() });
  if (!liveState(value)) throw new Error("SESSION_STATE_SCHEMA");
  return value as SessionState;
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
  state(): Promise<SessionState> { return readSessionState(command => this.core.request(command)); }
  control(type: Control): Promise<unknown> { return this.core.request({ type, id: crypto.randomUUID() }); }
  protected retire(): void { this.#retired = true; }
}

/** Fixed Host operations on a retired, retained Session. Abort acknowledgements do not establish settlement. */
export interface OwnedSessionCleanup {
  cancelStrictStart(): Promise<StrictStartState>;
  abortAndRestoreQueue(): Promise<void>;
  abortBranchSummary(): Promise<void>;
  abortRetry(): Promise<void>;
  abortBash(): Promise<void>;
  state(): Promise<SessionState>;
}

function ownedCleanup(request: Request): OwnedSessionCleanup {
  const startup = new StrictStartClient(request, (value): value is StrictStartState => strictState(value));
  const abort = async (type: Control): Promise<void> => { await request({ type, id: crypto.randomUUID() }); };
  return Object.freeze({
    cancelStrictStart: () => startup.cancel(),
    abortAndRestoreQueue: () => abort("abort_and_restore_queue"),
    abortBranchSummary: () => abort("abort_branch_summary"),
    abortRetry: () => abort("abort_retry"),
    abortBash: () => abort("abort_bash"),
    state: () => readSessionState(request),
  });
}

const unsentCleanupErrors = new Set(["RPC_COMMAND_LIMIT", "RPC_COMMAND_SCHEMA", "RPC_DUPLICATE_ID", "RPC_PENDING_LIMIT"]);

async function cancelOwnedInteraction(request: Request, targetId: string): Promise<InteractionCleanupReply> {
  const command: StdioCommand & RespondUiParams = {
    id: crypto.randomUUID(), type: "respond_ui", targetId, answer: { type: "cancel" },
  };
  try {
    const reply = interactionReplySchema.safeParse(await request(command));
    if (reply.success && reply.data.status !== "answered") return reply.data;
    return { status: "unknown", reason: "cleanup-reply-invalid" };
  } catch (error) {
    if (!(error instanceof OwnedRpcError) || unsentCleanupErrors.has(error.code)) {
      return { status: "unknown", reason: "cleanup-request-failed" };
    }
    return { status: "unknown", reason: error.code === "RPC_CLEANUP_CLOSED" ? "cleanup-cutoff" : "cleanup-reply-lost" };
  }
}

export interface OwnedSessionConnection {
  /** Resolves after helper HELLO and correlated public RPC negotiation. */
  readonly ready: Promise<SessionRpc & {
    readonly interactions: Pick<InteractionBridge, "generation" | "snapshot" | "answer" | "bindSession">;
  }>;
  /** Settles after beginCleanup with the outcomes for UI tracked at its fence. Separate from exit and EOF. */
  readonly interactionCleanup: Promise<readonly InteractionCleanupOutcome[]>;
  /** Irreversibly fences regular work and future helper START submission.
   * Cleanup RPCs require authenticated v2 and an open transport.
   * The first cutoff is in the local performance.now() time domain, at most 30s away.
   * An invalid or expired cutoff leaves regular work fenced and grants no cleanup access. */
  beginCleanup(cutoff: number): OwnedSessionCleanup | undefined;
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
    const { control, rootExit, completed } = helper;
    const interactionCleanup = Promise.withResolvers<readonly InteractionCleanupOutcome[]>();
    try {
      const notifications = new SessionNotifications();
      const transport = attachOwnedStdio(helper, options, sessionPolicy(notifications));
      let interactions: InteractionBridge | undefined;
      let retireInteractions: ((bridge: InteractionBridge) => void) | undefined;
      const ready = transport.ready.then(core => {
        const session = new SessionRpc(core, notifications, options);
        const bridge = new InteractionBridge({
          frames: session.frames,
          subscribe: listener => notifications.observeInteractions(listener),
          command: command => session.command(command),
        });
        interactions = bridge;
        const dispose = () => bridge.dispose();
        void rootExit.then(dispose, dispose);
        retireInteractions?.(bridge);
        return Object.assign(session, { interactions: bridge });
      }).catch(error => {
        throw error instanceof OwnedRpcError || error instanceof PrivateHelperError
          ? error : new OwnedRpcError("RPC_STARTUP_FAILED");
      });
      void ready.catch(() => {});
      let cleanup: OwnedSessionCleanup | undefined;
      return {
        ready, rootExit, completed, output: transport.output, interactionCleanup: interactionCleanup.promise,
        beginCleanup: cutoff => {
          control.fenceStart();
          notifications.retire();
          const request = transport.beginCleanup(cutoff);
          if (!retireInteractions) {
            retireInteractions = bridge => interactionCleanup.resolve(
              bridge.retireForCleanup(request && (targetId => cancelOwnedInteraction(request, targetId))));
            if (interactions) retireInteractions(interactions);
            else void ready.catch(() => interactionCleanup.resolve([]));
          }
          if (request) return cleanup ??= ownedCleanup(request);
        },
      };
    } catch (error) {
      const unavailable = Promise.reject<never>(error instanceof OwnedRpcError
        ? error : new OwnedRpcError("RPC_PIPE_ATTACH_FAILED"));
      void unavailable.catch(() => {});
      return {
        ready: unavailable, rootExit, completed, output: unavailable, interactionCleanup: interactionCleanup.promise,
        beginCleanup: () => {
          control.fenceStart();
          interactionCleanup.resolve([]);
        },
      };
    }
  }

  get exited(): Promise<number> { return this.transport.exited; }
  retireIdle(timeoutMs = 5000) { this.retire(); return this.transport.closeGracefully(timeoutMs); }
  close(policy: DrainPolicy) { this.retire(); return this.transport.close(policy); }
}
