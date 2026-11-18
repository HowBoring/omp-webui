import { randomUUID } from "node:crypto";
import validateCommand from "../contracts/candidates/durable-submission-v1/submission-command.js";
import validateResult from "../contracts/candidates/durable-submission-v1/submission-result.js";
import type { SubmissionClientCommand } from "../contracts/candidates/durable-submission-v1/submission-client.ts";
import type { SubmissionResult, SubmissionTarget } from "../contracts/candidates/durable-submission-v1/omp-wire.ts";
import validateLiveNotification from "../contracts/generated/live-notification.js";
import type { PromptResultEvent } from "../contracts/generated/omp-wire.ts";
import type { StopSnapshot } from "../contracts/stop.ts";

const confirmationMs = 30_000;
const notice = "Retry the last failed turn? OMP may run tools again and repeat their side effects. Earlier effects can remain.";
const matchesTarget = (a: SubmissionTarget, b: SubmissionTarget) =>
  a.sourceId === b.sourceId && a.instanceId === b.instanceId && a.nativeSessionId === b.nativeSessionId;

export interface RetryView {
  readonly clientId: string;
  readonly credentialId: string;
}
export interface ManualRetryWorker {
  readonly sessionId: string;
  readonly workerGeneration: string;
  readonly target: SubmissionTarget;
}
interface Access {
  readonly authority: AbortSignal;
  readonly contextRevision: string;
  readonly stop: StopSnapshot;
}
/** Trusted Host ports for the matched candidate. Never expose the transport callback to a browser. */
export interface ManualRetryHost {
  /** Recheck the exact view, browser credential, grant, directory, worker and current native context synchronously. */
  authorize(view: RetryView): Access | undefined;
  /** Validated, correlated public submission command/result transport for this exact worker. */
  request(command: SubmissionClientCommand): Promise<unknown>;
  now?(): number;
}
type Refusal = { status: "refused"; reason: "unavailable" | "forbidden" | "busy" | "stale_confirmation" };
type Offer = { status: "confirmation"; requestId: string; notice: string; expiresInMs: number };
type Outcome = "succeeded" | "failed" | "cancelled";
type Result = {
  status: "admitted" | "unknown" | Outcome;
  requestId: string;
  settled: boolean;
  reason?: "native_refused" | "native_busy";
};
interface Confirmation {
  requestId: string;
  expiry: number;
  authority: AbortSignal;
  contextRevision: string;
  stopGeneration: string;
}
interface Attempt {
  readonly requestId: string;
  status: Result["status"];
  reason?: Result["reason"];
  reading: boolean;
  settled: boolean;
  nativeSettled: boolean;
  liveResult?: PromptResultEvent;
  conflict: boolean;
}
const outcomeFor = (event: PromptResultEvent): Outcome =>
  event.status === "completed" ? "succeeded" : event.status === "aborted" ? "cancelled" : "failed";
const terminal = (status: Result["status"]): status is Outcome => status !== "admitted" && status !== "unknown";

/** SOURCE Host entry point for one supervised worker. All Browser Views share this instance. */
export class ManualRetry {
  readonly #worker: ManualRetryWorker;
  readonly #confirmations = new Map<RetryView, Confirmation>();
  #attempt: Attempt | undefined;

  constructor(worker: ManualRetryWorker, private readonly host?: ManualRetryHost) {
    this.#worker = Object.freeze({ ...worker, target: Object.freeze({ ...worker.target }) });
  }

