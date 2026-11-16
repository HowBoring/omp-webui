/** Runtime-only post-Enter consent UI; the semantic provider retains the unresolved whole-input checkpoint. */
import type { ConversationDraftProvider } from "@deepseek-ai/dsh-client-ui-conversation/client";
import type { TypertRemoteNamespaceMap } from "@deepseek-ai/dsh-typert-protocol";
import type { AttachmentSelection, AttachmentAttempt, AttachmentFinishOutcome, AttachmentGateStatus } from "../contracts/attachment-remote.ts";

type Remote = TypertRemoteNamespaceMap["ompAttachments"];
export type AttachmentPreparationView = { phase: "idle"; error?: string } | AttachmentGateStatus & { error?: string };
/** Provider edit revisions are independent of DSH's submission-entry revision. */
export interface AttachmentDraftSelection { current(): AttachmentSelection }

export class AttachmentPreparationController {
  readonly #listeners = new Set<() => void>();
  #view: AttachmentPreparationView = { phase: "idle" };
  #attempt: AttachmentAttempt | undefined;
  #timer: Timer | undefined;
  #generation = 0;
  #removeAbort: (() => void) | undefined;
  constructor(readonly remote: Remote, readonly draft: AttachmentDraftSelection) {}
  getSnapshot = (): AttachmentPreparationView => this.#view;
  subscribe = (listener: () => void): (() => void) => { this.#listeners.add(listener); return () => this.#listeners.delete(listener); };

  /** Registration never prepares prose. The trusted Session Remote will supply the actual serialized prompt. */
  async registerAttempt(attempt: AttachmentAttempt, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted(); this.#assertCurrent(attempt.selection);
    if (this.#attempt) throw Error("ATTACHMENT_ATTEMPT_UNRESOLVED");
    this.#attempt = structuredClone(attempt); const generation = ++this.#generation;
    this.#publish({ phase: "registered", requestId: attempt.requestId, submissionId: attempt.submissionId,
      nativeState: "not-dispatched", recovery: "unresolved" });
    const result = await this.remote.begin(attempt);
    if (!result.ok) { this.#publish({ ...this.#view, error: result.error.message }); throw Error(result.error.message); }
    const cancel = () => { void this.cancel().catch(error => this.#publish({ ...this.#view, error: String(error) })); };
    signal.addEventListener("abort", cancel, { once: true });
    this.#removeAbort = () => signal.removeEventListener("abort", cancel);
    if (signal.aborted) { await this.cancel(); signal.throwIfAborted(); }
    if (generation === this.#generation) this.#schedule();
  }

  readonly beforeDispatch: NonNullable<ConversationDraftProvider["beforeDispatch"]> = async (_scope, context, signal) => {
    if (this.draft.current().originalIds.length === 0) return;
    await this.registerAttempt({ selection: structuredClone(this.draft.current()),
      submissionId: context.submissionId, requestId: context.requestId }, signal);
  };

  /** Refreshing/reconnecting only queries this attempt. It never resubmits a Native request. */
  async refresh(): Promise<void> {
    const attempt = this.#attempt; if (!attempt) return;
    const generation = this.#generation;
    const known = this.#view.phase !== "idle" ? this.#view.receipt : undefined;
    const result = await this.remote.status({ requestId: attempt.requestId, ...(known ? { knownDigest: known.resultDigest } : {}) });
    if (generation !== this.#generation) return;
    if (!result.ok) { this.#publish({ ...this.#view, error: result.error.message }); return; }
    if (result.value.requestId !== attempt.requestId || result.value.submissionId !== attempt.submissionId) {
      throw Error("ATTACHMENT_REQUEST_CONFLICT");
    }
    const previousPrompt = this.#view.phase !== "idle" ? this.#view.prompt : undefined;
    this.#publish({ ...result.value, ...(known && !result.value.receipt ? { receipt: known } : {}),
      ...(previousPrompt !== undefined && result.value.prompt === undefined ? { prompt: previousPrompt } : {}) });
  }

  /** Explicit acceptance continues this Send attempt with the displayed exact content and listed degradations. */
  async consent(acceptedDegradations: readonly string[]): Promise<void> {
    const attempt = this.#attempt, view = this.#view;
    if (!attempt || view.phase !== "awaiting-consent" || !view.receipt) throw Error("ATTACHMENT_NOT_READY");
    this.#assertCurrent(attempt.selection);
    const result = await this.remote.consent({ selection: attempt.selection, requestId: attempt.requestId,
      receiptId: view.receipt.receiptId, resultDigest: view.receipt.resultDigest, acceptedDegradations: [...acceptedDegradations] });
    if (!result.ok) throw Error(result.error.message);
    await this.refresh();
  }

  /** Cancellation preserves the checkpoint. A started Native request remains unresolved until public facts settle it. */
  async cancel(): Promise<void> {
    const attempt = this.#attempt; if (!attempt) return;
    const result = await this.remote.cancel({ requestId: attempt.requestId });
    if (!result.ok) throw Error(result.error.message);
    await this.refresh();
  }

  /** Invoke only after the provider has durably resolved this exact checkpoint without overwriting a newer draft. */
  async finishAfterRecovery(outcome: AttachmentFinishOutcome): Promise<void> {
    const attempt = this.#attempt; if (!attempt) throw Error("ATTACHMENT_ATTEMPT_UNKNOWN");
    const result = await this.remote.finish({ requestId: attempt.requestId, outcome });
    if (!result.ok) throw Error(result.error.message);
    this.dispose(); this.#removeAbort?.(); this.#removeAbort = undefined; this.#attempt = undefined; this.#publish({ phase: "idle" });
  }
  /** Unmount stops observation; it cannot cancel or classify an in-flight Native request. */
  dispose(): void { ++this.#generation; if (this.#timer !== undefined) clearTimeout(this.#timer); this.#timer = undefined; }
  #schedule(): void {
    if (this.#timer !== undefined) clearTimeout(this.#timer);
    const generation = this.#generation;
    this.#timer = setTimeout(() => {
      void this.refresh().catch(error => this.#publish({ ...this.#view, error: String(error) })).finally(() => {
        if (generation === this.#generation && this.#attempt) this.#schedule();
      });
    }, 200);
  }
  #assertCurrent(selection: AttachmentSelection): void {
    if (JSON.stringify(this.draft.current()) !== JSON.stringify(selection)) throw Error("ATTACHMENT_DRAFT_CHANGED");
  }
  #publish(view: AttachmentPreparationView): void {
    this.#view = view; for (const listener of this.#listeners) listener();
  }
}
