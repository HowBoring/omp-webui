import { createHash } from "node:crypto";
import { setTimeout as wait } from "node:timers/promises";
import type { PeerScope } from "@deepseek-ai/dsh-typert-protocol";
import { parseProjectionBinding, sameProjection } from "@deepseek-ai/dsh-api-session-controller/projection";
import type { SessionProjectionBinding, SessionPromptRequest } from "@deepseek-ai/dsh-api-session-controller/types";
import type { SubmissionClientCommand } from "../contracts/candidates/durable-submission-v1/submission-client.ts";
import type { SubmissionOrigin, SubmissionTarget } from "../contracts/candidates/durable-submission-v1/omp-wire.ts";
import type { SessionState, PromptResultEvent } from "../contracts/generated/omp-wire.ts";
import liveNotification from "../contracts/generated/live-notification.js";
import { chatRequestId, chatSessionId, type ChatRecovery, type ChatState } from "../contracts/chat.ts";
import { stopSnapshotSchema } from "../contracts/stop.ts";
import { inspectSubmissionPage, requestLocalSubmission, sameSubmissionTarget,
  submissionConflict } from "../contracts/submission-reply.ts";
import { readChatReceipt, receiptFacts, type ChatReceipt } from "./receipt.ts";

interface View {
  /** Stable and isolated Host-issued identity for browser, tab and draft. Peers are disposable. */
  readonly owner: string;
  /** Synchronously revoked when View credential, grant, cwd or worker authority changes. */
  readonly lifetime: AbortSignal;
  readonly projection: SessionProjectionBinding;
}

/** The authenticated carrier supplies the invocation-specific View capability. */
export interface ChatCaller {
  readonly peer: PeerScope;
  readonly view: object;
}

/** The supervised worker owner supplies each port and verifies the candidate cohort independently. */
export interface ChatWorkerPort {
  readonly sessionId: string;
  readonly generation: string;
  readonly target: SubmissionTarget;
  readonly lifetime: AbortSignal;
  readonly matchedCohort: string;
  authorize(caller: ChatCaller, sessionId: string): View | undefined;
  stop(): unknown;
  /** Current public get_state reply, already validated at the worker boundary. */
  state(): Promise<Partial<SessionState>>;
  /** Bounded public JSONL v2 transport; rejects on protocol failure, timeout or EOF. */
  request(command: SubmissionClientCommand): Promise<unknown>;
}

interface Attempt {
  readonly id: string;
  readonly owner: string;
  readonly projection: SessionProjectionBinding;
  readonly fingerprint: string;
  phase: "checking" | "refused" | "dispatching" | "admitted" | "unknown" | "conflict";
  settled: boolean;
  receipt?: ChatReceipt;
  result?: NonNullable<NonNullable<ChatState>["result"]>;
}

export class ChatError extends Error {
  constructor(readonly code: "invalid" | "authority" | "busy" | "conflict" | "limit" | "unknown") {
    super(`chat_${code}`);
  }
}

const unknown = { outcome: "unknown" } as const;
const limit = 1024;
const waitAttempts = 40;

function isNativeIdle(state: Partial<SessionState>, nativeSessionId: string): boolean {
  return state.sessionId === nativeSessionId && state.isSettled === true && state.isStreaming === false && state.isCompacting === false
    && state.hasPendingAsyncWork === false && state.queuedMessageCount === 0
    && state.queuedMessages?.steering.length === 0 && state.queuedMessages.followUp.length === 0;
}

/** One unregistered manual Chat Gateway per worker, retained independently of Browser Views. */
export class ChatGateway {
  readonly #attempts = new Map<string, Attempt>();
  readonly #target: SubmissionTarget;
  readonly #sessionId: string;
  readonly #generation: string;
  readonly #lifetime: AbortSignal;
  readonly #cohort: string;
  #latest: Attempt | undefined;
  #reconciling = false;

  constructor(private readonly port: ChatWorkerPort) {
    this.#target = Object.freeze({ ...port.target });
    this.#sessionId = chatSessionId.parse(port.sessionId);
    this.#generation = port.generation;
    this.#lifetime = port.lifetime;
    this.#cohort = port.matchedCohort;
  }