  offer(view: RetryView): Offer | Refusal {
    if (!this.host) return { status: "refused", reason: "unavailable" };
    const access = this.#authorize(view);
    if (!access) return { status: "refused", reason: "forbidden" };
    if (this.blocksAdmission() || !this.#idle(access.stop)) {
      this.#confirmations.clear();
      return { status: "refused", reason: "busy" };
    }
    const now = this.#now();
    for (const [owner, saved] of this.#confirmations) {
      if (saved.authority.aborted || saved.expiry <= now) this.#confirmations.delete(owner);
    }
    if (this.#confirmations.size >= 64 && !this.#confirmations.has(view)) {
      return { status: "refused", reason: "unavailable" };
    }
    const requestId = randomUUID();
    this.#confirmations.set(view, { requestId, expiry: now + confirmationMs,
      authority: access.authority, contextRevision: access.contextRevision, stopGeneration: access.stop.generation });
    return { status: "confirmation", requestId, notice, expiresInMs: confirmationMs };
  }

  async confirm(view: RetryView, requestId: string): Promise<Result | Refusal> {
    const saved = this.#confirmations.get(view);
    if (!saved || saved.requestId !== requestId) return { status: "refused", reason: "stale_confirmation" };
    this.#confirmations.delete(view);
    const access = this.#authorize(view);
    if (!access) return { status: "refused", reason: "forbidden" };
    if (saved.expiry <= this.#now() || saved.authority !== access.authority
      || saved.contextRevision !== access.contextRevision || saved.stopGeneration !== access.stop.generation) {
      return { status: "refused", reason: "stale_confirmation" };
    }
    this.#confirmations.clear();
    if (this.blocksAdmission() || !this.#idle(access.stop)) return { status: "refused", reason: "busy" };

    const attempt: Attempt = { requestId, status: "unknown", reading: true, settled: false,
      nativeSettled: false, conflict: false };
    this.#attempt = attempt;
    try {
      const receipt = await this.#request({ type: "submission_submit", id: requestId, clientSubmissionId: requestId,
        ...this.#worker.target, preparationId: `manual-retry-v1:${requestId}`,
        inputType: "prompt", idleOnly: true, message: "/retry" });
      this.#acceptReceipt(attempt, receipt, true);
    } catch (error) {
      // The trusted transport only preserves this exact code for a correlated native response.
      if (error instanceof Error && error.message === "SUBMISSION_BUSY") attempt.reason = "native_busy";
      // A possibly delivered request stays unknown, including rejected submissions with effects.
    }
    finally { attempt.reading = false; }
    return this.#result(view, attempt, saved.authority);
  }

  /** Read-only recovery of this worker's issued request. Native absence cannot authorize a new send. */
  async lookup(view: RetryView, requestId: string): Promise<Result | Refusal> {
    const access = this.#authorize(view);
    if (!access) return { status: "refused", reason: "forbidden" };
    const attempt = this.#attempt;
    if (!attempt || attempt.requestId !== requestId) return { status: "refused", reason: "unavailable" };
    if (!attempt.reading && !terminal(attempt.status)) {
      attempt.reading = true;
      try {
        const receipt = await this.#request({ type: "submission_query", id: randomUUID(), clientSubmissionId: requestId,
          limit: 128 });
        this.#acceptReceipt(attempt, receipt, false);
      } catch { attempt.status = "unknown"; }
      finally { attempt.reading = false; }
    }
    return this.#result(view, attempt, access.authority);
  }

  cancel(view: RetryView, requestId: string): boolean {
    const saved = this.#confirmations.get(view);
    if (!saved || saved.requestId !== requestId) return false;
    this.#confirmations.delete(view);
    return this.#authorize(view)?.authority === saved.authority && saved.expiry > this.#now();
  }

  /** The shared Host admission gate must check this before admitting other fresh work. */
  blocksAdmission(): boolean { return this.#attempt !== undefined && !this.#attempt.settled; }

  /** Feed schema-validated public notifications from the original transport before publishing them to Views. */
  observe(workerGeneration: string, frame: unknown): void {
    const attempt = this.#attempt;
    if (!attempt || attempt.settled || workerGeneration !== this.#worker.workerGeneration ||
      !validateLiveNotification(frame) || !frame || typeof frame !== "object" || !("type" in frame)) return;
    if (frame.type === "session_settled") {
      if (attempt.liveResult || terminal(attempt.status)) attempt.nativeSettled = true;
    } else if (frame.type === "prompt_result") {
      const next = frame as PromptResultEvent;
      if (next.id !== attempt.requestId) return;
      const previous = attempt.liveResult;
      if ((previous && (previous.status !== next.status || previous.agentInvoked !== next.agentInvoked))
        || (terminal(attempt.status) && attempt.status !== outcomeFor(next))) {
        attempt.conflict = true;
        attempt.status = "unknown";
      }
      attempt.liveResult = structuredClone(next);
      attempt.nativeSettled ||= next.sessionSettled;
    }
  }

  #result(view: RetryView, attempt: Attempt, authority: AbortSignal): Result | Refusal {
    const access = this.#authorize(view);
    if (!access || access.authority !== authority) return { status: "refused", reason: "forbidden" };
    attempt.settled ||= !attempt.reading && terminal(attempt.status) && attempt.nativeSettled && this.#idle(access.stop);
    return { status: attempt.status, requestId: attempt.requestId, settled: attempt.settled,
      ...(attempt.reason ? { reason: attempt.reason } : {}) };
  }

  #acceptReceipt(attempt: Attempt, receipt: SubmissionResult | undefined, submitReply: boolean): void {
    attempt.status = "unknown";
    if (!receipt || attempt.conflict || receipt.inputOutcome === "generated" ||
      receipt.persistence === "failed" || receipt.persistence === "unknown") return;
    if (!receipt.terminal) {
      attempt.status = "admitted";
      return;
    }
    if (receipt.persistence !== "committed" || receipt.inputOutcome !== "no_input"
      || receipt.operationOutcome === "unknown") return;
    const result = attempt.liveResult;
    const consumed = receipt.relations.some(relation => relation.role === "input" &&
      relation.status === "no_entry" && relation.persistence === "committed" && relation.reason === "native_builtin_consumed");
    if (result && outcomeFor(result) !== receipt.operationOutcome) return;
    if (receipt.operationOutcome === "succeeded" && !consumed && !result?.agentInvoked) return;
    attempt.status = receipt.operationOutcome;
    if (submitReply && attempt.status === "failed" && !result && !consumed && receipt.nextOffset === null && !receipt.duplicate) {
      // A successful response envelope carrying a durably failed local builtin has no later prompt_result.
      attempt.reason = "native_refused";
      attempt.nativeSettled = true;
    }
  }

  #authorize(view: RetryView): Access | undefined {
    try {
      const access = this.host?.authorize(view);
      if (access && !access.authority.aborted && access.contextRevision
        && access.stop.workerGeneration === this.#worker.workerGeneration && access.stop.scope.kind === "session"
        && access.stop.scope.sessionId === this.#worker.sessionId && access.stop.status !== "forbidden") return access;
    } catch { /* Missing current authority fails closed. */ }
  }

  #idle(state: StopSnapshot): boolean {
    return state.status === "idle" && state.nativeSettled && state.acceptingWork && state.failures.length === 0
      && Object.values(state.pending).every(count => count === 0);
  }

  #now(): number { return this.host?.now?.() ?? performance.now(); }

  async #request(command: SubmissionClientCommand): Promise<SubmissionResult | undefined> {
    if (!this.host || !validateCommand(command)) return;
    const value = await this.host.request(command);
    if (!validateResult(value)) return;
    const result = value as SubmissionResult;
    if (result.found && result.admission === "local" && result.reservation === "committed" && result.origin
      && matchesTarget(result.target, this.#worker.target) && matchesTarget(result.origin, this.#worker.target)
      && result.clientSubmissionId === command.clientSubmissionId
      && result.origin.clientSubmissionId === command.clientSubmissionId) return result;
  }
}
