import { randomUUID } from "node:crypto";
import type { AbortAndRestoreQueueResult, PromptResultEvent, RpcWireCommands,
  SessionSettledEvent, SessionState } from "../contracts/generated/omp-wire.ts";
import { brokerScopeSchema, type BrokerScope } from "../contracts/interaction-broker.ts";
import { restoredQueueSchema, type ForceOffer, type StopSnapshot } from "../contracts/stop.ts";
import { InteractionCancellationUnknownError, type PageIdentity } from "./broker.ts";

/** Implement using the matched public abort_branch_summary and abort_and_restore_queue RPC operations. */
export interface StopNativePort {
  abortBranchSummary(): Promise<void>;
  abortAndRestoreQueue(): Promise<AbortAndRestoreQueueResult>;
}
/** Typed injection from a validated, correlated public JSONL RPC client. No Native runtime import. */
export interface PublicStopRpc {
  abortBranchSummary(command: { id: string; type: "abort_branch_summary" }):
    Promise<RpcWireCommands["abort_branch_summary"]["result"]>;
  abortAndRestoreQueue(command: { id: string; type: "abort_and_restore_queue" }):
    Promise<RpcWireCommands["abort_and_restore_queue"]["result"]>;
}
export function createStopNativePort(rpc: PublicStopRpc): StopNativePort {
  return { abortBranchSummary: async () => { await rpc.abortBranchSummary({ id: randomUUID(), type: "abort_branch_summary" }); },
    abortAndRestoreQueue: () => rpc.abortAndRestoreQueue({ id: randomUUID(), type: "abort_and_restore_queue" }) };
}
export interface StopHostPort {
  /** Synchronously fence answers; cancel known UI without recursively requesting Stop. */
  beginStop(): Promise<void>;
  /** Live Broker uncertainty, including UI arriving after beginStop completed. Only public terminal evidence clears it. */
  cancellationUncertain(): boolean;
  pending(): StopSnapshot["pending"];
  resume(): void;
}
/** Capability retained from original supervised spawn. No PID lookup, recovery, or process group fallback. */
export interface OwnedStopCapability {
  readonly workerGeneration: string;
  isCurrent(): boolean;
  /** Existing supervisor implements its bounded termination/reap policy; success requires observed cleanup. */
  terminateAndReap(): Promise<"reaped" | "unknown">;
}
export interface StopPage extends PageIdentity { readonly generation: string }
export type StopObservation = { kind: "settled"; settled: boolean } | { kind: "agent-end" | "eof" | "ended" };
const empty = () => ({ interactions: 0, history: 0, queued: 0, other: 0 });

/** One live worker; all observations and authority are supplied by trusted Host adapters. */
export class StopCoordinator {
  readonly generation = randomUUID();
  readonly scope: BrokerScope;
  #pages = new Map<string, StopPage>();
  #drafts = new Set<StopPage>();
  #status: StopSnapshot["status"] = "idle";
  #settled = false;
  #started = 0;
  #controlsDone = false;
  #controls: Promise<void> = Promise.resolve();
  #failures: StopSnapshot["failures"] = [];
  #uiControlFailed = false;
  #restored: StopSnapshot["restored"] = null;
  #offer: { token: string; page: StopPage; expires: number } | undefined;
  #ownedInvalid = false;
  constructor(scope: BrokerScope, readonly workerGeneration: string, readonly native: StopNativePort,
    readonly host: StopHostPort, readonly authorized: (page: PageIdentity, scope: BrokerScope) => boolean,
    readonly now: () => number = () => performance.now(), readonly owned?: OwnedStopCapability) {
    this.scope = Object.freeze(brokerScopeSchema.parse(scope));
    if (!workerGeneration || workerGeneration.length > 128) throw new Error("INVALID_WORKER_GENERATION");
  }

