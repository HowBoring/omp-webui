import { attachmentTarget, originalDescriptor, type AttachmentTarget } from "../contracts/attachments.ts";
import { OriginalStore, type OriginalDescriptor, type OriginalScope } from "./store.ts";

/** Proposed Host raw-stream port. The carrier supplies a currently admitted caller, never a browser path. */
export class OriginalIntake<Caller> {
  constructor(private readonly store: OriginalStore,
    private readonly authorize: (caller: Caller, target: AttachmentTarget) => OriginalScope) {}

  private access(caller: Caller, target: AttachmentTarget): () => OriginalScope {
    const validated = attachmentTarget.safeParse(target);
    if (!validated.success) throw Error("attachment_invalid_target");
    const requested = validated.data;
    return () => {
      const scope = this.authorize(caller, requested);
      if (scope.sessionId !== requested.sessionId || scope.draftId !== requested.draftId) {
        throw Error("attachment_binding_changed");
      }
      return scope;
    };
  }

  async stage(caller: Caller, target: AttachmentTarget, descriptor: OriginalDescriptor,
    body: AsyncIterable<Uint8Array>, signal?: AbortSignal) {
    try {
      const access = this.access(caller, target), validated = originalDescriptor.safeParse(descriptor);
      if (!validated.success) throw Error("attachment_invalid_descriptor");
      return await this.store.stage(access, validated.data, body, signal);
    } catch (error) { throw intakeError(error); }
  }

  async read(caller: Caller, target: AttachmentTarget, objectId: string, signal?: AbortSignal) {
    try { return await this.store.read(this.access(caller, target), objectId, signal); }
    catch (error) { throw intakeError(error); }
  }
}

function intakeError(error: unknown): Error {
  if (error instanceof Error && error.message.length <= 96 && /^attachment_[a-z_]+$/.test(error.message)) return error;
  return Error("attachment_storage_unavailable");
}
