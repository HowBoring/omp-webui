/** Exact-content gate inside the existing typed DSH Session prompt Remote, before native admission. */
import type { AttachmentBridge } from "./bridge.ts";
import type { AttachmentConsentRequest, AttachmentAttempt, AttachmentGatePhase, AttachmentGateStatus } from "../contracts/attachment-remote.ts";
export type { AttachmentAttempt, AttachmentGatePhase, AttachmentGateStatus } from "../contracts/attachment-remote.ts";
import type { AttachmentReceipt } from "../contracts/attachments.ts";
import { isSubmissionResult } from "../contracts/submissions.ts";
import type { SubmissionResult } from "../contracts/submissions.ts";

interface Flow {
  attempt: AttachmentAttempt; preparationId: string; abort: AbortController; phase: AttachmentGatePhase;
  nativeStarted: boolean; message?: string; receipt?: AttachmentReceipt; code?: string; result?: SubmissionResult;
  consent: PromiseWithResolvers<string>; operation?: Promise<SubmissionResult>;
}
const codeOf = (error: unknown): string => error instanceof Error && /^(?:ATTACHMENT|SUBMISSION|STRICT)_[A-Z_]+$/.test(error.message)
  ? error.message : "ATTACHMENT_SEND_FAILED";

/** Authorizes an existing attempt independently of a newer editable draft; never grants bytes or a new submission. */
export type AuthorizeAttachmentAttempt = (attempt: AttachmentAttempt) => Promise<void>;
export class AttachmentSubmissionGate {
  readonly #flows = new Map<string, Flow>();
  constructor(readonly bridge: AttachmentBridge, readonly authorizeAttempt: AuthorizeAttachmentAttempt) {}