  attach(identity: PageIdentity): StopPage {
    for (const value of Object.values(identity)) {
      if (typeof value !== "string" || !value || value.length > 128) throw new Error("INVALID_STOP_PAGE");
    }
    if (!this.authorized(identity, this.scope) || this.#status === "ended") throw new Error("STOP_ACCESS_DENIED");
    const old = this.#pages.get(identity.clientId); if (old) this.disconnect(old);
    if (this.#pages.size >= 64) throw new Error("STOP_PAGE_LIMIT");
    const page = Object.freeze({ ...identity, generation: randomUUID() }); this.#pages.set(page.clientId, page); return page;
  }
  disconnect(page: StopPage): void {
    if (this.#pages.get(page.clientId) === page) this.#pages.delete(page.clientId);
    this.#drafts.delete(page); if (this.#offer?.page === page) this.#offer = undefined;
  }
  revokeCredential(credentialId: string): void {
    for (const page of this.#pages.values()) if (page.credentialId === credentialId) this.disconnect(page);
  }
  /** Host draft adapter reports current nonempty/newly edited draft; restoration never writes into it. */
  setDraftConflict(page: StopPage, conflict: boolean): void {
    if (!this.#current(page)) return;
    if (conflict) this.#drafts.add(page); else this.#drafts.delete(page);
  }
  state(page: StopPage): StopSnapshot {
    if (!this.#current(page)) return this.#snapshot("forbidden", empty(), false);
    this.#reconcile(); return this.#snapshot(this.#status, this.host.pending(), this.#drafts.has(page));
  }
  stop(page: StopPage): StopSnapshot {
    if (!this.#current(page)) return this.state(page);
    this.requestStop(); return this.state(page);
  }
  /** Broker expiry and ordinary Stop converge here; this method never calls Broker.requestStop. */
  requestStop(): void {
    if (this.#status !== "idle") return;
    this.#status = "stopping"; this.#started = this.now(); this.#settled = false;
    this.#controlsDone = false; this.#offer = undefined; this.#failures = []; this.#restored = null;
    this.#uiControlFailed = false;
    // Start cancellation synchronously. No held UI/summary response can prevent the other interrupt from dispatching.
    const ui = this.#control("ui-cancel-failed", () => this.host.beginStop());
    const summary = this.#control("summary-cancel-failed", () => this.native.abortBranchSummary());
    const queue = this.#control("queue-abort-failed", async () => {
      const result = await this.native.abortAndRestoreQueue();
      this.#restored = restoredQueueSchema.parse({ ...result, unsentOnly: true });
    });
    this.#controls = Promise.all([ui, summary, queue]).then(() => { this.#controlsDone = true; this.#reconcile(); });
  }
  /** Must be checked synchronously at the real input/history dispatch; rejected actions are never retained. */
  admitFreshAction(page: StopPage): boolean {
    this.#reconcile(); return this.#current(page) && this.#status === "idle" && this.#settled &&
      Object.values(this.host.pending()).every(value => value === 0);
  }
  observe(workerGeneration: string, event: StopObservation): void {
    if (workerGeneration !== this.workerGeneration || this.#status === "ended") return;
    if (event.kind === "settled") this.#settled = event.settled;
    if (event.kind === "eof" || event.kind === "ended") {
      this.#status = "unknown"; this.#settled = false; this.#offer = undefined;
    }
    this.#reconcile();
  }
  /** Called only with a validated response from the current worker's public get_state request. */
  observeState(workerGeneration: string, state: SessionState): void {
    if (this.scope.kind === "session" && this.scope.sessionId !== state.sessionId) return;
    const settled = state.isSettled === true && state.isStreaming === false && state.isCompacting === false &&
      state.hasPendingAsyncWork === false && state.queuedMessageCount === 0 &&
      state.queuedMessages?.steering.length === 0 && state.queuedMessages.followUp.length === 0;
    this.observe(workerGeneration, { kind: "settled", settled });
  }
  /** Typed validated public notification seam. An agent_end is intentionally absent. */
  observeNotification(workerGeneration: string, event: PromptResultEvent | SessionSettledEvent): void {
    this.observe(workerGeneration, { kind: "settled",
      settled: event.type === "session_settled" || event.sessionSettled });
  }
  offerForce(page: StopPage): ForceOffer {
    this.#reconcile();
    if (!this.#current(page)) return { status: "stale" };
    if (!this.#forceAvailable()) return { status: "unavailable" };
    this.#offer = { token: randomUUID(), page, expires: this.now() + 60_000 };
    return { status: "offered", token: this.#offer.token, expiresInMs: 60_000 };
  }
  async confirmForce(page: StopPage, token: string): Promise<{ status: "stale" | "ended" | "unknown" }> {
    this.#reconcile(); const offer = this.#offer;
    if (offer && this.now() >= offer.expires) this.#offer = undefined;
    if (!offer || offer.token !== token || offer.page !== page || this.now() >= offer.expires ||
      !this.#current(page) || !this.#forceAvailable() || !this.owned) return { status: "stale" };
    this.#offer = undefined; this.#status = "terminating"; // Consume before any asynchronous termination.
    try {
      const result = await this.owned.terminateAndReap();
      this.#status = result === "reaped" ? "ended" : "unknown";
    } catch { this.#status = "unknown"; }
    if (this.#status === "unknown") this.#failures.push("termination-unknown");
    return this.#current(page) ? { status: this.#status } : { status: "stale" };
  }
  async drain(): Promise<void> { await this.#controls; }
  close(): void { this.#status = "ended"; this.#pages.clear(); this.#drafts.clear(); this.#offer = undefined; }
  #current(page: StopPage): boolean {
    if (this.#pages.get(page.clientId) !== page) return false;
    if (this.authorized(page, this.scope)) return true;
    this.disconnect(page); return false;
  }
  #forceAvailable(): boolean {
    if (this.owned && !this.#ownedInvalid) {
      try { this.#ownedInvalid = !this.owned.isCurrent(); } catch { this.#ownedInvalid = true; }
      if (this.#ownedInvalid) this.#offer = undefined;
    }
    return this.#status === "stopping" && this.now() - this.#started >= 30_000 &&
      !this.#ownedInvalid && this.owned?.workerGeneration === this.workerGeneration;
  }
  #reconcile(): void {
    if (this.#status !== "stopping") return;
    if (this.host.cancellationUncertain()) {
      if (!this.#failures.includes("ui-cancel-failed")) this.#failures.push("ui-cancel-failed");
    } else if (this.#controlsDone && !this.#uiControlFailed) {
      this.#failures = this.#failures.filter(failure => failure !== "ui-cancel-failed");
    }
    if (!this.#settled || !this.#controlsDone || this.#failures.length) return;
    if (Object.values(this.host.pending()).some(value => value !== 0)) return;
    try { this.host.resume(); } catch {
      this.#uiControlFailed = true; this.#failures.push("ui-cancel-failed"); return;
    }
    this.#status = "idle"; this.#offer = undefined;
  }
  async #control(failure: StopSnapshot["failures"][number], action: () => Promise<void>): Promise<void> {
    try { await action(); } catch (error) {
      if (failure === "ui-cancel-failed") this.#uiControlFailed = !(error instanceof InteractionCancellationUnknownError);
      if (!this.#failures.includes(failure)) this.#failures.push(failure);
    }
  }
  #snapshot(status: StopSnapshot["status"], pending: StopSnapshot["pending"], draftConflict: boolean): StopSnapshot {
    return { generation: this.generation, workerGeneration: this.workerGeneration, scope: this.scope, status,
      nativeSettled: status === "forbidden" ? false : this.#settled,
      acceptingWork: status === "idle" && this.#settled && Object.values(pending).every(value => value === 0), pending,
      failures: status === "forbidden" ? [] : [...this.#failures], forceAvailable: status !== "forbidden" && this.#forceAvailable(),
      restored: status === "forbidden" ? null : structuredClone(this.#restored), draftConflict };
  }
}
