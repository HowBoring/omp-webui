import { AsyncLocalStorage } from "node:async_hooks";
import type { Context } from "@deepseek-ai/cordis";
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import type { UIAnswer } from "../contracts/interactions.ts";
import { InteractionBroker, type PageBinding } from "./broker.ts";

interface InteractionInvocation {
  readonly page: PageBinding;
  current(): boolean;
}

/** Host admission binds a current authenticated page/Peer before public Gateway dispatch. */
export const interactionCaller = new AsyncLocalStorage<InteractionInvocation>();
export class InteractionBrokerService extends TypertRemoteService {
  constructor(ctx: Context, readonly broker: InteractionBroker) { super(ctx, "ompInteractionBroker"); }
  private caller(): PageBinding {
    const caller = interactionCaller.getStore();
    const invocation = this.ctx.invocation;
    if (!caller || !invocation || invocation.peer.id !== caller.page.peerId || invocation.signal.aborted ||
      invocation.peer.signal.aborted || !caller.current()) throw new Error("INTERACTION_AUTH_REQUIRED");
    return caller.page;
  }
  @Remote("pending") pending() { return this.broker.pending(this.caller()); }
  @Remote("answer") answer(generation: string, interactionId: string, deliveryId: string, answer: UIAnswer) {
    return this.broker.answer(this.caller(), generation, interactionId, deliveryId, answer);
  }
}
