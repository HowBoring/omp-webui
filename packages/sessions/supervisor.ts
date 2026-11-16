import * as fs from "node:fs";
import { randomUUID } from "node:crypto";
import type { BrowserAccess, BrowserAuthority } from "../access/index.ts";
import type { CatalogClient } from "../contracts/generated/catalog-client.ts";
import type { CatalogDescriptor, StrictStartState, SessionState } from "../contracts/generated/omp-wire.ts";
import type { UIAnswer } from "../contracts/interactions.ts";
import type { DirectoryGrants } from "../workspaces/grants.ts";
import type { SessionWorker } from "../compatibility/session-worker.ts";
import type { DrainResult } from "../compatibility/stdio-transport.ts";
import { InteractionBridge } from "../interactions/bridge.ts";
import { LiveJournal } from "../projection/live-journal.ts";
import { SessionIndex, type RegisteredSession } from "./index.ts";

interface Options {
  authority: BrowserAuthority; grants: DirectoryGrants; index: SessionIndex; catalog: CatalogClient;
  launch(cwd: string): Promise<SessionWorker>;
}
export interface SessionView {
  registration: RegisteredSession; workerId: string; generation: string; cwd: string;
  state: "opening" | "open" | "outcome_unknown" | "closed";
}
export interface WorkerExit {
  workerId: string; reason: string; elapsedMs: number; nativeSettled: boolean; queuedInputsWithdrawn: boolean;
  uiCancelled: boolean; drain: DrainResult; notificationCount: number; tailNotifications: number;
}
interface Active {
  id: string; key: string; cwd: string; cwdIdentity: string; generation: string; selected?: CatalogDescriptor; record?: RegisteredSession;
  opening: Promise<void>; launching?: Promise<SessionWorker>; worker?: SessionWorker; bridge?: InteractionBridge; state: SessionView["state"];
  journal?: Promise<LiveJournal>; journalValue?: LiveJournal; retired: boolean; exited: boolean; idlePending?: boolean; stopping?: Promise<WorkerExit>; startupAttempted: boolean;
}
const same = (left: CatalogDescriptor, right: CatalogDescriptor) => left.sourceId === right.sourceId
  && left.instanceId === right.instanceId && left.nativeSessionId === right.nativeSessionId;
