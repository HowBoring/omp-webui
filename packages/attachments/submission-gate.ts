/** Exact-content gate inside the existing typed DSH Session prompt Remote, before native admission. */
import type { AttachmentBridge } from "./bridge.ts";
import type { OriginalProtection } from "./store.ts";
import type { AttachmentConsentRequest, AttachmentAttempt, AttachmentFinishOutcome, AttachmentGatePending,
  AttachmentGatePhase, AttachmentGateStatus } from "../contracts/attachment-remote.ts";
export type { AttachmentAttempt, AttachmentGatePhase, AttachmentGateStatus } from "../contracts/attachment-remote.ts";
import type { AttachmentReceipt } from "../contracts/attachment-preparation.ts";
import { isSubmissionResult } from "../contracts/submissions.ts";
import type { SubmissionResult } from "../contracts/submissions.ts";
import type { AttachmentReadyItem, PreparedAttachmentLink } from "../contracts/generated/omp-wire.ts";

interface Flow {
  attempt: AttachmentAttempt; preparationId: string; abort: AbortController; phase: AttachmentGatePhase;
  nativeStarted: boolean; cancelled: boolean; message?: string; receipt?: AttachmentReceipt; code?: string; result?: SubmissionResult;
  consent: PromiseWithResolvers<string>; operation?: Promise<SubmissionResult>;
  /** Resolves when the exact receipt is ready for consent; stock has no separate consent UI. */
  prepared: PromiseWithResolvers<void>;
}
const codeOf = (error: unknown): string => error instanceof Error && /^(?:ATTACHMENT|SUBMISSION|STRICT)_[A-Z_]+$/.test(error.message)
  ? error.message : "ATTACHMENT_SEND_FAILED";
const savedAttachmentMatches = (link: PreparedAttachmentLink, item: AttachmentReadyItem): boolean =>
  link.entryPart !== undefined && link.entryPartUnavailable === undefined
  && link.originalId === item.originalId && link.preparedId === item.preparedId
  && link.originalSha256 === item.originalSha256 && link.preparedSha256 === item.preparedSha256
  && link.representationKind === item.representation.kind
  && link.entryPart.kind === (item.representation.kind === "text" ? "files" : "content");

/** Authorizes an existing attempt independently of a newer editable draft; never grants bytes or a new submission. */
export type AuthorizeAttachmentAttempt = (attempt: AttachmentAttempt) => Promise<void>;
export class AttachmentSubmissionGate {
  readonly #flows = new Map<string, Flow>();
  #epoch = 0;
  constructor(readonly bridge: AttachmentBridge, readonly authorizeAttempt: AuthorizeAttachmentAttempt) {}

