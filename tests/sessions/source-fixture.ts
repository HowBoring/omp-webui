/** Filesystem/SQLite and public native ports only. Never imports or executes a native worker. */
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openBrowserAccess } from "../../packages/access/index.ts";
import { DirectoryGrants } from "../../packages/workspaces/grants.ts";
import { SessionIndex } from "../../packages/sessions/index.ts";
import { SessionSupervisor, type SupervisedSessionWorker } from "../../packages/sessions/supervisor.ts";
import { CatalogClient } from "../../packages/contracts/generated/catalog-client.ts";
import { StrictStartClient } from "../../packages/contracts/generated/strict-client.ts";
import { HistoryClient } from "../../packages/contracts/generated/history-client.ts";
import validState from "../../packages/contracts/generated/strict-state.js";
import type { CatalogDescriptor, StrictStartState } from "../../packages/contracts/generated/omp-wire.ts";
import type { DrainResult, GracefulDrainResult } from "../../packages/compatibility/stdio-transport.ts";
import type { SessionWorkerFrame } from "../../packages/compatibility/session-worker.ts";

interface NativeFixtureControls {
  catalogFailure: unknown; busy: boolean; launches: number; closed: boolean;
  start(): Promise<StrictStartState>; observe(): Promise<StrictStartState>; launch(): Promise<void>;
  drain: DrainResult; retirement: GracefulDrainResult | undefined;
}

export async function sourceFixture(now: () => number = Date.now) {
  const home = await mkdtemp(join(tmpdir(), "session-source-")), cwd = join(home, "project"), dataDir = join(home, "state");
  await mkdir(cwd);
  const origin = "http://127.0.0.1:4321", authority = openBrowserAccess({ dataDir, origin });
  const grants = new DirectoryGrants(dataDir), index = new SessionIndex(dataDir, now);
  const grant = grants.confirm(grants.preview(cwd).confirmation);
  const selected: CatalogDescriptor = { sourceId: "source", instanceId: "instance", reference: "opaque-reference",
    nativeSessionId: "native-session", aliases: [], cwd: { status: "known", recorded: cwd, canonical: cwd },
    createdAt: "2026-11-16T00:00:00.000Z", modifiedAt: "2026-11-16T00:00:00.000Z",
    observedAt: "2026-11-16T00:00:00.000Z", ownership: { state: "free", observedAt: "2026-11-16T00:00:00.000Z" } };
  const other: CatalogDescriptor = { ...selected, instanceId: "other-instance", nativeSessionId: "other-session", reference: "other-reference" };
  const binding = { ...selected, ownership: { ...selected.ownership, state: "held" as const } };
  const opened: StrictStartState = { version: "strict-start-v1", phase: "open", intent: "continue", cwd,
    nativeSessionId: selected.nativeSessionId, binding };
  const listeners = new Set<(frame: SessionWorkerFrame) => void>();
  let exited: PromiseWithResolvers<number>;
  const controls: NativeFixtureControls = {
    catalogFailure: undefined, busy: false, launches: 0, closed: false,
    start: async (): Promise<StrictStartState> => opened,
    observe: async (): Promise<StrictStartState> => opened,
    launch: async (): Promise<void> => {},
    drain: { code: 0, forced: false, stderrBytes: 0 },
    retirement: undefined,
  };
  const worker: Omit<SupervisedSessionWorker, "exited" | "close"> = {
    frames: [{ type: "ready", interactionPolicy: { version: "1", explicitAnswersOnly: true, nativeExpiry: "cancel",
      toolExpiry: "cancel", invalidAnswer: "pending" } }], notificationCount: 0,
    startup: new StrictStartClient(async command => command.type === "strict_start" ? controls.start()
      : command.type === "get_strict_state" ? controls.observe() : opened,
      (value): value is StrictStartState => validState(value)),
    history: new HistoryClient(async () => { throw new Error("SYNTHETIC_HISTORY_UNUSED"); }),
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async command() { return { status: "answered" }; }, async control() { return {}; },
    async state() { return { sessionId: selected.nativeSessionId, isSettled: !controls.busy, isStreaming: controls.busy,
      isCompacting: false, hasPendingAsyncWork: false, queuedMessageCount: 0, queuedMessages: { steering: [], followUp: [] } }; },
    async retireIdle() { return controls.retirement ?? { status: "closed", drain: controls.drain }; },
  };
  const catalog = new CatalogClient(async command => {
    if (controls.catalogFailure !== undefined) throw controls.catalogFailure;
    return command.type === "describe_session"
    ? { status: "verified", observedAt: selected.observedAt, item: command.reference === other.reference ? other : selected }
    : { status: "complete", snapshot: "synthetic-snapshot", observedAt: selected.observedAt,
      expiresAt: "2099-11-16T00:00:00.000Z", examined: 2, failures: [], items: [selected, other] };
  });
  const supervisor = new SessionSupervisor({ authority, grants, index, catalog,
    async launch() {
      ++controls.launches; await controls.launch();
      const childExit = Promise.withResolvers<number>();
      exited = childExit;
      return { ...worker, exited: childExit.promise,
        async close() { controls.closed = true; childExit.resolve(controls.drain.code); return controls.drain; } };
    } });
  async function browser() {
    const exchange = await authority.handle(new Request(authority.bootstrapLink(), { headers: { host: "127.0.0.1:4321" } }));
    const cookie = exchange!.headers.get("set-cookie")!.split(";")[0]!;
    const identity = authority.admit(new Request(origin, { headers: { host: "127.0.0.1:4321", cookie } }), "read");
    if (identity instanceof Response) throw new Error("SYNTHETIC_LOGIN_FAILED");
    return { identity, cookie };
  }
  const browserView = await browser();
  return { home, cwd, dataDir, origin, authority, grants, grant, index, catalog, selected, other, supervisor, controls,
    ...browserView, browser,
    exitWorker(code: number) { exited.resolve(code); return exited.promise; },
    emit(frame: SessionWorkerFrame) { for (const listener of listeners) listener(frame); },
    async close() { await supervisor.close(); authority.close(); grants.close(); index.close(); await rm(home, { recursive: true, force: true }); } };
}
