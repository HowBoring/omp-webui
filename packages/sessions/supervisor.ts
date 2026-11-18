import * as fs from "node:fs";
import { randomUUID } from "node:crypto";
import type { BrowserAccess, BrowserAuthority } from "../access/index.ts";
import { sameNativeSession } from "../contracts/catalog-identity.ts";
import type { CatalogClient } from "../contracts/generated/catalog-client.ts";
import type { CatalogDescriptor, StrictStartState, SessionState } from "../contracts/generated/omp-wire.ts";
import { isNativeSessionErrorCode, sessionFailureCode } from "../contracts/session-errors.ts";
import type { UIAnswer } from "../contracts/interactions.ts";
import type { DirectoryGrants } from "../workspaces/grants.ts";
import type { SessionWorker } from "../compatibility/session-worker.ts";
import type { DrainPolicy, DrainResult } from "../compatibility/stdio-transport.ts";
import { InteractionBridge } from "../interactions/bridge.ts";
import { LiveJournal } from "../projection/live-journal.ts";
import { SessionIndex, type RegisteredSession, type SessionAttempt } from "./index.ts";

/** Public native adapter port; concrete workers and deterministic public-RPC fixtures share this boundary. */
export type SupervisedSessionWorker = Pick<SessionWorker, keyof SessionWorker>;
interface Options {
  authority: BrowserAuthority; grants: DirectoryGrants; index: SessionIndex; catalog: CatalogClient;
  launch(cwd: string): Promise<SupervisedSessionWorker>;
}
export interface SessionView {
  registration: RegisteredSession; workerId: string; generation: string; cwd: string;
  state: "opening" | "open" | "outcome_unknown" | "closed";
}
interface UnresolvedWorkerDrain {
  status: "unresolved";
  code?: number;
  failure: "SESSION_WORKER_DRAIN_UNAVAILABLE" | "SESSION_WORKER_LAUNCH_UNRESOLVED"
    | "SESSION_WORKER_LAUNCH_REJECTED_UNCONFIRMED";
}
interface NoWorkerDrain {
  status: "not-launched";
  code?: never;
}

export interface WorkerExit {
  workerId: string; reason: string; elapsedMs: number; nativeSettled: boolean; queuedInputsWithdrawn: boolean;
  uiCancelled: boolean; indexFailure?: "SESSION_ATTEMPT_UNAVAILABLE"; drain: DrainResult | UnresolvedWorkerDrain | NoWorkerDrain;
  notificationCount: number; tailNotifications: number;
  /** The handle was unavailable at Stop, so its counter cannot account for pre-handle notifications. */
  tailNotificationsLowerBound?: true;
}
type LaunchResult = { status: "ready"; worker: SupervisedSessionWorker; settledAt: number }
  | { status: "rejected"; error: unknown; settledAt: number };
interface Active {
  id: string; key: string; cwd: string; cwdIdentity: string; generation: string; selected?: CatalogDescriptor; record?: RegisteredSession;
  opening: Promise<void>; launching?: Promise<LaunchResult>; worker?: SupervisedSessionWorker; bridge?: InteractionBridge; state: SessionView["state"];
  journal?: Promise<LiveJournal>; journalValue?: LiveJournal;
  retired: boolean; exited: boolean; released: boolean; stopping?: Promise<WorkerExit>; startupAttempted: boolean;
  exitIndexFailure?: WorkerExit["indexFailure"];
  exitCode?: number;
  cooperativeDeadline?: number;
}
const directoryIdentity = (cwd: string): string => {
  try {
    const stat = fs.statSync(cwd, { bigint: true });
    if (stat.isDirectory()) return `${stat.dev}:${stat.ino}:${stat.birthtimeNs}`;
  } catch {}
  throw new Error("SESSION_CWD_CHANGED");
};
const observedEOF = (drain: DrainResult): boolean => drain.stdoutEOF === true && drain.stderrEOF === true;
const cleanDrain = (drain: DrainResult): boolean =>
  drain.code === 0 && !drain.forced && !drain.protocolFailure && observedEOF(drain);
const terminationGraceMs = 5_000;
const readerGraceMs = 1_000;
const remainingTerminationGrace = (deadline: number, now: number) =>
  Math.min(terminationGraceMs, Math.max(0, deadline - now));
