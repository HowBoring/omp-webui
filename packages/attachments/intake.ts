import { attachmentTarget, originalDescriptor, type AttachmentTarget } from "../contracts/attachments.ts";
import { OriginalStore, type OriginalDescriptor, type OriginalScope } from "./store.ts";

/** Proposed Host raw-stream port. The carrier supplies a currently admitted caller, never a browser path. */
export class OriginalIntake<Caller> {
  constructor(private readonly store: OriginalStore,
    private readonly authorize: (caller: Caller, target: AttachmentTarget) => OriginalScope) {}

  private access(caller: Caller, target: AttachmentTarget): () => OriginalScope {
    const requested = attachmentTarget.parse(target);
    return () => {
      const scope = this.authorize(caller, requested);
      if (scope.sessionId !== requested.sessionId || scope.draftId !== requested.draftId) {
        throw Error("attachment_binding_changed");
      }
      return scope;
    };
  }

  stage(caller: Caller, target: AttachmentTarget, descriptor: OriginalDescriptor,
    body: AsyncIterable<Uint8Array>, signal?: AbortSignal) {
    return this.store.stage(this.access(caller, target), originalDescriptor.parse(descriptor), body, signal);
  }

  read(caller: Caller, target: AttachmentTarget, objectId: string, signal?: AbortSignal) {
    return this.store.read(this.access(caller, target), objectId, signal);
  }
}
