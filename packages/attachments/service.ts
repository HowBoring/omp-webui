import type { Context } from "@deepseek-ai/cordis";
import { Remote, TypertRemoteService, type PeerScope } from "@deepseek-ai/dsh-typert-protocol";
import { attachmentRequest, type AttachmentRequest, type AttachmentResult,
  type AttachmentTarget } from "../contracts/attachments.ts";
import { isAttachmentError } from "./errors.ts";
import { OriginalIntake } from "./intake.ts";
import { OriginalStore, type OriginalScope } from "./store.ts";

/** Unregistered Host source adapter. No worker, Native prepare/commit, prompt, queue or Session creation port exists. */
export class AttachmentRemote extends TypertRemoteService {
  constructor(ctx: Context, private readonly store: OriginalStore,
    private readonly authorize: (peer: PeerScope, target: AttachmentTarget) => OriginalScope) {
    super(ctx, "ompOriginals");
  }

  @Remote("exchange") async exchange(options: AttachmentRequest): Promise<AttachmentResult> {
    try {
      const request = attachmentRequest.parse(options), invocation = this.ctx.invocation;
      if (!invocation || invocation.signal.aborted || invocation.peer.signal.aborted) {
        throw Error("attachment_authority_unavailable");
      }
      const signal = AbortSignal.any([invocation.signal, invocation.peer.signal]);
      const intake = new OriginalIntake(this.store, (peer: PeerScope, target) => {
        if (peer !== invocation.peer || signal.aborted) throw Error("attachment_authority_unavailable");
        return this.authorize(peer, target);
      });
      if (request.operation === "read-base64") {
        const { bytes, ...original } = await intake.read(invocation.peer, request.target, request.objectId, signal);
        return { status: "read", original, base64: Buffer.from(bytes).toString("base64") };
      }
      // The generator is evaluated only after live authorization and atomic reservation by the store.
      const { base64, descriptor } = request;
      async function* decode() {
        if (base64.length !== 4 * Math.ceil(descriptor.byteLength / 3)) throw Error("attachment_size_mismatch");
        const value = Buffer.from(base64, "base64");
        if (value.toString("base64") !== base64) throw Error("attachment_invalid_base64");
        yield value;
      }
      const original = await intake.stage(invocation.peer, request.target, descriptor, decode(), signal);
      return { status: "staged", original };
    } catch (error) {
      const code = isAttachmentError(error) ? error.message : "attachment_intake_failed";
      return { status: "error", code };
    }
  }
}
