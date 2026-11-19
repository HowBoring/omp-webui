/** Host preparation coordinator. Native RPC owns conversion, reservation, consumption and causal entries. */
import { attachmentSelectionSchema, attachmentConsentRequestSchema, attachmentPrepareRequestSchema } from "../contracts/attachment-remote.ts";
import type { AttachmentSelection, AttachmentConsentRequest, AttachmentDispatchBinding } from "../contracts/attachment-remote.ts";
import { isSubmissionResult } from "../contracts/submissions.ts";
import type { AttachmentReceipt, AttachmentConsent } from "../contracts/attachment-preparation.ts";
import type { RpcWireCommands, SubmissionTarget } from "../contracts/generated/omp-wire.ts";

type Preparation = RpcWireCommands["attachment_prepare"]["params"];
type Submission = RpcWireCommands["submission_submit"]["params"];
export interface AuthorizedAttachmentDraft extends Omit<Preparation, "preparationId"> { target: SubmissionTarget }
/** Must recheck live browser ownership, trusted projection, draft, originals and authority at every call. */
export interface AttachmentAuthority {
  authorize(selection: AttachmentSelection): Promise<AuthorizedAttachmentDraft>;
}
/** This port must be implemented by the same-source public native clients and an owned RPC worker. */
export interface AttachmentNativePort {
  prepare(input: Preparation): Promise<AttachmentReceipt>;
  cancel(preparationId: string): Promise<{ cancelled: boolean }>;
  submit(input: Submission): Promise<unknown>;
}
interface Prepared {
  selection: AttachmentSelection; authorityFingerprint: string; receipt: AttachmentReceipt;
  target: SubmissionTarget; message: string; nativeStarted: boolean;
  consent?: { id: string; value: AttachmentConsent }; bound?: { submissionId: string; requestId: string };
}
const fingerprint = (draft: AuthorizedAttachmentDraft): string => Bun.SHA256.hash(JSON.stringify(draft), "hex");

/** Bounded ephemeral workflow. Receipts and consent handles never become durable draft records. */
export class AttachmentBridge {
  readonly #prepared = new Map<string, Prepared>();
  readonly #requests = new Map<string, Prepared>();
  readonly #pending = new Map<string, { selection: AttachmentSelection; authorityFingerprint: string; target: SubmissionTarget }>();
  constructor(readonly authority: AttachmentAuthority, readonly native: (target: SubmissionTarget) => AttachmentNativePort) {}