const directoryIdentity = (cwd: string): string => {
  const stat = fs.statSync(cwd, { bigint: true });
  if (!stat.isDirectory()) throw new Error("SESSION_CWD_CHANGED"); return `${stat.dev}:${stat.ino}:${stat.birthtimeNs}`;
};
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
  exits(): WorkerExit[] { return structuredClone(this.#exits); }
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
        const observed = await existing.worker.startup.state(); this.#current(identity, existing); this.#accept(existing, observed);
      }
      return this.#view(existing);
    }
    if (existing && (!existing.exited || existing.idlePending)) throw new Error("SESSION_WORKER_DRAINING");
    const cwd = selected.cwd.status === "known" ? selected.cwd.canonical : undefined;
    if (!cwd) {
      this.options.index.observe(record.id, { state: "failed", code: "SESSION_CWD_UNKNOWN" }); throw new Error("SESSION_CWD_UNKNOWN");
    }
    const active: Active = { id: randomUUID(), key: key(selected), cwd, cwdIdentity: directoryIdentity(cwd), generation: randomUUID(), selected, record,
      opening: Promise.resolve(), state: "opening", retired: false, exited: false, startupAttempted: false };
    this.#active = active;
    active.opening = this.#perform(identity, active, "continue");
    await active.opening; this.#current(identity, active); return this.#view(active);
  }
  async create(identity: BrowserAccess, cwd: string): Promise<SessionView> {
    this.#browser(identity); this.#directory(cwd);
    await this.#prepareRetirement(identity, "explicit-new"); this.#browser(identity); this.#directory(cwd);
    if (this.#active && (!this.#active.exited || this.#active.idlePending)) throw new Error("SESSION_WORKER_DRAINING");
    const active: Active = { id: randomUUID(), key: randomUUID(), cwd, cwdIdentity: directoryIdentity(cwd), generation: randomUUID(), opening: Promise.resolve(),
      state: "opening", retired: false, exited: false, startupAttempted: false };
    this.#active = active; active.opening = this.#perform(identity, active, "new");
    await active.opening; this.#current(identity, active); return this.#view(active);
  }
  async #perform(identity: BrowserAccess, active: Active, intent: "continue" | "new"): Promise<void> {
    const record = active.record;
    if (record) this.options.index.observe(record.id, { state: "opening" });
    try {
      this.#current(identity, active);
      if (active.selected) {
        const described = await this.options.catalog.describe(active.selected.reference); this.#current(identity, active);
        if (described.status !== "verified" || !described.item) throw new Error(`SESSION_NATIVE_${described.status.toUpperCase()}`);
        if (!same(described.item, active.selected)) throw new Error("SESSION_NATIVE_REPLACED");
        if (described.item.cwd.status !== "known" || described.item.cwd.canonical !== active.cwd) throw new Error("SESSION_CWD_CHANGED");
        if (described.item.ownership.state !== "free") throw new Error(described.item.ownership.state === "held"
          ? "SESSION_EXTERNAL_OWNER" : "SESSION_OWNERSHIP_UNKNOWN");
        active.selected = described.item;
      }
      this.#current(identity, active);
      ++this.#starts; active.launching = this.options.launch(active.cwd);
      active.worker = await active.launching;
      active.bridge = new InteractionBridge(active.worker);
      void active.worker.exited.then(() => {
        active.exited = true;
        if (!active.retired) {
          active.state = "outcome_unknown";
          if (active.record) this.options.index.observe(active.record.id,
            { state: "outcome_unknown", code: "SESSION_WORKER_LOST_MANUAL_OPEN_REQUIRED" });
        }
      });
      this.#current(identity, active); active.startupAttempted = true;
      const result = await active.worker.startup.start({ intent, expectedCwd: active.cwd,
        ...(active.selected ? { reference: active.selected.reference } : {}) });
      this.#ownedCurrent(active); this.#accept(active, result);
    } catch (error) {
      const failure = error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message) ? error.message : "SESSION_OPEN_OUTCOME_UNKNOWN";
      const code = active.startupAttempted && (active.retired || ["SESSION_HOST_CLOSING", "SESSION_DIRECTORY_DENIED",
        "SESSION_CWD_CHANGED", "SESSION_MANUAL_OPEN_REQUIRED"].includes(failure)) ? "SESSION_OPEN_RETIRED_OUTCOME_UNKNOWN" : failure;
      active.state = "outcome_unknown";
      const unknown = code.startsWith("RPC_") || code.includes("UNKNOWN") || code.includes("LOST");
      if (active.record) this.options.index.observe(active.record.id, { state: unknown ? "outcome_unknown" : "failed", code });
      // An uncertain result is observed manually, never retried. A definite refusal releases only our worker.
      if (!active.worker || !unknown || active.retired) await this.#stop(active, "open-failed");
      throw new Error(code);
    }
  }
  #accept(active: Active, result: StrictStartState): void {
    if (result.phase !== "open") {
      const code = result.code && /^(STRICT|GENERATION)_[A-Z_]+$/.test(result.code) ? result.code : "SESSION_OPEN_NOT_CONFIRMED";
      active.state = "outcome_unknown";
      if (active.record) this.options.index.observe(active.record.id, { state: "outcome_unknown", code });
      throw new Error(code);
    }
    const binding = result.binding;
    if (!binding || result.cwd !== active.cwd || binding.cwd.canonical !== active.cwd
      || binding.ownership.state !== "held" || result.nativeSessionId !== binding.nativeSessionId
      || (active.selected && !same(binding, active.selected))) throw new Error("SESSION_FINAL_BINDING_REJECTED");
    active.key = key(binding); active.record = this.options.index.register(binding);
    this.options.index.observe(active.record.id, { state: "open" }); active.state = "open";
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
    const active = this.#active; if (!active || (active.exited && !active.idlePending)) return;
    if (active.retired || !active.worker || active.state !== "open") throw new Error("SESSION_WORKER_BUSY_STOP_REQUIRED");
    this.#current(identity, active);
    const state = await active.worker.state(); this.#current(identity, active);
    if (!nativeSettled(state) || active.bridge?.snapshot().pending.length) throw new Error("SESSION_WORKER_BUSY_STOP_REQUIRED");
    active.retired = true; active.idlePending = true; active.state = "outcome_unknown";
    if (active.record) this.options.index.observe(active.record.id,
      { state: "outcome_unknown", code: "SESSION_IDLE_EXIT_UNCONFIRMED_PENDING_48" });
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
    active.exited = true; active.idlePending = false; active.state = "closed"; active.bridge?.dispose();
    if (active.record) this.options.index.observe(active.record.id, { state: drain.code === 0 && !drain.protocolFailure ? "closed" : "outcome_unknown",
      ...(drain.code === 0 && !drain.protocolFailure ? {} : { code: "SESSION_IDLE_EXIT_UNCONFIRMED_PENDING_48" }) });
    this.#exits.push({ workerId: active.id, reason, elapsedMs: performance.now() - start, nativeSettled: true,
      queuedInputsWithdrawn: false, uiCancelled: true, drain, notificationCount: active.worker?.notificationCount ?? 0,
      tailNotifications: Math.max(0, (active.worker?.notificationCount ?? 0) - notificationsAtStop) });
    if (this.#exits.length > 32) this.#exits.shift();
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
    const active = this.#active; if (!active || active.stopping || (active.exited && !active.idlePending)) return;
    let authorized = false;
    try { authorized = this.options.grants.authorize(active.cwd, active.cwd).status === "authorized"
      && directoryIdentity(active.cwd) === active.cwdIdentity; } catch {}
    if (!authorized) await this.#stop(active, "directory-revoked");
  }
  async revokeAll(): Promise<void> {
    this.#closed = true; clearInterval(this.#sweeper);
    if (this.#active && (!this.#active.exited || this.#active.idlePending)) await this.#stop(this.#active, "all-browser-access-revoked");
  }
  async close(): Promise<void> {
    this.#closed = true; clearInterval(this.#sweeper);
    if (this.#active && (!this.#active.exited || this.#active.idlePending)) await this.#stop(this.#active, "host-shutdown");
  }
  #stop(active: Active, reason: string): Promise<WorkerExit> {
    active.retired = true;
    return active.stopping ??= this.#drain(active, reason);
  }
  async #drain(active: Active, reason: string): Promise<WorkerExit> {
    const start = performance.now(), deadline = start + 30_000, notificationsAtStop = active.worker?.notificationCount ?? 0;
    let settled = false, queuedInputsWithdrawn = false, uiCancelled = false;
    const priorUIOutcomes = new Set(active.bridge?.snapshot().outcomes.map(outcome => outcome.id) ?? []);
    const cooperative = async () => {
      const worker = active.worker ?? await active.launching; if (!worker) return;
      active.worker = worker;
      const pending = active.bridge?.snapshot().pending ?? [];
      await Promise.allSettled(pending.map(card => active.bridge!.answer(active.bridge!.generation, card.id, { type: "cancel" })));
      uiCancelled = pending.length === 0 || active.bridge?.snapshot().pending.length === 0;
      if (active.state !== "open" && active.startupAttempted) await worker.startup.cancel().catch(() => {});
      await Promise.allSettled([worker.control("abort_branch_summary"), worker.control("abort_retry"), worker.control("abort_bash"),
        worker.control("abort_and_restore_queue").then(() => { queuedInputsWithdrawn = true; })]);
      const state = await worker.state(); settled = nativeSettled(state);
    };
    let timer: Timer | undefined;
    const timeout = new Promise<void>(resolve => { timer = setTimeout(resolve, Math.max(0, deadline - performance.now())); });
    await Promise.race([cooperative().catch(() => {}), timeout]); if (timer) clearTimeout(timer);
    const ui = active.bridge?.snapshot();
    uiCancelled = uiCancelled && (!ui || (ui.pending.length === 0 && !ui.outcomes.some(outcome =>
      !priorUIOutcomes.has(outcome.id) && ["unknown", "answered", "stale"].includes(outcome.status))));
    active.bridge?.dispose();
    const remaining = Math.max(0, deadline - performance.now());
    const drain = active.worker ? await active.worker.close({ cooperativeMs: remaining, terminationGraceMs: 5000, readerGraceMs: 1000 })
      : { code: 0, forced: false, stderrBytes: 0 };
    active.exited = true; active.idlePending = false; active.state = "closed";
    if (active.record && this.options.index.get(active.record.id)?.attempt.state === "open") {
      this.options.index.observe(active.record.id, { state: drain.code === 0 && !drain.forced ? "closed" : "outcome_unknown",
        ...(drain.code === 0 && !drain.forced ? {} : { code: "SESSION_EXIT_OUTCOME_UNKNOWN" }) });
    }
    const exit: WorkerExit = { workerId: active.id, reason, elapsedMs: performance.now() - start, nativeSettled: settled,
      queuedInputsWithdrawn, uiCancelled, drain, notificationCount: active.worker?.notificationCount ?? 0,
      tailNotifications: Math.max(0, (active.worker?.notificationCount ?? 0) - notificationsAtStop) };
    this.#exits.push(exit); if (this.#exits.length > 32) this.#exits.shift(); return exit;
  }
}