async function beforeDeadline<T>(operation: Promise<T>, deadline: number): Promise<T | undefined> {
  const delay = Math.ceil(deadline - performance.now());
  if (delay <= 0) return;
  let timer: Timer | undefined;
  const timeout = new Promise<undefined>(resolve => { timer = setTimeout(resolve, delay, undefined); });
  try { return await Promise.race([operation, timeout]); }
  finally { clearTimeout(timer); }
}
const key = (item: CatalogDescriptor) => JSON.stringify([item.sourceId, item.instanceId, item.nativeSessionId]);
export function nativeSettled(state: SessionState): boolean {
  return state.isSettled === true && state.isStreaming === false && state.isCompacting === false
    && state.hasPendingAsyncWork === false && state.queuedMessageCount === 0
    && state.queuedMessages?.steering.length === 0 && state.queuedMessages.followUp.length === 0;
}

/** One active top-level worker. Views are disposable; only explicit native references survive Host loss. */
export class SessionSupervisor {
  #active: Active | undefined;
  #closed = false;
  #exits: WorkerExit[] = [];
  #starts = 0;
  #sweeper: Timer;
  constructor(readonly options: Options) {
    this.#sweeper = setInterval(() => { void this.permissionsChanged().catch(() => {}); }, 1000);
    this.#sweeper.unref();
  }
  #browser(identity: BrowserAccess): void {
    if (this.#closed) throw new Error("SESSION_HOST_CLOSING");
    if (!this.options.authority.revalidate(identity)) throw new Error("SESSION_AUTH_REQUIRED");
  }
  #directory(cwd: string): void {
    if (this.options.grants.authorize(cwd, cwd).status !== "authorized") throw new Error("SESSION_DIRECTORY_DENIED");
  }
  #current(identity: BrowserAccess, active: Active): void {
    this.#browser(identity); this.#ownedCurrent(active);
  }
  #ownedCurrent(active: Active): void {
    if (this.#closed) throw new Error("SESSION_HOST_CLOSING");
    this.#directory(active.cwd);
    if (directoryIdentity(active.cwd) !== active.cwdIdentity) throw new Error("SESSION_CWD_CHANGED");
    if (active !== this.#active || active.retired || active.exited) throw new Error("SESSION_MANUAL_OPEN_REQUIRED");
  }
  get starts(): number { return this.#starts; }
  /** The reserved slot survives until authoritative cleanup, including a launcher with an unknown outcome. */
  get hasOwnedReservation(): boolean { return this.#active !== undefined && !this.#active.released; }
  exits(): WorkerExit[] { return structuredClone(this.#exits); }
  #appendExit(exit: WorkerExit): WorkerExit {
    this.#exits.push(exit);
    if (this.#exits.length > 32) this.#exits.shift();
    return exit;
  }
  #observe(active: Active, attempt: SessionAttempt): void {
    if (!active.record) return;
    const observed = this.options.index.observeCurrent(active.record, attempt);
    if (observed) active.record = observed;
  }
  #observeExit(active: Active, attempt: SessionAttempt, openOnly = false): WorkerExit["indexFailure"] {
    try {
      if (openOnly && active.record && this.options.index.get(active.record.id)?.attempt.state !== "open") return;
      this.#observe(active, attempt);
    }
    catch { return "SESSION_ATTEMPT_UNAVAILABLE"; }
  }
  async open(identity: BrowserAccess, selected: CatalogDescriptor): Promise<SessionView> {
    this.#browser(identity);
    const record = this.options.index.register(selected); // durable before describe/start, including later rejection
    const existing = this.#active;
    if (existing && !existing.exited && !existing.retired) {
      if (existing.key !== key(selected)) {
        this.options.index.observe(record.id, { state: "failed", code: "SESSION_SWITCH_REQUIRES_EXPLICIT_ACTION" });
        throw new Error("SESSION_SWITCH_REQUIRES_EXPLICIT_ACTION");
      }
      await existing.opening; this.#current(identity, existing);
      if (existing.worker) {
        const observed = await existing.worker.startup.state(); this.#current(identity, existing); this.#accept(existing, observed, record);
      }
      return this.#view(existing);
    }
    const active = this.#reserve(selected, record);
    active.opening = this.#perform(identity, active, "continue");
    await active.opening; this.#current(identity, active); return this.#view(active);
  }
  #reserve(selected: CatalogDescriptor, record: RegisteredSession): Active {
    try {
      const existing = this.#active;
      if (existing && !existing.released) throw new Error("SESSION_WORKER_DRAINING");
      const cwd = selected.cwd.status === "known" ? selected.cwd.canonical : undefined;
      if (!cwd) throw new Error("SESSION_CWD_UNKNOWN");
      const active: Active = { id: randomUUID(), key: key(selected), cwd, cwdIdentity: directoryIdentity(cwd), generation: randomUUID(), selected, record,
        opening: Promise.resolve(), state: "opening", retired: false, exited: false, released: false, startupAttempted: false };
      this.#active = active; return active;
    } catch (error) {
      const code = sessionFailureCode(error);
      this.options.index.observe(record.id, { state: "failed", code });
      throw new Error(code);
    }
  }
  async create(identity: BrowserAccess, cwd: string): Promise<SessionView> {
    this.#browser(identity); this.#directory(cwd);
    await this.#prepareRetirement(identity, "explicit-new"); this.#browser(identity); this.#directory(cwd);
    if (this.#active && !this.#active.released) throw new Error("SESSION_WORKER_DRAINING");
    const active: Active = { id: randomUUID(), key: randomUUID(), cwd, cwdIdentity: directoryIdentity(cwd), generation: randomUUID(), opening: Promise.resolve(),
      state: "opening", retired: false, exited: false, released: false, startupAttempted: false };
    this.#active = active; active.opening = this.#perform(identity, active, "new");
    await active.opening; this.#current(identity, active); return this.#view(active);
  }
  #launch(active: Active): Promise<LaunchResult> {
    const owned = Promise.withResolvers<SupervisedSessionWorker>();
    const launch = owned.promise.then<LaunchResult, LaunchResult>(
      worker => ({ status: "ready", worker, settledAt: performance.now() }),
      (error: unknown) => ({ status: "rejected", error, settledAt: performance.now() }),
    );
    // Reserve the pending outcome before the adapter can throw or re-enter shutdown.
    active.launching = launch;
    ++this.#starts;
    try { owned.resolve(this.options.launch(active.cwd)); }
    catch (error) { owned.reject(error); }
    return launch;
  }
  async #perform(identity: BrowserAccess, active: Active, intent: "continue" | "new"): Promise<void> {
    const record = active.record;
    let launch: LaunchResult | undefined;
    try {
      if (record) this.#observe(active, { state: "opening" });
      this.#current(identity, active);
      if (active.selected) {
        const described = await this.options.catalog.describe(active.selected.reference); this.#current(identity, active);
        if (described.status !== "verified" || !described.item) throw new Error(`SESSION_NATIVE_${described.status.toUpperCase()}`);
        if (!sameNativeSession(described.item, active.selected)) throw new Error("SESSION_NATIVE_REPLACED");
        if (described.item.cwd.status !== "known" || described.item.cwd.canonical !== active.cwd) throw new Error("SESSION_CWD_CHANGED");
        if (described.item.ownership.state !== "free") throw new Error(described.item.ownership.state === "held"
          ? "SESSION_EXTERNAL_OWNER" : "SESSION_OWNERSHIP_UNKNOWN");
        active.selected = described.item;
      }
      this.#current(identity, active);
      launch = await this.#launch(active);
      if (launch.status === "rejected") throw launch.error;
      const { worker } = launch;
      active.worker = worker;
      delete active.launching;
      if (launch.settledAt < (active.cooperativeDeadline ?? Infinity)) active.bridge = new InteractionBridge(worker);
      void worker.exited.then(code => this.#workerExited(active, worker, code)).catch(() => {});
      this.#current(identity, active); active.startupAttempted = true;
      const result = await worker.startup.start({ intent, expectedCwd: active.cwd,
        ...(active.selected ? { reference: active.selected.reference } : {}) });
      this.#ownedCurrent(active); this.#accept(active, result);
    } catch (error) {
      const failure = sessionFailureCode(error);
      // The original shutdown owns cleanup and the last durable observation after the launch deadline.
      if (launch && launch.settledAt >= (active.cooperativeDeadline ?? Infinity)) throw new Error(failure);
      const code = active.startupAttempted && (active.retired || ["SESSION_HOST_CLOSING", "SESSION_DIRECTORY_DENIED",
        "SESSION_CWD_CHANGED", "SESSION_MANUAL_OPEN_REQUIRED"].includes(failure)) ? "SESSION_OPEN_RETIRED_OUTCOME_UNKNOWN" : failure;
      active.state = "outcome_unknown";
      const unknown = launch?.status === "rejected" || code.startsWith("RPC_") || code.includes("UNKNOWN") || code.includes("LOST");
      let recorded = true;
      try {
        this.#observe(active, { state: unknown ? "outcome_unknown" : "failed", code });
      } catch { recorded = false; }
      // An uncertain result is observed manually, never retried. A definite refusal releases only our worker.
      if (!active.worker || !unknown || active.retired) await this.#stop(active, "open-failed");
      throw new Error(recorded ? code : "SESSION_ATTEMPT_UNAVAILABLE");
    }
  }
  async #workerExited(active: Active, worker: SupervisedSessionWorker, code: number): Promise<void> {
    active.exited = true;
    active.exitCode = code;
    if (active.retired) return;
    active.state = "outcome_unknown";
    const start = performance.now(), atExit = worker.notificationCount;
    const indexFailure = this.#observeExit(active, {
      state: "outcome_unknown", code: "SESSION_WORKER_LOST_MANUAL_OPEN_REQUIRED",
    });
    if (indexFailure) active.exitIndexFailure = indexFailure;
    // Root exit fences the generation immediately. Keep the slot until the same handle's readers finish.
    let drain: WorkerExit["drain"];
    try {
      const retired = await worker.retireIdle(0);
      drain = retired.status === "pending" ? await retired.completion : retired.drain;
      if (active.stopping) return;
      active.released = observedEOF(drain);
    } catch {
      drain = { status: "unresolved", code, failure: "SESSION_WORKER_DRAIN_UNAVAILABLE" };
    }
    this.#appendExit({ workerId: active.id, reason: "worker-lost", elapsedMs: performance.now() - start,
      nativeSettled: false, queuedInputsWithdrawn: false, uiCancelled: false, ...(indexFailure ? { indexFailure } : {}),
      drain, notificationCount: worker.notificationCount, tailNotifications: Math.max(0, worker.notificationCount - atExit) });
  }
  #accept(active: Active, result: StrictStartState, explicitAttempt?: RegisteredSession): void {
    if (result.phase !== "open") {
      const code = result.code && isNativeSessionErrorCode(result.code) ? result.code : "SESSION_OPEN_NOT_CONFIRMED";
      active.state = "outcome_unknown";
      this.#observe(active, { state: "outcome_unknown", code });
      throw new Error(code);
    }
    const binding = result.binding;
    if (!binding || result.cwd !== active.cwd || binding.cwd.canonical !== active.cwd
      || binding.ownership.state !== "held" || result.nativeSessionId !== binding.nativeSessionId
      || (active.selected && !sameNativeSession(binding, active.selected))) throw new Error("SESSION_FINAL_BINDING_REJECTED");
    active.key = key(binding);
    const registered = this.options.index.register(binding);
    active.record ??= registered;
    // Only this explicit Open may reclaim its captured attempt; lifecycle observations keep their owned revision.
    const observed = this.options.index.observeCurrent(explicitAttempt ?? active.record, { state: "open" });
    if (observed) active.record = observed;
    active.state = "open";
    active.bridge!.bindSession(binding.nativeSessionId);
  }
  #view(active: Active): SessionView {
    if (!active.record) throw new Error("SESSION_NATIVE_IDENTITY_UNCONFIRMED");
    return { registration: this.options.index.get(active.record.id)!, workerId: active.id,
      generation: active.generation, cwd: active.cwd, state: active.state };
  }
  /** Refresh attaches only to a surviving worker; startup/restart never calls Open implicitly. */
  view(identity: BrowserAccess, workerId: string): SessionView {
    this.#browser(identity); const active = this.#active;
    if (!active || active.id !== workerId) throw new Error("SESSION_MANUAL_OPEN_REQUIRED");
    this.#current(identity, active); return this.#view(active);
  }
  interactions(identity: BrowserAccess) {
    this.#browser(identity); const active = this.#active;
    if (!active) return undefined; this.#current(identity, active); return active.bridge?.snapshot();
  }
  async answer(identity: BrowserAccess, generation: string, id: string, answer: UIAnswer) {
    this.#browser(identity); const active = this.#active;
    if (!active?.bridge) throw new Error("SESSION_INTERACTION_UNAVAILABLE"); this.#current(identity, active);
    const result = await active.bridge.answer(generation, id, answer); this.#current(identity, active); return result;
  }
  async recheck(identity: BrowserAccess): Promise<SessionView> {
    this.#browser(identity); const active = this.#active;
    if (!active?.worker) throw new Error("SESSION_MANUAL_OPEN_REQUIRED"); this.#current(identity, active);
    const result = await active.worker.startup.state(); this.#current(identity, active);
    this.#accept(active, result); return this.#view(active);
  }
  async switchTo(identity: BrowserAccess, selected: CatalogDescriptor): Promise<SessionView> {
    this.#browser(identity);
    if (selected.cwd.status !== "known" || !selected.cwd.canonical) throw new Error("SESSION_CWD_UNKNOWN");
    this.#directory(selected.cwd.canonical);
    if (this.#active?.key === key(selected) && !this.#active.retired && !this.#active.exited) return this.open(identity, selected);
    await this.#prepareRetirement(identity, "explicit-switch"); this.#browser(identity); return this.open(identity, selected);
  }
  async #prepareRetirement(identity: BrowserAccess, reason: string): Promise<void> {
    const active = this.#active; if (!active || active.released) return;
    if (active.exited && !active.retired) throw new Error("SESSION_WORKER_DRAINING");
    if (active.retired || !active.worker || active.state !== "open") throw new Error("SESSION_WORKER_BUSY_STOP_REQUIRED");
    this.#current(identity, active);
    const state = await active.worker.state(); this.#current(identity, active);
    if (!nativeSettled(state) || active.bridge?.snapshot().pending.length) throw new Error("SESSION_WORKER_BUSY_STOP_REQUIRED");
    active.retired = true; active.state = "outcome_unknown";
    this.#observe(active, { state: "outcome_unknown", code: "SESSION_IDLE_EXIT_UNCONFIRMED_PENDING_48" });
    const start = performance.now(), atStop = active.worker.notificationCount;
    const retired = await active.worker.retireIdle();
    if (retired.status === "pending") {
      void retired.completion.then(drain => this.#finishIdle(active, reason, start, atStop, drain)).catch(() => {});
      throw new Error("SESSION_IDLE_EXIT_UNCONFIRMED_PENDING_48");
    }
    this.#finishIdle(active, reason, start, atStop, retired.drain);
  }
  #finishIdle(active: Active, reason: string, start: number, notificationsAtStop: number, drain: DrainResult): void {
    if (active.stopping) return;
    active.exited = true; active.released = observedEOF(drain);
    active.state = active.released ? "closed" : "outcome_unknown"; active.bridge?.dispose();
    const clean = cleanDrain(drain);
    const indexFailure = this.#observeExit(active, { state: clean ? "closed" : "outcome_unknown",
      ...(clean ? {} : { code: "SESSION_IDLE_EXIT_UNCONFIRMED_PENDING_48" }) });
    this.#appendExit({ workerId: active.id, reason, elapsedMs: performance.now() - start, nativeSettled: true,
      queuedInputsWithdrawn: false, uiCancelled: true, ...(indexFailure ? { indexFailure } : {}),
      drain, notificationCount: active.worker?.notificationCount ?? 0,
      tailNotifications: Math.max(0, (active.worker?.notificationCount ?? 0) - notificationsAtStop) });
  }
  assertObjectAccess(identity: BrowserAccess): void {
    this.#browser(identity); const active = this.#active;
    if (!active) throw new Error("SESSION_MANUAL_OPEN_REQUIRED"); this.#current(identity, active);
  }
  async listed(identity: BrowserAccess): Promise<{ view: SessionView; running: boolean; blank: boolean } | undefined> {
    this.#browser(identity); const active = this.#active;
    if (!active?.worker || active.state !== "open" || active.retired || active.exited) return undefined;
    this.#current(identity, active); const state = await active.worker.state(); this.#current(identity, active);
    const journal = await this.presentation(identity, active.record!.nativeSessionId); this.#current(identity, active);
    return { view: this.#view(active), running: !nativeSettled(state), blank: journal.cursor < 0 };
  }
  async presentation(identity: BrowserAccess, sessionId: string): Promise<LiveJournal> {
    this.#browser(identity); const active = this.#active;
    if (!active?.worker || active.state !== "open" || active.record?.nativeSessionId !== sessionId) {
      throw new Error("SESSION_MANUAL_OPEN_REQUIRED");
    }
    this.#current(identity, active);
    active.journal ??= LiveJournal.open(active.worker.history);
    const journal = await active.journal; this.#current(identity, active); active.journalValue = journal;
    if (journal.sessionId !== sessionId || journal.failure) throw new Error("SESSION_PRESENTATION_INVALIDATED"); return journal;
  }
  requirePresentation(identity: BrowserAccess, sessionId: string, journal: LiveJournal): void {
    const active = this.#active;
    if (!active || active.record?.nativeSessionId !== sessionId || active.journalValue !== journal) {
      throw new Error("SESSION_PRESENTATION_INVALIDATED");
    }
    this.#current(identity, active);
  }
  async pollPresentation(identity: BrowserAccess, sessionId: string, journal: LiveJournal): Promise<void> {
    const active = this.#active;
    if (!active?.worker || active.record?.nativeSessionId !== sessionId) throw new Error("SESSION_MANUAL_OPEN_REQUIRED");
    this.requirePresentation(identity, sessionId, journal);
    const poll = await active.worker.history.poll(journal.opened.cut.workerId, journal.after); this.requirePresentation(identity, sessionId, journal);
    journal.accept(poll);
  }
  /** Recompute overlapping root grants. Browser logout withdraws only that browser's view/answer rights. */
  async permissionsChanged(): Promise<void> {
    const active = this.#active; if (!active || active.stopping || active.released) return;
    let authorized = false;
    try { authorized = this.options.grants.authorize(active.cwd, active.cwd).status === "authorized"
      && directoryIdentity(active.cwd) === active.cwdIdentity; } catch {}
    if (!authorized) await this.#stop(active, "directory-revoked");
  }
  async revokeAll(): Promise<void> {
    this.#closed = true; clearInterval(this.#sweeper);
    if (this.#active && !this.#active.released) await this.#stop(this.#active, "all-browser-access-revoked");
  }
  async close(): Promise<void> {
    this.#closed = true; clearInterval(this.#sweeper);
    if (this.#active && !this.#active.released) await this.#stop(this.#active, "host-shutdown");
  }
  #stop(active: Active, reason: string): Promise<WorkerExit> {
    active.retired = true;
    return active.stopping ??= this.#drain(active, reason);
  }
  async #drain(active: Active, reason: string): Promise<WorkerExit> {
    const start = performance.now(), deadline = start + 30_000;
    if (active.worker) return this.#drainWorker(active, active.worker, reason, start, deadline, active.worker.notificationCount);
    if (active.launching) {
      active.cooperativeDeadline = deadline;
      return this.#drainStarting(active, active.launching, reason, start, deadline);
    }
    active.released = true;
    active.state = "closed";
    return this.#appendExit({ workerId: active.id, reason, elapsedMs: performance.now() - start,
      nativeSettled: false, queuedInputsWithdrawn: false, uiCancelled: false, drain: { status: "not-launched" },
      notificationCount: 0, tailNotifications: 0 });
  }
  async #closeWorker(active: Active, worker: SupervisedSessionWorker, policy: DrainPolicy): Promise<DrainResult | UnresolvedWorkerDrain> {
    try {
      const drain = await worker.close(policy);
      active.exited = true;
      active.released = observedEOF(drain);
      active.state = active.released ? "closed" : "outcome_unknown";
      return drain;
    } catch {
      active.state = "outcome_unknown";
      return { status: "unresolved", failure: "SESSION_WORKER_DRAIN_UNAVAILABLE",
        ...(active.exitCode === undefined ? {} : { code: active.exitCode }) };
    }
  }
  async #drainWorker(active: Active, worker: SupervisedSessionWorker, reason: string,
    start: number, deadline: number, notificationsAtStop?: number): Promise<WorkerExit> {
    const alreadyExited = active.exited;
    let settled = false, queuedInputsWithdrawn = false, uiCancelled = false;
    const priorUIOutcomes = new Set(active.bridge?.snapshot().outcomes.map(outcome => outcome.id) ?? []);
    const cooperative = async () => {
      const pending = active.bridge?.snapshot().pending ?? [];
      await Promise.allSettled(pending.map(card => active.bridge!.answer(active.bridge!.generation, card.id, { type: "cancel" })));
      uiCancelled = pending.length === 0 || active.bridge?.snapshot().pending.length === 0;
      if (active.state !== "open" && active.startupAttempted) await worker.startup.cancel().catch(() => {});
      await Promise.allSettled([worker.control("abort_branch_summary"), worker.control("abort_retry"), worker.control("abort_bash"),
        worker.control("abort_and_restore_queue").then(() => { queuedInputsWithdrawn = true; })]);
      const state = await worker.state(); settled = nativeSettled(state);
    };
    if (!alreadyExited && performance.now() < deadline) await beforeDeadline(cooperative().catch(() => {}), deadline);
    const ui = active.bridge?.snapshot();
    uiCancelled = uiCancelled && (!ui || (ui.pending.length === 0 && !ui.outcomes.some(outcome =>
      !priorUIOutcomes.has(outcome.id) && ["unknown", "answered", "stale"].includes(outcome.status))));
    active.bridge?.dispose();
    const now = performance.now();
    const drain = await this.#closeWorker(active, worker, { cooperativeMs: alreadyExited ? 0 : Math.max(0, deadline - now),
      terminationGraceMs: remainingTerminationGrace(deadline + terminationGraceMs, now), readerGraceMs });
    const clean = !alreadyExited && !("status" in drain) && cleanDrain(drain);
    const indexFailure = this.#observeExit(active, { state: clean ? "closed" : "outcome_unknown",
      ...(clean ? {} : { code: "SESSION_EXIT_OUTCOME_UNKNOWN" }) }, true) ?? active.exitIndexFailure;
    return this.#appendExit({ workerId: active.id, reason, elapsedMs: performance.now() - start, nativeSettled: settled,
      queuedInputsWithdrawn, uiCancelled, ...(indexFailure ? { indexFailure } : {}), drain, notificationCount: worker.notificationCount,
      tailNotifications: Math.max(0, worker.notificationCount - (notificationsAtStop ?? 0)),
      ...(notificationsAtStop === undefined ? { tailNotificationsLowerBound: true } : {}) });
  }
  async #drainStarting(active: Active, launch: Promise<LaunchResult>, reason: string,
    start: number, deadline: number): Promise<WorkerExit> {
    const first = await beforeDeadline(launch, deadline);
    if (first?.status === "ready" && first.settledAt < deadline) {
      return this.#drainWorker(active, first.worker, reason, start, deadline);
    }
    active.state = "outcome_unknown";
    const indexFailure = this.#observeExit(active, { state: "outcome_unknown", code: "SESSION_EXIT_OUTCOME_UNKNOWN" });
    const forceDeadline = deadline + terminationGraceMs;
    const result = first ?? await beforeDeadline(launch, forceDeadline);
    const unresolved: WorkerExit = { workerId: active.id, reason, elapsedMs: performance.now() - start,
      nativeSettled: false, queuedInputsWithdrawn: false, uiCancelled: false, ...(indexFailure ? { indexFailure } : {}),
      drain: { status: "unresolved", failure: "SESSION_WORKER_LAUNCH_UNRESOLVED" },
      notificationCount: 0, tailNotifications: 0, tailNotificationsLowerBound: true };
    if (result && result.settledAt < forceDeadline) {
      return this.#finishLateLaunch(active, result, unresolved, start, forceDeadline);
    }
    // The Session Index may close after this bounded observation. The continuation only touches this reservation.
    void launch.then(result => this.#finishLateLaunch(active, result, unresolved, start, forceDeadline)).catch(() => {});
    return this.#appendExit(unresolved);
  }
  async #finishLateLaunch(active: Active, launch: LaunchResult, observation: WorkerExit,
    start: number, forceDeadline: number): Promise<WorkerExit> {
    let drain: WorkerExit["drain"];
    if (launch.status === "rejected") {
      // Negotiation can fail after spawn and a launcher rejection does not attest that its readers drained.
      drain = { status: "unresolved", failure: "SESSION_WORKER_LAUNCH_REJECTED_UNCONFIRMED" };
    } else {
      drain = await this.#closeWorker(active, launch.worker, { cooperativeMs: 0,
        terminationGraceMs: remainingTerminationGrace(forceDeadline, performance.now()), readerGraceMs });
    }
    const notificationCount = launch.status === "ready" ? launch.worker.notificationCount : 0;
    return this.#appendExit({ ...observation, drain, elapsedMs: performance.now() - start, notificationCount,
      tailNotifications: notificationCount });
  }
}