  async prepare(selection: AttachmentSelection, preparationId: string = crypto.randomUUID(), exactMessage?: string): Promise<AttachmentReceipt> {
    attachmentPrepareRequestSchema.parse({ selection, preparationId });
    if (this.#pending.has(preparationId) || [...this.#prepared.values()].some(value => value.receipt.preparationId === preparationId)) {
      throw Error("ATTACHMENT_PREPARATION_CONFLICT");
    }
    this.#prune();
    if (this.#prepared.size + this.#pending.size >= 2) throw Error("ATTACHMENT_HOST_PREPARATION_LIMIT");
    const draft = await this.#authorize(selection), authorityFingerprint = fingerprint(draft);
    const { target, ...input } = draft;
    this.#pending.set(preparationId, { selection: structuredClone(selection), authorityFingerprint, target });
    let receipt: AttachmentReceipt | undefined;
    const message = exactMessage ?? input.message;
    try {
      receipt = await this.native(target).prepare({ ...input, message, preparationId });
      if (!this.#pending.has(preparationId)) throw Error("ATTACHMENT_CANCELLED");
      if (fingerprint(await this.#authorize(selection)) !== authorityFingerprint) {
        await this.native(target).cancel(receipt.preparationId); throw Error("ATTACHMENT_AUTHORITY_CHANGED");
      }
    } catch (error) {
      if (receipt) await this.native(target).cancel(receipt.preparationId).catch(() => {});
      throw error;
    } finally { this.#pending.delete(preparationId); }
    if (Buffer.byteLength(JSON.stringify(receipt)) > 8 * 1024 * 1024) {
      await this.native(target).cancel(receipt.preparationId); throw Error("ATTACHMENT_HOST_PREPARED_BUDGET");
    }
    if (receipt.binding.sourceId !== target.sourceId || receipt.binding.instanceId !== target.instanceId ||
      receipt.binding.nativeSessionId !== target.nativeSessionId) throw Error("ATTACHMENT_TARGET_CHANGED");
    this.#prepared.set(receipt.receiptId, { selection: structuredClone(selection), authorityFingerprint, receipt: structuredClone(receipt),
      target, message, nativeStarted: false });
    return structuredClone(receipt);
  }

  async consent(request: AttachmentConsentRequest): Promise<{ consentId: string }> {
    attachmentConsentRequestSchema.parse(request);
    const prepared = this.#find(request.receiptId);
    await this.#current(prepared, request.selection);
    if (prepared.receipt.status !== "ready") throw Error("ATTACHMENT_NOT_READY");
    if (prepared.receipt.resultDigest !== request.resultDigest) throw Error("ATTACHMENT_CONSENT_STALE");
    const required = new Set(prepared.receipt.items.flatMap(item => item.status === "ready" ? item.degradations : []));
    const accepted = new Set(request.acceptedDegradations);
    if (accepted.size !== request.acceptedDegradations.length || required.size !== accepted.size ||
      [...required].some(code => !accepted.has(code))) throw Error("ATTACHMENT_DEGRADATION_CONSENT_REQUIRED");
    if (prepared.bound) throw Error("ATTACHMENT_ALREADY_BOUND");
    const value: AttachmentConsent = { receiptId: prepared.receipt.receiptId, resultDigest: request.resultDigest,
      draftRevision: prepared.receipt.draftRevision, authorityGeneration: prepared.receipt.authorityGeneration,
      acceptedDegradations: [...accepted] };
    prepared.consent = { id: crypto.randomUUID(), value };
    return { consentId: prepared.consent.id };
  }

  async bind(request: AttachmentDispatchBinding): Promise<{ bound: true }> {
    const prepared = [...this.#prepared.values()].find(value => value.consent?.id === request.consentId);
    if (!prepared) throw Error("ATTACHMENT_CONSENT_STALE");
    await this.#current(prepared, request.selection);
    if (prepared.bound && (prepared.bound.requestId !== request.requestId || prepared.bound.submissionId !== request.submissionId)) {
      throw Error("ATTACHMENT_ALREADY_BOUND");
    }
    const existing = this.#requests.get(request.requestId);
    if (existing && existing !== prepared) throw Error("ATTACHMENT_REQUEST_CONFLICT");
    prepared.bound = { requestId: request.requestId, submissionId: request.submissionId };
    this.#requests.set(request.requestId, prepared);
    return { bound: true };
  }

  /** Called by the trusted DSH prompt adapter for this actual request, immediately before native reserve. */
  async submitForRequest(requestId: string, beforeNativeCall?: () => void): Promise<unknown> {
    const prepared = this.#requests.get(requestId);
    if (!prepared?.bound || !prepared.consent) throw Error("ATTACHMENT_DISPATCH_UNBOUND");
    const draft = await this.#current(prepared, prepared.selection);
    prepared.nativeStarted = true; beforeNativeCall?.();
    const result = await this.native(draft.target).submit({ ...draft.target, clientSubmissionId: prepared.bound.submissionId,
      preparationId: prepared.receipt.preparationId, inputType: "prompt", idleOnly: true, message: prepared.message,
      preparationConsent: structuredClone(prepared.consent.value) });
    this.observeNativeResult(requestId, result);
    return result;
  }

  /** The trusted adapter can also supply a read-only native query after a lost response. Never infers accepted input. */
  observeNativeResult(requestId: string, value: unknown): void {
    const prepared = this.#requests.get(requestId);
    if (!prepared?.bound) throw Error("ATTACHMENT_DISPATCH_UNBOUND");
    if (!isSubmissionResult(value) || value.clientSubmissionId !== prepared.bound.submissionId) {
      throw Error("ATTACHMENT_NATIVE_RESULT_INVALID");
    }
    const target = prepared.receipt.binding;
    if (!value.found || value.reservation !== "committed" || !value.origin || value.origin.sourceId !== target.sourceId ||
      value.origin.instanceId !== target.instanceId || value.origin.nativeSessionId !== target.nativeSessionId ||
      value.preparation?.receiptId !== prepared.receipt.receiptId) return;
    // Native owns the verified reserved bundle now. Discard large ephemeral browser receipt bytes, not the draft checkpoint.
    this.#prepared.delete(prepared.receipt.receiptId); this.#requests.delete(requestId);
  }

  /** Trusted operation cleanup only: seals an owned pre-Native flow even after its draft/grant became stale. */
  async discardUnsubmitted(selection: AttachmentSelection, preparationId: string): Promise<void> {
    const prepared = [...this.#prepared.values()].find(value => value.receipt.preparationId === preparationId);
    const pending = this.#pending.get(preparationId);
    const owned = prepared ?? pending;
    if (!owned || JSON.stringify(owned.selection) !== JSON.stringify(selection) || prepared?.nativeStarted) return;
    this.#pending.delete(preparationId);
    if (prepared) {
      this.#prepared.delete(prepared.receipt.receiptId);
      if (prepared.bound) this.#requests.delete(prepared.bound.requestId);
    }
    await this.native(owned.target).cancel(preparationId);
  }

  async cancel(request: { selection: AttachmentSelection; preparationId: string }): Promise<{ cancelled: boolean }> {
    const draft = await this.#authorize(request.selection);
    const prepared = [...this.#prepared.values()].find(value => value.receipt.preparationId === request.preparationId);
    if (!prepared) {
      const pending = this.#pending.get(request.preparationId);
      if (!pending || JSON.stringify(pending.selection) !== JSON.stringify(request.selection)) return { cancelled: false };
      if (fingerprint(draft) !== pending.authorityFingerprint) throw Error("ATTACHMENT_AUTHORITY_CHANGED");
      this.#pending.delete(request.preparationId);
    }
    if (prepared) {
      await this.#current(prepared, request.selection);
      if (prepared.bound) throw Error("ATTACHMENT_ALREADY_BOUND");
      this.#prepared.delete(prepared.receipt.receiptId);
    }
    return this.native(draft.target).cancel(request.preparationId);
  }

  async #authorize(selection: AttachmentSelection): Promise<AuthorizedAttachmentDraft> {
    attachmentSelectionSchema.parse(selection);
    const draft = await this.authority.authorize(structuredClone(selection));
    if (draft.draftId !== selection.draftId || draft.draftRevision !== selection.revision ||
      draft.objects.length !== selection.originalIds.length ||
      draft.objects.some((object, index) => object.originalId !== selection.originalIds[index])) throw Error("ATTACHMENT_DRAFT_CHANGED");
    return draft;
  }
  async #current(prepared: Prepared, selection: AttachmentSelection): Promise<AuthorizedAttachmentDraft> {
    if (prepared.receipt.expiresAt <= Date.now() || JSON.stringify(selection) !== JSON.stringify(prepared.selection)) {
      throw Error("ATTACHMENT_RECEIPT_STALE");
    }
    const draft = await this.#authorize(selection);
    if (fingerprint(draft) !== prepared.authorityFingerprint) throw Error("ATTACHMENT_AUTHORITY_CHANGED");
    return draft;
  }
  #find(id: string): Prepared {
    this.#prune(); const prepared = this.#prepared.get(id);
    if (!prepared) throw Error("ATTACHMENT_RECEIPT_STALE");
    return prepared;
  }
  #prune(): void {
    for (const [id, value] of this.#prepared) if (value.receipt.expiresAt <= Date.now()) {
      this.#prepared.delete(id);
      if (value.bound) this.#requests.delete(value.bound.requestId);
    }
  }
}
