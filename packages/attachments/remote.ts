/** Public DSH Gateway service; physical Connection admission must provide the trusted browser authority. */
import type { Context } from "@deepseek-ai/cordis";
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import { attachmentsHostContribution } from "../contracts/attachment-remote.ts";
import type { AttachmentSelection, AttachmentPrepareRequest, AttachmentConsentRequest, AttachmentDispatchBinding } from "../contracts/attachment-remote.ts";
import type { AttachmentBridge } from "./bridge.ts";

export class AttachmentRemoteService extends TypertRemoteService {
  constructor(ctx: Context, readonly bridge: AttachmentBridge) { super(ctx, "ompAttachments"); }
  @Remote("prepare") prepare(request: AttachmentPrepareRequest) { return this.bridge.prepare(request.selection, request.preparationId); }
  @Remote("consent") consent(request: AttachmentConsentRequest) { return this.bridge.consent(request); }
  @Remote("bind") bind(request: AttachmentDispatchBinding) { return this.bridge.bind(request); }
  @Remote("cancel") cancel(request: { selection: AttachmentSelection; preparationId: string }) { return this.bridge.cancel(request); }
}
/** Register inside an authenticated Host scope. This does not open a listener or admit product Sessions. */
export function installAttachmentRemote(ctx: Context, bridge: AttachmentBridge): AttachmentRemoteService {
  ctx.typert.register(attachmentsHostContribution);
  return new AttachmentRemoteService(ctx, bridge);
}
