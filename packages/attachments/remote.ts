/** DSH Gateway service scoped to an authenticated browser actor and trusted Session projection. */
import type { Context } from "@deepseek-ai/cordis";
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import { attachmentsHostContribution } from "../contracts/attachment-remote.ts";
import type { AttachmentAttempt, AttachmentContinueRequest, AttachmentFinishOutcome } from "../contracts/attachment-remote.ts";
import type { AttachmentSubmissionGate } from "./submission-gate.ts";

export class AttachmentRemoteService extends TypertRemoteService {
  constructor(ctx: Context, readonly gate: AttachmentSubmissionGate) { super(ctx, "ompAttachments"); }
  @Remote("begin") begin(request: AttachmentAttempt) { return this.gate.begin(request); }
  @Remote("status") status(request: { requestId: string; knownDigest?: string }) {
    return this.gate.status(request.requestId, request.knownDigest);
  }
  @Remote("pending") async pending() { return { pending: await this.gate.pending() }; }
  @Remote("consent") consent(request: AttachmentContinueRequest) { return this.gate.consent(request); }
  @Remote("cancel") cancel(request: { requestId: string }) { return this.gate.cancel(request.requestId); }
  @Remote("finish") finish(request: { requestId: string; outcome: AttachmentFinishOutcome }) {
    return this.gate.finish(request.requestId, request.outcome);
  }
}
/** The same gate is injected into the trusted typed Session prompt handler; no alternate browser submit API exists. */
export function installAttachmentRemote(ctx: Context, gate: AttachmentSubmissionGate): AttachmentRemoteService {
  ctx.typert.register(attachmentsHostContribution);
  return new AttachmentRemoteService(ctx, gate);
}
