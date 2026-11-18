import { AsyncLocalStorage } from "node:async_hooks";
import type { Context } from "@deepseek-ai/cordis";
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import type { UIAnswer } from "../contracts/interactions.ts";
import { InteractionBroker, type PageBinding } from "./broker.ts";

/** Host admission binds a current authenticated page/Peer before public Gateway dispatch. */
export const interactionCaller = new AsyncLocalStorage<PageBinding>();
export class InteractionBrokerService extends TypertRemoteService {
  constructor(ctx: Context, readonly broker: InteractionBroker) { super(ctx, "ompInteractionBroker"); }
  private caller(): PageBinding {
    const page = interactionCaller.getStore();
    const invocation = this.ctx.invocation;
    if (!page || !invocation || invocation.peer.id !== page.peerId || invocation.signal.aborted ||
      invocation.peer.signal.aborted) throw new Error("INTERACTION_AUTH_REQUIRED");
    return page;
  }
  @Remote("pending") pending() { return this.broker.pending(this.caller()); }
  @Remote("answer") answer(generation: string, interactionId: string, deliveryId: string, answer: UIAnswer) {
    return this.broker.answer(this.caller(), generation, interactionId, deliveryId, answer);
  }
}
