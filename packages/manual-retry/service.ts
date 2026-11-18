import { randomUUID } from "node:crypto";
import type { SubmissionClientCommand } from "../contracts/candidates/durable-submission-v1/submission-client.ts";
import type { SubmissionResult, SubmissionTarget } from "../contracts/candidates/durable-submission-v1/omp-wire.ts";
import validateLiveNotification from "../contracts/generated/live-notification.js";
import type { PromptResultEvent } from "../contracts/generated/omp-wire.ts";
import { requestLocalSubmission, submissionBusy as nativeBusy } from "../contracts/submission-reply.ts";
import type { StopSnapshot } from "../contracts/stop.ts";
import { ReceiptLookup, validateSubmitReceipt } from "./native-results.ts";

const confirmationMs = 30_000;
const notice = "Retry the last failed turn? OMP may run tools again and repeat their side effects. Earlier effects can remain.";

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
}
/** Trusted Host ports for the matched candidate. Never expose the transport callback to a browser. */
export interface ManualRetryHost {
  /** Recheck the exact view, browser credential, grant, directory, worker and current native context synchronously. */
  authorize(view: RetryView): Access | undefined;
  /** Joint Stop state from the current supervised worker, including when no Browser View is attached. */
  stop(): StopSnapshot | undefined;
  /** Return the public response envelope from this exact worker, including the Native error code when present. */
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
  readonly stopGeneration: string;
  readonly receiptLookup: ReceiptLookup;
  status: Result["status"];
  reason?: Result["reason"];
  reading: boolean;
  settled: boolean;
  nativeSettled: boolean;
  liveResult?: Pick<PromptResultEvent, "status" | "agentInvoked">;
  receiptInvoked: boolean;
  conflict: boolean;
}
const outcomeFor = (event: NonNullable<Attempt["liveResult"]>): Outcome =>
  event.status === "completed" ? "succeeded" : event.status === "aborted" ? "cancelled" : "failed";