  /**
   * Trusted deletion/GC view for one exact staged binding. Every transition advances an epoch, so a
   * preview issued before any attempt (or before its resolution) can never confirm against the later state.
   */
  protection(binding: Readonly<{ sessionId: string; draftId: string }>, objectId: string): OriginalProtection {
    const matching = [...this.#flows.values()].filter(flow => flow.attempt.selection.session === binding.sessionId
      && flow.attempt.selection.draftId === binding.draftId && flow.attempt.selection.originalIds.includes(objectId));
    if (!matching.length) return { status: "unreferenced", revision: `gate:${this.#epoch}` };
    if (matching.some(flow => flow.phase === "unresolved" || (flow.cancelled && flow.nativeStarted))) {
      return { status: "unresolved-submission" };
    }
    // A cancel before native dispatch releases only its own reference; a newer live attempt for
    // the same Original still occupies it until that attempt is resolved too.
    const live = matching.filter(flow => flow.phase !== "cancelled");
    if (!live.length) return { status: "unreferenced", revision: `gate:${this.#epoch}` };
    if (live.some(flow => flow.nativeStarted || flow.phase === "submitting" || flow.phase === "submitted")) {
      return { status: "executing" };
    }
    return { status: "occupied" };
  }

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
    const prepared = Promise.withResolvers<void>(); void prepared.promise.catch(() => {});
    this.#epoch++;
    this.#flows.set(attempt.requestId, { attempt: structuredClone(attempt), preparationId: crypto.randomUUID(),
      abort: new AbortController(), phase: "registered", nativeStarted: false, cancelled: false, consent, prepared });
    return { registered: true };
  }

  /** Presence only; no state or content leaves the Host without an authorized attempt check. */
  has(requestId: string): boolean { return this.#flows.has(requestId); }

  /** Read-only acceptance judgement for the trusted Chat adapter; never dispatches. */
  recovery(requestId: string): AttachmentGateStatus["recovery"] { return this.#recovery(this.#flow(requestId)); }

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

  /** Read-only exact receipt awaiting explicit user consent for this authorized View; never dispatches. */
  async pending(): Promise<AttachmentGatePending | null> {
    for (const flow of this.#flows.values()) {
      if (flow.phase !== "awaiting-consent" || !flow.receipt) continue;
      try { await this.authorizeAttempt(flow.attempt); } catch { continue; }
      return { requestId: flow.attempt.requestId, submissionId: flow.attempt.submissionId,
        selection: structuredClone(flow.attempt.selection), receipt: structuredClone(flow.receipt),
        ...(flow.message !== undefined ? { prompt: flow.message } : {}) };
    }
    return null;
  }

  /** Wait for the user's explicit acceptance of this exact stock receipt; cancellation rejects. */
  async stockAwaitConsent(requestId: string, signal: AbortSignal): Promise<{ continuing: true }> {
    const flow = this.#flow(requestId); await this.authorizeAttempt(flow.attempt);
    if (!flow.receipt) throw Error("ATTACHMENT_NOT_READY");
    if (flow.phase !== "awaiting-consent" && flow.phase !== "submitting" && flow.phase !== "submitted")
      throw Error("ATTACHMENT_CONSENT_STALE");
    if (flow.phase === "awaiting-consent") {
      const abort = () => { void this.#cancel(flow); };
      signal.addEventListener("abort", abort, { once: true });
      try { await flow.consent.promise; } finally { signal.removeEventListener("abort", abort); }
    }
    flow.abort.signal.throwIfAborted();
    return { continuing: true };
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

  /**
   * Stock uploads have no degradation dialog: prepare the exact receipt, then accept only a
   * degradation-free one. Any conversion loss is refused rather than silently accepted.
   */
  async stockPrepare(requestId: string, exactMessage: string, signal: AbortSignal): Promise<AttachmentReceipt> {
    const flow = this.#flow(requestId); await this.authorizeAttempt(flow.attempt);
    if (flow.message !== undefined && flow.message !== exactMessage) throw Error("ATTACHMENT_REQUEST_CONFLICT");
    flow.message = exactMessage;
    if (!flow.operation) {
      const abort = () => { void this.#cancel(flow); };
      signal.addEventListener("abort", abort, { once: true });
      flow.operation = this.#run(flow).finally(() => signal.removeEventListener("abort", abort));
      void flow.operation.catch(() => {});
    }
    await flow.prepared.promise;
    flow.abort.signal.throwIfAborted(); await this.authorizeAttempt(flow.attempt);
    if (!flow.receipt || flow.phase !== "awaiting-consent") throw Error("ATTACHMENT_NOT_READY");
    return structuredClone(flow.receipt);
  }

  /** Consent for a stock receipt with no required degradations; never a second preparation. */
  async stockAccept(requestId: string): Promise<{ continuing: true }> {
    const flow = this.#flow(requestId), receipt = flow.receipt;
    if (!receipt) throw Error("ATTACHMENT_NOT_READY");
    const required = receipt.items.flatMap(item => item.status === "ready" ? item.degradations : []);
    if (required.length) throw Error("ATTACHMENT_DEGRADATION_CONSENT_REQUIRED");
    return this.consent({ requestId, selection: flow.attempt.selection, receiptId: receipt.receiptId,
      resultDigest: receipt.resultDigest, acceptedDegradations: [] });
  }

  /** Release a settled stock attempt so it never occupies the two-attempt ceiling. */
  async stockRelease(requestId: string): Promise<void> {
    const flow = this.#flows.get(requestId);
    if (!flow) return;
    if (flow.nativeStarted) {
      // Only a matched terminal reservation is safe to forget; unresolved Native work stays queryable.
      if (flow.phase === "submitted") this.#flows.delete(requestId);
      return;
    }
    await this.#cancel(flow);
    this.#flows.delete(requestId);
  }

  /** Release a prepared stock attempt that never reached consent (busy, degradation refusal). */
  async abort(requestId: string): Promise<void> { await this.stockRelease(requestId); }

  async cancel(requestId: string): Promise<{ cancelled: boolean }> {
    const flow = this.#flow(requestId); await this.authorizeAttempt(flow.attempt);
    await this.#cancel(flow); return { cancelled: !flow.nativeStarted };
  }

  /** Feed only a result obtained from the same-source public native query. Absence never authorizes replay. */
  async observe(requestId: string, value: unknown): Promise<void> {
    const flow = this.#flow(requestId); await this.authorizeAttempt(flow.attempt);
    if (!isSubmissionResult(value) || value.clientSubmissionId !== flow.attempt.submissionId) throw Error("ATTACHMENT_NATIVE_RESULT_INVALID");
    this.#epoch++; flow.result = value;
    if (flow.cancelled) flow.phase = "unresolved";
    else if (this.#matchesReservation(flow, value)) flow.phase = "submitted";
    else if (flow.nativeStarted) flow.phase = "unresolved";
  }

  /** Call after the provider durably resolves this exact DSH checkpoint; no Native work is retried. */
  async finish(requestId: string, outcome: AttachmentFinishOutcome): Promise<{ finished: true }> {
    const flow = this.#flow(requestId); await this.authorizeAttempt(flow.attempt);
    if (this.#recovery(flow) !== outcome) throw Error("ATTACHMENT_OUTCOME_UNRESOLVED");
    this.#epoch++; this.#flows.delete(requestId); return { finished: true };
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
  #recovery(flow: Flow): AttachmentGateStatus["recovery"] {
    if (!flow.nativeStarted && ["failed", "cancelled"].includes(flow.phase)) return "not-submitted";
    // A cancelled attempt is never retroactively accepted by a late publication; recovery stays explicit.
    if (flow.cancelled) return "unresolved";
    const result = flow.result;
    if (!result || !this.#matchesReservation(flow, result) || result.persistence !== "committed") return "unresolved";
    if (result.inputOutcome === "no_input" && result.terminal && result.operationOutcome === "succeeded"
      && !result.relations.some(relation => relation.role === "input" && relation.status === "observed")) {
      return "completed-without-input";
    }
    // inputOutcome describes input generation, never whether hooks/commands executed or a replay is safe.
    const committed = result.relations.filter(relation => relation.status === "observed" && relation.persistence === "committed"
      && relation.entryId !== undefined && (relation.role === "input" || relation.role === "prepared"));
    const links = committed.flatMap(relation => relation.attachments ?? []);
    return result.inputOutcome === "generated" && committed.some(relation => relation.role === "input")
      && flow.receipt!.items.every(item => item.status === "ready" && links.some(link => savedAttachmentMatches(link, item)))
      ? "accepted" : "unresolved";
  }

  async #run(flow: Flow): Promise<SubmissionResult> {
    let timer: Timer | undefined;
    try {
      this.#epoch++; flow.phase = "preparing";
      flow.receipt = await this.bridge.prepare(flow.attempt.selection, flow.preparationId, flow.message!);
      flow.abort.signal.throwIfAborted(); await this.authorizeAttempt(flow.attempt);
      if (flow.receipt.status !== "ready") throw Error("ATTACHMENT_NOT_READY");
      this.#epoch++; flow.phase = "awaiting-consent"; flow.prepared.resolve();
      timer = setTimeout(() => { void this.#cancel(flow); }, Math.max(0, flow.receipt.expiresAt - Date.now()));
      const consentId = await flow.consent.promise;
      flow.abort.signal.throwIfAborted(); await this.authorizeAttempt(flow.attempt);
      await this.bridge.bind({ ...flow.attempt, consentId });
      flow.abort.signal.throwIfAborted(); await this.authorizeAttempt(flow.attempt);
      this.#epoch++; flow.phase = "submitting";
      const result = await this.bridge.submitForRequest(flow.attempt.requestId, () => { flow.nativeStarted = true; });
      if (!isSubmissionResult(result) || result.clientSubmissionId !== flow.attempt.submissionId) throw Error("ATTACHMENT_NATIVE_RESULT_INVALID");
      this.#epoch++; flow.result = result;
      flow.phase = flow.cancelled ? "unresolved" : this.#matchesReservation(flow, result) ? "submitted" : "unresolved";
      return result;
    } catch (error) {
      this.#epoch++; flow.code = flow.abort.signal.aborted ? "ATTACHMENT_CANCELLED" : codeOf(error);
      flow.phase = flow.nativeStarted ? "unresolved" : flow.abort.signal.aborted ? "cancelled" : "failed";
      flow.prepared.reject(Error(flow.code));
      if (!flow.nativeStarted) await this.bridge.discardUnsubmitted(flow.attempt.selection, flow.preparationId).catch(() => {});
      throw Error(flow.code);
    } finally { if (timer !== undefined) clearTimeout(timer); }
  }
  async #cancel(flow: Flow): Promise<void> {
    this.#epoch++; flow.abort.abort(); flow.consent.reject(Error("ATTACHMENT_CANCELLED"));
    if (flow.nativeStarted) flow.cancelled = true;
    flow.phase = flow.nativeStarted ? "unresolved" : "cancelled";
    if (!flow.nativeStarted) await this.bridge.discardUnsubmitted(flow.attempt.selection, flow.preparationId).catch(() => {});
  }
  #flow(id: string): Flow { const flow = this.#flows.get(id); if (!flow) throw Error("ATTACHMENT_ATTEMPT_UNKNOWN"); return flow; }
}
