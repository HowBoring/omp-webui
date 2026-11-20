import { AsyncLocalStorage } from "node:async_hooks";
import type { Context } from "@deepseek-ai/cordis";
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import type { StopSnapshot } from "../contracts/stop.ts";
import type { StopCoordinator, StopPage } from "./stop.ts";

/** Authenticated Host admission supplies the exact coordinator, page and refresh port around one invocation. */
export interface StopCaller {
  readonly coordinator: StopCoordinator;
  readonly page: StopPage;
  /** Observe the real worker again; callers never supply Native commands or process identifiers. */
  refresh?(): void;
  observe?(snapshot: StopSnapshot): void;
}
export const stopCaller = new AsyncLocalStorage<StopCaller>();
export class StopService extends TypertRemoteService {
  constructor(ctx: Context) { super(ctx, "ompStop"); }
  private caller(): StopCaller {
    const caller = stopCaller.getStore(); if (!caller) throw new Error("STOP_AUTH_REQUIRED"); return caller;
  }
  @Remote("state") state() {
    const caller = this.caller(); const snapshot = caller.coordinator.state(caller.page);
    caller.observe?.(snapshot); caller.refresh?.(); return snapshot;
  }
  @Remote("stop") stop() {
    const caller = this.caller(); const snapshot = caller.coordinator.stop(caller.page);
    caller.observe?.(snapshot); caller.refresh?.(); return snapshot;
  }
  @Remote("offerForce") offerForce() { const caller = this.caller(); return caller.coordinator.offerForce(caller.page); }
  @Remote("confirmForce") confirmForce(token: string) {
    const caller = this.caller(); return caller.coordinator.confirmForce(caller.page, token);
  }
}
