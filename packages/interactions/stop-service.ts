import { AsyncLocalStorage } from "node:async_hooks";
import type { Context } from "@deepseek-ai/cordis";
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import { StopCoordinator, type StopPage } from "./stop.ts";

/** Populated only by authenticated Host admission around Gateway invocation. */
export const stopCaller = new AsyncLocalStorage<StopPage>();
export class StopService extends TypertRemoteService {
  constructor(ctx: Context, readonly coordinator: StopCoordinator) { super(ctx, "ompStop"); }
  private caller(): StopPage {
    const page = stopCaller.getStore(); if (!page) throw new Error("STOP_AUTH_REQUIRED"); return page;
  }
  @Remote("state") state() { return this.coordinator.state(this.caller()); }
  @Remote("stop") stop() { return this.coordinator.stop(this.caller()); }
  @Remote("offerForce") offerForce() { return this.coordinator.offerForce(this.caller()); }
  @Remote("confirmForce") confirmForce(token: string) { return this.coordinator.confirmForce(this.caller(), token); }
}
