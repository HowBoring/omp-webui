import { AsyncLocalStorage } from "node:async_hooks";
import type { Context } from "@deepseek-ai/cordis";
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import {
  brokerResultSchema, brokerSnapshotSchema, type BrokerResult, type BrokerSnapshot,
} from "../contracts/interaction-broker.ts";
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
  private caller(): { page: PageBinding; signal: AbortSignal } {
    const caller = interactionCaller.getStore();
    const invocation = this.ctx.invocation;
    if (!caller || !invocation || invocation.peer.id !== caller.page.peerId || invocation.signal.aborted ||
      invocation.peer.signal.aborted || !caller.current()) throw new Error("INTERACTION_AUTH_REQUIRED");
    return { page: caller.page, signal: invocation.signal };
  }
  @Remote("pending") pending() { return this.broker.pending(this.caller().page); }
  @Remote({ mode: "stream" }) async *pendingSnapshot(): AsyncGenerator<BrokerSnapshot> {
    yield brokerSnapshotSchema.parse(this.broker.pendingSnapshot(this.caller().page));
  }
  @Remote({ mode: "stream" }) async *answerStream(generation: string, interactionId: string, deliveryId: string,
    answer: UIAnswer, _csrf: string): AsyncGenerator<BrokerResult> {
    // The current invocation guard rechecks the carrier-validated proof after Gateway preparation.
    const { page, signal } = this.caller();
    const ended = Promise.withResolvers<void>();
    const abort = () => { ended.resolve(); };
    signal.addEventListener("abort", abort, { once: true });
    try {
      // Only publication is cancellable. The Broker still owns the Native acknowledgement.
      signal.throwIfAborted();
      const result = await Promise.race([
        this.broker.answer(page, generation, interactionId, deliveryId, answer),
        ended.promise,
      ]);
      if (!signal.aborted) yield brokerResultSchema.parse(result);
    } finally { signal.removeEventListener("abort", abort); }
  }
  @Remote("answer") answer(generation: string, interactionId: string, deliveryId: string, answer: UIAnswer) {
    return this.broker.answer(this.caller().page, generation, interactionId, deliveryId, answer);
  }
}