  #workerCurrent(): boolean {
    return !this.#lifetime.aborted && this.#cohort.length > 0 && this.#cohort.length <= 512
      && this.port.matchedCohort === this.#cohort && this.port.generation === this.#generation
      && this.port.sessionId === this.#sessionId && this.port.lifetime === this.#lifetime
      && sameSubmissionTarget(this.port.target, this.#target);
  }

  /** A future shared admission gate must consult this for other input and history work. */
  get blocksAdmission(): boolean {
    const attempt = this.#latest;
    return !this.#workerCurrent() || !!attempt && attempt.phase !== "conflict" && !attempt.settled;
  }

  #view(caller: ChatCaller, sessionId: string): View {
    if (!this.#workerCurrent() || caller.peer.signal.aborted || sessionId !== this.#sessionId) {
      throw new ChatError("authority");
    }
    const view = this.port.authorize(caller, sessionId);
    if (!view || view.lifetime.aborted || !view.owner || view.owner.length > 4096) throw new ChatError("authority");
    return { owner: view.owner, lifetime: view.lifetime, projection: parseProjectionBinding(view.projection) };
  }

  #current(caller: ChatCaller, sessionId: string, signal: AbortSignal) {
    const invocation = { peer: caller.peer, view: caller.view };
    const saved = this.#view(invocation, sessionId);
    const current = () => {
      const view = this.#view(invocation, sessionId);
      if (signal.aborted || view.lifetime !== saved.lifetime || view.owner !== saved.owner
        || !sameProjection(view.projection, saved.projection)) throw new ChatError("authority");
    };
    current();
    return { saved, current };
  }

  #idle(): boolean {
    const checked = stopSnapshotSchema.safeParse(this.port.stop());
    if (!checked.success) return false;
    const state = checked.data;
    return state.workerGeneration === this.#generation && state.scope.kind === "session"
      && state.scope.sessionId === this.#sessionId && state.status === "idle" && state.nativeSettled
      && state.acceptingWork && state.failures.length === 0 && Object.values(state.pending).every(count => count === 0);
  }

  async prompt(caller: ChatCaller, request: SessionPromptRequest, signal: AbortSignal) {
    const { sessionId, mode, content } = request;
    const id = chatRequestId.safeParse(request.requestId);
    if (!id.success || (mode !== "queue" && mode !== "steer") || !Array.isArray(content)
      || content.some(part => !part || part.type !== "text" || typeof part.text !== "string")) {
      throw new ChatError("invalid");
    }
    const text = content.map(part => part.type === "text" ? part.text : "").join("");
    if (!text.trim() || Buffer.byteLength(text) > 262_144) throw new ChatError("invalid");
    const { saved, current } = this.#current(caller, sessionId, signal);
    if (!sameProjection(request.projection, saved.projection)) throw new ChatError("authority");
    const fingerprint = createHash("sha256").update(JSON.stringify([mode, text])).digest("hex");
    const active = this.#latest;
    if (!this.#attempts.has(id.data) && active?.phase === "admitted" && !active.settled) {
      await this.#reconcile(() => this.#refresh(active, current));
      current();
    }
    const previous = this.#attempts.get(id.data);
    if (previous) {
      if (previous.owner !== saved.owner || previous.fingerprint !== fingerprint
        || !sameProjection(previous.projection, saved.projection)) throw new ChatError("conflict");
      if (previous.phase === "checking" || previous.phase === "refused") throw new ChatError("busy");
      if (previous.phase === "conflict") throw new ChatError("conflict");
      return this.#accept(previous, current, signal);
    }
    if (this.#attempts.size >= limit) throw new ChatError("limit");
    const busy = this.blocksAdmission;
    const attempt: Attempt = { id: id.data, owner: saved.owner, projection: saved.projection, fingerprint,
      phase: busy ? "refused" : "checking", settled: false };
    this.#attempts.set(attempt.id, attempt);
    if (busy) throw new ChatError("busy");
    this.#latest = attempt;
    await this.#dispatch(attempt, text, current);
    return this.#accept(attempt, current, signal);
  }

  async #dispatch(attempt: Attempt, text: string, current: () => void): Promise<void> {
    try {
      const native = await this.port.state();
      current();
      if (!isNativeIdle(native, this.#target.nativeSessionId) || !this.#idle()) throw new ChatError("busy");
      current();
    } catch (error) {
      // Native submission has never been called for this request, and this key can never dispatch again.
      attempt.phase = "refused";
      attempt.settled = true;
      throw error instanceof ChatError ? error : new ChatError("unknown");
    }
    attempt.phase = "dispatching";
    try {
      const reply = await this.#request({ type: "submission_submit", id: attempt.id, ...this.#target,
        clientSubmissionId: attempt.id, preparationId: `text-v1:${attempt.id}`, inputType: "prompt",
        idleOnly: true, message: text });
      if (reply === submissionConflict) throw new ChatError("conflict");
      if (typeof reply !== "object" || reply.duplicate) throw new ChatError("unknown");
      const facts = inspectSubmissionPage(reply, 0, 64, new Set());
      if (!facts) throw new ChatError("unknown");
      this.#record(attempt, receiptFacts(reply, facts.invoked));
      attempt.phase = "admitted";
    } catch (error) {
      attempt.phase = error instanceof ChatError && error.code === "conflict" ? "conflict" : "unknown";
      delete attempt.result;
      current();
      throw new ChatError(attempt.phase);
    }
    current();
  }

  #request(command: SubmissionClientCommand) {
    return requestLocalSubmission(this.#target, command, value => this.port.request(value));
  }

  #record(attempt: Attempt, receipt: ChatReceipt): boolean {
    const previous = attempt.receipt;
    if ((receipt.committedInput && (receipt.invoked || previous?.invoked))
      || (previous?.committedInput && (receipt.inputOutcome === "no_input" || receipt.invoked))
      || (previous?.completeNoInput && receipt.inputOutcome === "generated")
      || (receipt.completeNoInput && previous?.invoked && !receipt.invoked)
      || (previous?.completeNoInput && !previous.invoked && receipt.invoked)) return false;
    if (previous?.terminal && (previous.terminal !== receipt.terminal
      || previous.inputOutcome !== receipt.inputOutcome || previous.operationOutcome !== receipt.operationOutcome
      || previous.persistence !== receipt.persistence)) return false;
    attempt.receipt = { ...receipt, committedInput: receipt.committedInput || previous?.committedInput === true,
      completeNoInput: receipt.completeNoInput || previous?.completeNoInput === true,
      invoked: receipt.invoked || previous?.invoked === true };
    return true;
  }

  #query(attempt: Attempt, current: () => void) {
    return readChatReceipt(attempt.id, current, command => this.#request(command));
  }

  async #accept(attempt: Attempt, current: () => void, signal: AbortSignal) {
    if (attempt.phase === "admitted") {
      const accepted = await this.#reconcile(() => this.#pollAcceptance(attempt, current, signal));
      current();
      if (accepted) return accepted;
    }
    throw new ChatError("unknown");
  }

  async #pollAcceptance(attempt: Attempt, current: () => void, signal: AbortSignal) {
    for (let i = 0; i < waitAttempts; ++i) {
      const outcome = await this.#recover(attempt, current);
      if (!outcome) break;
      if (outcome.outcome === "accepted") return { accepted: true as const };
      if (outcome.outcome === "completed-without-input") return { accepted: true as const, noInput: outcome.noInput };
      if (!attempt.receipt || attempt.receipt.terminal) break;
      await wait(100, undefined, { signal }).catch(() => { throw new ChatError("authority"); });
      current();
    }
  }

  async lookup(caller: ChatCaller, sessionId: string, requestId: string, signal: AbortSignal): Promise<ChatRecovery> {
    const { saved, current } = this.#current(caller, sessionId, signal);
    const attempt = this.#attempts.get(chatRequestId.parse(requestId));
    if (!attempt || attempt.owner !== saved.owner) return unknown;
    if (attempt.phase === "refused") return { outcome: "not-submitted" };
    if (attempt.phase !== "admitted") return unknown;
    const recovered = await this.#reconcile(() => this.#recover(attempt, current));
    current();
    return recovered ?? unknown;
  }

  async #recover(attempt: Attempt, current: () => void): Promise<ChatRecovery | undefined> {
    const receipt = await this.#query(attempt, current);
    if (!receipt || !this.#record(attempt, receipt)) return;
    if (receipt.committedInput) return { outcome: "accepted" };
    if (!receipt.completeNoInput || receipt.operationOutcome !== "succeeded") return unknown;
    if (receipt.invoked && !await this.#settle(attempt, receipt, current)) return unknown;
    return { outcome: "completed-without-input", noInput: { requestId: attempt.id, projection: attempt.projection } };
  }

  /** Only this worker's validated request ID can label an observed Native history entry. */
  requestForOrigin(origin: SubmissionOrigin, role: string): string | undefined {
    const attempt = this.#attempts.get(origin.clientSubmissionId);
    if (role === "input" && this.#workerCurrent() && sameSubmissionTarget(origin, this.#target)
      && attempt?.phase === "admitted") return attempt.id;
  }

  /** Feed the already framed public notifications from the same supervised worker. */
  observe(frame: unknown): void {
    if (!this.#workerCurrent() || !liveNotification(frame) || typeof frame !== "object" || frame === null
      || !("type" in frame) || frame.type !== "prompt_result") return;
    const { id, agentInvoked, status, sessionSettled } = frame as PromptResultEvent;
    const attempt = this.#latest;
    if (!attempt || id !== attempt.id || (attempt.phase !== "dispatching" && attempt.phase !== "admitted")) return;
    // An early frame stays private until the same dispatch has a verified nonduplicate acknowledgement.
    attempt.result ??= { agentInvoked, status, sessionSettled };
  }

  async state(caller: ChatCaller, sessionId: string, signal: AbortSignal): Promise<ChatState> {
    const { current } = this.#current(caller, sessionId, signal);
    const attempt = this.#latest;
    if (!attempt || attempt.phase === "refused" || attempt.phase === "checking") return;
    if (!attempt.settled && attempt.phase === "admitted") {
      await this.#reconcile(() => this.#refresh(attempt, current));
    }
    current();
    if (attempt !== this.#latest) throw new ChatError("authority");
    const { phase, receipt, result, settled } = attempt;
    return { requestId: attempt.id, phase: phase === "conflict" ? "unknown" : phase, settled, ...(receipt ? { terminal: receipt.terminal,
      persistence: receipt.persistence, operationOutcome: receipt.operationOutcome,
      inputOutcome: receipt.inputOutcome } : {}),
      ...(phase === "admitted" && result ? { result: { ...result } } : {}) };
  }

  async #reconcile<T>(read: () => Promise<T>): Promise<T | undefined> {
    if (this.#reconciling) return;
    this.#reconciling = true;
    try { return await read(); }
    finally { this.#reconciling = false; }
  }

  async #refresh(attempt: Attempt, current: () => void): Promise<void> {
    const receipt = await this.#query(attempt, current);
    if (receipt && this.#record(attempt, receipt)) await this.#settle(attempt, receipt, current);
  }

  async #settle(attempt: Attempt, receipt: ChatReceipt, current: () => void): Promise<boolean> {
    if (attempt.settled) return true;
    if (!receipt.terminal || receipt.persistence !== "committed" || receipt.operationOutcome === "unknown") return false;
    const result = attempt.result;
    const expected = { completed: "succeeded", error: "failed", aborted: "cancelled" } as const;
    const local = receipt.completeNoInput && !receipt.invoked && !result;
    if (!local && (!result || expected[result.status] !== receipt.operationOutcome
      || (receipt.invoked && !result.agentInvoked))) return false;
    const state = await this.port.state().catch(() => undefined);
    current();
    if (attempt === this.#latest && state && isNativeIdle(state, this.#target.nativeSessionId) && this.#idle()) {
      current();
      attempt.settled = true;
    }
    return attempt.settled;
  }
}