const completedLocally = (event: NonNullable<Attempt["liveResult"]>): boolean =>
  event.status === "completed" && !event.agentInvoked;
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

    const attempt: Attempt = { requestId, stopGeneration: saved.stopGeneration, receiptLookup: new ReceiptLookup(),
      status: "unknown",
      reading: true, settled: false,
      nativeSettled: false, receiptInvoked: false, conflict: false };
    this.#attempt = attempt;
    try {
      const reply = await this.#request({ type: "submission_submit", id: requestId, clientSubmissionId: requestId,
        ...this.#worker.target, preparationId: `manual-retry-v1:${requestId}`,
        inputType: "prompt", idleOnly: true, message: "/retry" });
      if (reply === nativeBusy) attempt.reason = "native_busy";
      else {
        const facts = validateSubmitReceipt(reply);
        this.#acceptReceipt(attempt, facts?.receipt, facts?.invoked ?? false, true);
      }
    } catch { /* A possibly delivered request stays unknown, including rejected submissions with effects. */ }
    finally { attempt.reading = false; this.#reconcile(attempt); }
    return this.#result(view, attempt, saved.authority);
  }

  /** Read-only recovery of this worker's issued request. Native absence cannot authorize a new send. */
  async lookup(view: RetryView, requestId: string): Promise<Result | Refusal> {
    const access = this.#authorize(view);
    if (!access) return { status: "refused", reason: "forbidden" };
    const attempt = this.#attempt;
    if (!attempt || attempt.requestId !== requestId) return { status: "refused", reason: "unavailable" };
    this.#reconcile(attempt);
    if (!attempt.reading && !attempt.conflict && !terminal(attempt.status)) {
      const current = () => {
        const renewed = this.#authorize(view);
        return this.#attempt === attempt && renewed?.authority === access.authority
          && renewed.stop.generation === attempt.stopGeneration;
      };
      attempt.reading = true;
      try {
        const facts = await attempt.receiptLookup.read(requestId, async command => {
          const reply = await this.#request(command);
          if (reply !== nativeBusy) return reply;
        }, current);
        if (current()) this.#acceptReceipt(attempt, facts?.receipt, facts?.invoked ?? false, false);
      } catch {
        if (current()) attempt.status = "unknown";
      }
      finally { attempt.reading = false; this.#reconcile(attempt); }
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
  blocksAdmission(): boolean {
    const attempt = this.#attempt;
    if (!attempt) return false;
    this.#reconcile(attempt);
    return !attempt.settled;
  }

  /** Feed schema-validated public notifications from the original transport before publishing them to Views. */
  observe(workerGeneration: string, frame: unknown): void {
    const attempt = this.#attempt;
    if (!attempt || workerGeneration !== this.#worker.workerGeneration ||
      !validateLiveNotification(frame) || !frame || typeof frame !== "object" || !("type" in frame)) return;
    if (frame.type === "session_settled") {
      if (attempt.liveResult || terminal(attempt.status)) attempt.nativeSettled = true;
    } else if (frame.type === "prompt_result") {
      const next = frame as PromptResultEvent;
      if (next.id !== attempt.requestId) return;
      const previous = attempt.liveResult;
      if ((previous && (previous.status !== next.status || previous.agentInvoked !== next.agentInvoked))
        || (terminal(attempt.status) && attempt.status !== outcomeFor(next))
        || (attempt.receiptInvoked && completedLocally(next))) this.#recordConflict(attempt);
      attempt.liveResult = { status: next.status, agentInvoked: next.agentInvoked };
      attempt.nativeSettled ||= next.sessionSettled;
    }
    this.#reconcile(attempt);
  }

  #result(view: RetryView, attempt: Attempt, authority: AbortSignal): Result | Refusal {
    const access = this.#authorize(view);
    if (!access || access.authority !== authority || access.stop.generation !== attempt.stopGeneration) {
      return { status: "refused", reason: "forbidden" };
    }
    return { status: attempt.status, requestId: attempt.requestId, settled: attempt.settled,
      ...(attempt.reason ? { reason: attempt.reason } : {}) };
  }

  #reconcile(attempt: Attempt): void {
    if (attempt.settled || attempt.reading || attempt.conflict || !attempt.nativeSettled) return;
    // A committed admission and the exact live result can prove quiescence before the terminal receipt is published.
    if (!terminal(attempt.status) && (attempt.status !== "admitted" || !attempt.liveResult?.agentInvoked)) return;
    const stop = this.#currentStop();
    if (stop?.generation === attempt.stopGeneration && this.#idle(stop)) attempt.settled = true;
  }

  #acceptReceipt(attempt: Attempt, receipt: SubmissionResult | undefined, consumed: boolean, submitReply: boolean): void {
    attempt.status = "unknown";
    if (!receipt || attempt.conflict || receipt.inputOutcome === "generated" ||
      receipt.persistence === "failed" || receipt.persistence === "unknown") return;
    if (submitReply && receipt.duplicate) {
      this.#recordConflict(attempt);
      return;
    }
    if (!receipt.terminal || (submitReply && receipt.nextOffset !== null)) {
      attempt.status = "admitted";
      return;
    }
    if (receipt.persistence !== "committed" || receipt.inputOutcome !== "no_input"
      || receipt.operationOutcome === "unknown") return;
    const result = attempt.liveResult;
    if (result && (outcomeFor(result) !== receipt.operationOutcome || (consumed && completedLocally(result)))) {
      this.#recordConflict(attempt);
      return;
    }
    if (receipt.operationOutcome === "succeeded" && !consumed && !result?.agentInvoked) return;
    attempt.receiptInvoked ||= consumed;
    attempt.status = receipt.operationOutcome;
    if (submitReply && attempt.status === "failed" && !result && !consumed) {
      // A successful response envelope carrying a durably failed local builtin has no later prompt_result.
      attempt.reason = "native_refused";
      attempt.nativeSettled = true;
    }
  }

  #recordConflict(attempt: Attempt): void {
    attempt.conflict = true;
    attempt.status = "unknown";
    attempt.settled = false;
  }

  #authorize(view: RetryView): (Access & { readonly stop: StopSnapshot }) | undefined {
    try {
      const access = this.host?.authorize(view);
      const stop = this.#currentStop();
      if (access && !access.authority.aborted && access.contextRevision && stop) return { ...access, stop };
    } catch { /* Missing current authority fails closed. */ }
  }

  #currentStop(): StopSnapshot | undefined {
    try {
      const stop = this.host?.stop();
      if (stop?.workerGeneration === this.#worker.workerGeneration && stop.scope.kind === "session"
        && stop.scope.sessionId === this.#worker.sessionId && stop.status !== "forbidden") return stop;
    } catch { /* Missing worker authority fails closed. */ }
  }

  #idle(state: StopSnapshot): boolean {
    return state.status === "idle" && state.nativeSettled && state.acceptingWork && state.failures.length === 0
      && Object.values(state.pending).every(count => count === 0);
  }

  #now(): number { return this.host?.now?.() ?? performance.now(); }

  async #request(command: SubmissionClientCommand): Promise<SubmissionResult | typeof nativeBusy | undefined> {
    const host = this.host;
    if (!host) return;
    return requestLocalSubmission(this.#worker.target, command, value => host.request(value));
  }
}