  /** Awaited by public semantic provider.beforeDispatch after its local checkpoint, before the Session Remote call. */
  async begin(attempt: AttachmentAttempt): Promise<{ registered: true }> {
    await this.authorizeAttempt(attempt);
    const prior = this.#flows.get(attempt.requestId);
    if (prior) {
      if (JSON.stringify(prior.attempt) !== JSON.stringify(attempt)) throw Error("ATTACHMENT_REQUEST_CONFLICT");
      return { registered: true };
    }
    if (this.#flows.size >= 2) throw Error("ATTACHMENT_ATTEMPT_LIMIT");
    const consent = Promise.withResolvers<string>(); void consent.promise.catch(() => {});
    this.#flows.set(attempt.requestId, { attempt: structuredClone(attempt), preparationId: crypto.randomUUID(),
      abort: new AbortController(), phase: "registered", nativeStarted: false, consent });
    return { registered: true };
  }

  /** The trusted existing Session Remote handler supplies its actual serialized text, once, for this exact request. */
  async submit(requestId: string, exactMessage: string, signal: AbortSignal): Promise<SubmissionResult> {
    const flow = this.#flow(requestId); await this.authorizeAttempt(flow.attempt);
    if (flow.message !== undefined && flow.message !== exactMessage) throw Error("ATTACHMENT_REQUEST_CONFLICT");
    if (flow.operation) return flow.operation;
    if (flow.abort.signal.aborted || signal.aborted) { await this.#cancel(flow); throw Error("ATTACHMENT_CANCELLED"); }
    flow.message = exactMessage;
    const abort = () => { void this.#cancel(flow); };
    signal.addEventListener("abort", abort, { once: true });
    flow.operation = this.#run(flow).finally(() => signal.removeEventListener("abort", abort));
    return flow.operation;
  }

  async status(requestId: string, knownDigest?: string): Promise<AttachmentGateStatus> {
    const flow = this.#flow(requestId); await this.authorizeAttempt(flow.attempt);
    return { phase: flow.phase, requestId, submissionId: flow.attempt.submissionId,
      nativeState: flow.result && this.#matchesReservation(flow, flow.result) ? "reserved" : flow.phase === "unresolved" ? "unresolved"
        : flow.nativeStarted ? "in-flight" : "not-dispatched",
      recovery: this.#recovery(flow),
      ...(flow.receipt && flow.receipt.resultDigest !== knownDigest ? { receipt: structuredClone(flow.receipt),
        ...(flow.message !== undefined ? { prompt: flow.message } : {}) } : {}),
      ...(flow.code ? { code: flow.code } : {}), ...(flow.result ? { result: flow.result } : {}) };
  }

  /** Explicit user acceptance continues this frozen Send attempt; it never creates or retries another one. */
  async consent(request: AttachmentConsentRequest & { requestId: string }): Promise<{ continuing: true }> {
    const flow = this.#flow(request.requestId); await this.authorizeAttempt(flow.attempt);
    if (flow.phase !== "awaiting-consent" || !flow.receipt || flow.abort.signal.aborted) throw Error("ATTACHMENT_CONSENT_STALE");
    if (JSON.stringify(request.selection) !== JSON.stringify(flow.attempt.selection)) throw Error("ATTACHMENT_DRAFT_CHANGED");
    const { requestId: _requestId, ...consent } = request;
    const accepted = await this.bridge.consent(consent);
    await this.authorizeAttempt(flow.attempt); flow.abort.signal.throwIfAborted();
    if (flow.phase !== "awaiting-consent") throw Error("ATTACHMENT_CONSENT_STALE");
    flow.consent.resolve(accepted.consentId);
    return { continuing: true };
  }

  async cancel(requestId: string): Promise<{ cancelled: boolean }> {
    const flow = this.#flow(requestId); await this.authorizeAttempt(flow.attempt);
    await this.#cancel(flow); return { cancelled: !flow.nativeStarted };
  }

  /** Feed only a result obtained from the same-source public native query. Absence never authorizes replay. */
  async observe(requestId: string, value: unknown): Promise<void> {
    const flow = this.#flow(requestId); await this.authorizeAttempt(flow.attempt);
    if (!isSubmissionResult(value) || value.clientSubmissionId !== flow.attempt.submissionId) throw Error("ATTACHMENT_NATIVE_RESULT_INVALID");
    flow.result = value;
    if (this.#matchesReservation(flow, value)) flow.phase = "submitted";
    else if (flow.nativeStarted) flow.phase = "unresolved";
  }

  /** Call after the provider durably resolves this exact DSH checkpoint; no Native work is retried. */
  async finish(requestId: string, outcome: "accepted" | "not-submitted"): Promise<{ finished: true }> {
    const flow = this.#flow(requestId); await this.authorizeAttempt(flow.attempt);
    if (this.#recovery(flow) !== outcome) throw Error("ATTACHMENT_OUTCOME_UNRESOLVED");
    this.#flows.delete(requestId); return { finished: true };
  }

  #matchesReservation(flow: Flow, value: SubmissionResult): boolean {
    const receipt = flow.receipt, origin = value.origin;
    return !!receipt && !!origin && value.found && value.reservation === "committed"
      && value.clientSubmissionId === flow.attempt.submissionId && origin.clientSubmissionId === flow.attempt.submissionId
      && value.target.sourceId === receipt.binding.sourceId && value.target.instanceId === receipt.binding.instanceId
      && value.target.nativeSessionId === receipt.binding.nativeSessionId && origin.sourceId === receipt.binding.sourceId
      && origin.instanceId === receipt.binding.instanceId && origin.nativeSessionId === receipt.binding.nativeSessionId
      && value.preparation?.receiptId === receipt.receiptId && value.preparation.resultDigest === receipt.resultDigest;
  }
  #recovery(flow: Flow): "accepted" | "not-submitted" | "unresolved" {
    if (!flow.nativeStarted && ["failed", "cancelled"].includes(flow.phase)) return "not-submitted";
    const result = flow.result;
    if (!result || !this.#matchesReservation(flow, result) || result.persistence !== "committed") return "unresolved";
    // inputOutcome describes input generation, never whether hooks/commands executed or a replay is safe.
    const committed = new Set(result.relations.filter(relation => relation.status === "observed" && relation.persistence === "committed")
      .flatMap(relation => relation.attachments?.map(link => link.preparedId) ?? []));
    return result.inputOutcome === "generated" && result.relations.some(relation => relation.role === "input" && relation.persistence === "committed")
      && flow.receipt!.items.every(item => item.status === "ready" && committed.has(item.preparedId)) ? "accepted" : "unresolved";
  }

  async #run(flow: Flow): Promise<SubmissionResult> {
    let timer: Timer | undefined;
    try {
      flow.phase = "preparing";
      flow.receipt = await this.bridge.prepare(flow.attempt.selection, flow.preparationId, flow.message!);
      flow.abort.signal.throwIfAborted(); await this.authorizeAttempt(flow.attempt);
      if (flow.receipt.status !== "ready") throw Error("ATTACHMENT_NOT_READY");
      flow.phase = "awaiting-consent";
      timer = setTimeout(() => { void this.#cancel(flow); }, Math.max(0, flow.receipt.expiresAt - Date.now()));
      const consentId = await flow.consent.promise;
      flow.abort.signal.throwIfAborted(); await this.authorizeAttempt(flow.attempt);
      await this.bridge.bind({ ...flow.attempt, consentId });
      flow.abort.signal.throwIfAborted(); await this.authorizeAttempt(flow.attempt);
      flow.phase = "submitting";
      const result = await this.bridge.submitForRequest(flow.attempt.requestId, () => { flow.nativeStarted = true; });
      if (!isSubmissionResult(result) || result.clientSubmissionId !== flow.attempt.submissionId) throw Error("ATTACHMENT_NATIVE_RESULT_INVALID");
      flow.result = result;
      flow.phase = this.#matchesReservation(flow, result) ? "submitted" : "unresolved";
      return result;
    } catch (error) {
      flow.code = flow.abort.signal.aborted ? "ATTACHMENT_CANCELLED" : codeOf(error);
      flow.phase = flow.nativeStarted ? "unresolved" : flow.abort.signal.aborted ? "cancelled" : "failed";
      if (!flow.nativeStarted) await this.bridge.discardUnsubmitted(flow.attempt.selection, flow.preparationId).catch(() => {});
      throw Error(flow.code);
    } finally { if (timer !== undefined) clearTimeout(timer); }
  }
  async #cancel(flow: Flow): Promise<void> {
    flow.abort.abort(); flow.consent.reject(Error("ATTACHMENT_CANCELLED"));
    flow.phase = flow.nativeStarted ? "unresolved" : "cancelled";
    if (!flow.nativeStarted) await this.bridge.discardUnsubmitted(flow.attempt.selection, flow.preparationId).catch(() => {});
  }
  #flow(id: string): Flow { const flow = this.#flows.get(id); if (!flow) throw Error("ATTACHMENT_ATTEMPT_UNKNOWN"); return flow; }
}
