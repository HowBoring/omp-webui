import { AsyncLocalStorage } from "node:async_hooks";
import type { Context } from "@deepseek-ai/cordis";
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import type { StopSnapshot } from "../contracts/stop.ts";
import type { ManualRetry, RetryView } from "./service.ts";

/** Authenticated Host admission supplies the exact worker retry source around one invocation. */
export interface RetryCaller {
  readonly retry: ManualRetry;
  readonly view: RetryView;
  /** Re-read the real worker before a View-visible decision; never a Native command. */
  refresh?(): void;
  observe?(snapshot: StopSnapshot): void;
}
export const retryCaller = new AsyncLocalStorage<RetryCaller>();
export class RetryService extends TypertRemoteService {
  constructor(ctx: Context) { super(ctx, "ompRetry"); }
  private caller(): RetryCaller {
    const caller = retryCaller.getStore(); if (!caller) throw new Error("RETRY_AUTH_REQUIRED"); return caller;
  }
  @Remote("state") state() {
    const caller = this.caller(); const result = caller.retry.state(caller.view);
    caller.refresh?.(); return result;
  }
  @Remote("offer") offer() { const caller = this.caller(); return caller.retry.offer(caller.view); }
  @Remote("confirm") confirm(requestId: string) {
    const caller = this.caller(); return caller.retry.confirm(caller.view, requestId);
  }
  @Remote("lookup") lookup(requestId: string) {
    const caller = this.caller(); return caller.retry.lookup(caller.view, requestId);
  }
  @Remote("cancel") cancel(requestId: string) {
    const caller = this.caller(); return caller.retry.cancel(caller.view, requestId);
  }
}
