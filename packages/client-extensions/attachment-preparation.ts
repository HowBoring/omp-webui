/** Browser workflow for the public DSH semantic draft/provider seam. No receipt enters persisted draft records. */
import type { ConversationDraftProvider } from "@deepseek-ai/dsh-client-ui-conversation/client";
import type { TypertRemoteNamespaceMap } from "@deepseek-ai/dsh-typert-protocol";
import type { AttachmentSelection } from "../contracts/attachment-remote.ts";
import type { AttachmentReceipt } from "../contracts/attachments.ts";

type Remote = TypertRemoteNamespaceMap["ompAttachments"];
export interface AttachmentPreparationView {
  phase: "idle" | "preparing" | "ready" | "failed" | "consented";
  receipt?: AttachmentReceipt;
  error?: string;
}
/** The provider owns semantic edit revisions independently of DSH's submission-entry revision. */
export interface AttachmentDraftSelection { current(): AttachmentSelection }

export class AttachmentPreparationController {
  readonly #listeners = new Set<() => void>();
  #view: AttachmentPreparationView = { phase: "idle" };
  #attempt: { selection: AttachmentSelection; preparationId: string; consentId?: string } | undefined;
  #generation = 0;
  constructor(readonly remote: Remote, readonly draft: AttachmentDraftSelection) {}
  getSnapshot = (): AttachmentPreparationView => this.#view;
  subscribe = (listener: () => void): (() => void) => { this.#listeners.add(listener); return () => this.#listeners.delete(listener); };

  async prepare(): Promise<void> {
    await this.cancel();
    const generation = ++this.#generation;
    const attempt = { selection: structuredClone(this.draft.current()), preparationId: crypto.randomUUID() };
    this.#attempt = attempt; this.#publish({ phase: "preparing" });
    try {
      const result = await this.remote.prepare(attempt);
      if (generation !== this.#generation) return;
      this.#assertCurrent(attempt.selection);
      if (!result.ok) throw Error(result.error.message);
      this.#publish({ phase: result.value.status === "ready" ? "ready" : "failed", receipt: result.value });
    } catch (error) {
      if (generation === this.#generation) this.#publish({ phase: "failed", error: String(error) });
    }
  }

  /** Invoke only from an explicit user action after displaying every actual result and degradation. */
  async consent(acceptedDegradations: readonly string[]): Promise<void> {
    const attempt = this.#attempt, receipt = this.#view.receipt;
    if (!attempt || !receipt || this.#view.phase !== "ready") throw Error("ATTACHMENT_NOT_READY");
    this.#assertCurrent(attempt.selection);
    const generation = this.#generation;
    const result = await this.remote.consent({ selection: attempt.selection, receiptId: receipt.receiptId,
      resultDigest: receipt.resultDigest, acceptedDegradations: [...acceptedDegradations] });
    if (generation !== this.#generation) throw Error("ATTACHMENT_CONSENT_STALE");
    this.#assertCurrent(attempt.selection);
    if (!result.ok) throw Error(result.error.message);
    attempt.consentId = result.value.consentId;
    this.#publish({ phase: "consented", receipt });
  }

  /** Compose with provider.beforeDispatch. Rejection preserves the protected whole-input checkpoint. */
  readonly beforeDispatch: NonNullable<ConversationDraftProvider["beforeDispatch"]> = async (_scope, context, signal) => {
    signal.throwIfAborted();
    if (this.draft.current().originalIds.length === 0) return;
    const attempt = this.#attempt;
    if (!attempt?.consentId || this.#view.phase !== "consented") throw Error("ATTACHMENT_CONSENT_REQUIRED");
    this.#assertCurrent(attempt.selection);
    const result = await this.remote.bind({ selection: attempt.selection, consentId: attempt.consentId,
      submissionId: context.submissionId, requestId: context.requestId });
    signal.throwIfAborted(); this.#assertCurrent(attempt.selection);
    if (!result.ok) throw Error(result.error.message);
  };

  async cancel(): Promise<void> {
    const attempt = this.#attempt;
    ++this.#generation; this.#attempt = undefined; this.#publish({ phase: "idle" });
    if (!attempt) return;
    const result = await this.remote.cancel({ selection: attempt.selection, preparationId: attempt.preparationId });
    if (!result.ok) throw Error(result.error.message);
  }
  #assertCurrent(selection: AttachmentSelection): void {
    if (JSON.stringify(this.draft.current()) !== JSON.stringify(selection)) throw Error("ATTACHMENT_DRAFT_CHANGED");
  }
  #publish(view: AttachmentPreparationView): void {
    this.#view = view; for (const listener of this.#listeners) listener();
  }
}
