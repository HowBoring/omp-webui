/**
 * Host-only authority for Chat image originals and attachment preparation.
 *
 * The browser supplies a selection, never bytes or Native identity. Every call rechecks the attached
 * View, directory grant and live worker generation, then reads the private original from the Store.
 */
import type { BrowserAccess, BrowserAuthority } from "../../../packages/access/index.ts";
import type { AttachmentAuthority, AuthorizedAttachmentDraft } from "../../../packages/attachments/bridge.ts";
import { OriginalIntake } from "../../../packages/attachments/intake.ts";
import { attachmentFormat } from "../../../packages/attachments/media.ts";
import type { OriginalScope, OriginalStore } from "../../../packages/attachments/store.ts";
import type { AttachmentSelection, AttachmentAttempt } from "../../../packages/contracts/attachment-remote.ts";
import type { AttachmentTarget } from "../../../packages/contracts/attachments.ts";
import { sessionCaller } from "../../../packages/sessions/service.ts";
import type { ChatComponentRuntime } from "./chat-component-runtime.ts";

export class ChatAttachmentAuthority implements AttachmentAuthority {
  /** Late-bound so the Host can compose the authority before the runtime that owns the gate. */
  readonly #intake: OriginalIntake<unknown>;
  constructor(private readonly authority: BrowserAuthority, private readonly runtime: () => ChatComponentRuntime,
    private readonly store: OriginalStore) {
    this.#intake = new OriginalIntake(store, (_caller, target) => this.scope(target));
  }

  /** Trusted OriginalIntake authority: always resolved from the current admitted Chat View. */
  scope(target: AttachmentTarget): OriginalScope {
    const caller = this.#identity();
    const resolved = this.runtime().attachment(caller, target.sessionId, target.draftId);
    if (!resolved) throw Error("ATTACHMENT_AUTHORITY_CHANGED");
    return { hostId: this.authority.hostId, browserId: caller.credentialId, pageId: caller.credentialId,
      profileId: this.authority.hostId, sourceId: resolved.entry.target.sourceId,
      instanceId: resolved.entry.target.instanceId, sessionId: target.sessionId,
      canonicalCwd: resolved.view.cwd, draftId: target.draftId,
      authorityEpoch: resolved.view.generation, explicitOpen: true };
  }

  /** Gate attempt revalidation, including before every consent and native call. */
  async authorizeAttempt(attempt: AttachmentAttempt): Promise<void> {
    const identity = this.#identity();
    const resolved = this.runtime().attachment(identity, attempt.selection.session, attempt.selection.draftId);
    if (!resolved || resolved.entry.target.nativeSessionId !== attempt.selection.session) {
      throw Error("ATTACHMENT_AUTHORITY_CHANGED");
    }
  }

  associated(selection: AttachmentSelection, objectIds: readonly string[], clientSubmissionId: string): void {
    const identity = sessionCaller.getStore(); if (!identity) return;
    const scope = this.scope({ sessionId: selection.session, draftId: selection.draftId });
    this.store.associateReserved(() => scope, clientSubmissionId, objectIds);
  }

  /** Durable hold before Native dispatch; a changed draft, View or receipt refuses this Send. */
  async reserve(selection: AttachmentSelection, attempt: { clientSubmissionId: string; preparationId: string;
    draftRevision: string; authorityGeneration: string }, objectIds: readonly string[], receipt: unknown): Promise<void> {
    const target = { sessionId: selection.session, draftId: selection.draftId };
    this.store.reserveForSubmission(() => this.scope(target), attempt, objectIds, receipt);
  }

  /** Records the Host-verified complete native query; the Store rejects anything but a committed retained association. */
  async record(selection: AttachmentSelection, clientSubmissionId: string, result: unknown): Promise<void> {
    const target = { sessionId: selection.session, draftId: selection.draftId };
    this.store.recordSubmission(() => this.scope(target), clientSubmissionId, result);
  }

  async authorize(selection: AttachmentSelection): Promise<AuthorizedAttachmentDraft> {
    const identity = this.#identity();
    const resolved = this.runtime().attachment(identity, selection.session, selection.draftId);
    if (!resolved) throw Error("ATTACHMENT_AUTHORITY_CHANGED");
    const target = { sessionId: selection.session, draftId: selection.draftId };
    const objects = [];
    for (const originalId of selection.originalIds) {
      const staged = await this.#intake.read(identity, target, originalId);
      const format = attachmentFormat(staged.mediaType);
      if (!format) throw Error("ATTACHMENT_FORMAT_UNSUPPORTED");
      objects.push({ originalId, format, sha256: staged.sha256, data: Buffer.from(staged.bytes).toString("base64") });
    }
    return { target: resolved.entry.target, draftId: selection.draftId, draftRevision: selection.revision,
      authorityGeneration: resolved.view.generation, message: "", objects };
  }

  #identity(): BrowserAccess {
    const identity = sessionCaller.getStore();
    if (!identity) throw Error("ATTACHMENT_AUTHORITY_CHANGED");
    return identity;
  }
}
