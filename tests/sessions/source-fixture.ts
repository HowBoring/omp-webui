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
import type { CatalogDescriptor, ModelInfo, StrictStartState } from "../../packages/contracts/generated/omp-wire.ts";
import type { DrainPolicy, DrainResult, GracefulDrainResult } from "../../packages/compatibility/stdio-transport.ts";
import type { OwnedSessionConnection, SessionWorkerFrame } from "../../packages/compatibility/session-worker.ts";
import { SubmissionClient, isSubmissionResult } from "../../packages/contracts/submissions.ts";
import { AttachmentClient } from "../../packages/contracts/generated/attachment-client.ts";
import { NavigationClient } from "../../packages/contracts/generated/navigation-client.ts";
import { isAttachmentReceipt } from "../../packages/contracts/attachment-preparation.ts";

interface NativeFixtureControls {
  catalogFailure: unknown; busy: boolean; launches: number; closed: boolean; notificationCount: number;
  model: ModelInfo; thinkingLevel: "off" | "low" | "high";
  sessionId: string; sessionFile: string; branchPoints: { entryId: string; text: string }[];
  branchResult: { text: string; cancelled: boolean } | undefined; branchFailure: unknown;
  branchSessionId: string | undefined; branchParent: string;
  start(): Promise<StrictStartState>; observe(): Promise<StrictStartState>; launch(): Promise<void>;
  close(policy: DrainPolicy): Promise<DrainResult>; drain: DrainResult; retirement: GracefulDrainResult | Promise<GracefulDrainResult> | undefined;
}

export async function sourceFixture(now: () => number = Date.now,
  launchOwned?: (cwd: string, retirement: AbortSignal) => OwnedSessionConnection | Promise<OwnedSessionConnection>,
  history?: HistoryClient) {
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
    catalogFailure: undefined, busy: false, launches: 0, closed: false, notificationCount: 0,
    model: { provider: "synthetic", id: "fixture", name: "Fixture", api: "synthetic", baseUrl: "http://127.0.0.1/",
      reasoning: true, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128000, maxTokens: 4096, thinking: { mode: "effort", efforts: ["low", "high"] } },
    thinkingLevel: "off",
    sessionId: selected.nativeSessionId, sessionFile: "/synthetic/source.jsonl",
    branchPoints: [{ entryId: "entry-0", text: "Synthetic fixture input" }],
    branchResult: undefined, branchFailure: undefined, branchSessionId: undefined, branchParent: "/synthetic/source.jsonl",
    start: async (): Promise<StrictStartState> => opened,
    observe: async (): Promise<StrictStartState> => opened,
    launch: async (): Promise<void> => {},
    close: async () => controls.drain,
    drain: { code: 0, forced: false, stderrBytes: 0, stdoutEOF: true, stderrEOF: true },
    retirement: undefined,
  };
  const worker: Omit<SupervisedSessionWorker, "exited" | "close" | "notificationCount"> = {
    frames: [{ type: "ready", interactionPolicy: { version: "1", explicitAnswersOnly: true, nativeExpiry: "cancel",
      toolExpiry: "cancel", invalidAnswer: "pending" } }],
    startup: new StrictStartClient(async command => command.type === "strict_start" ? controls.start()
      : command.type === "get_strict_state" ? controls.observe() : opened,
      (value): value is StrictStartState => validState(value)),
    history: history ?? new HistoryClient(async () => { throw new Error("SYNTHETIC_HISTORY_UNUSED"); }),
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    submissions: new SubmissionClient(async () => { throw new Error("SYNTHETIC_SUBMISSION_UNUSED"); }, isSubmissionResult),
    attachments: new AttachmentClient(async () => { throw new Error("SYNTHETIC_ATTACHMENT_UNUSED"); }, isAttachmentReceipt),
    navigation: new NavigationClient(async () => { throw new Error("SYNTHETIC_NAVIGATION_UNUSED"); }, (_value): _value is never => false, (_value): _value is never => false),
    async submitCommand() { throw new Error("SYNTHETIC_SUBMISSION_UNUSED"); },
    async command() { return { status: "answered" }; }, async control() { return {}; },
    async steer() { throw new Error("UNUSED"); }, async followUp() { throw new Error("UNUSED"); },
    async setAskDialog() { return { enabled: true }; }, get readyPolicy(): unknown { return undefined; },
    async state() { return { sessionId: controls.sessionId, sessionFile: controls.sessionFile, isSettled: !controls.busy, isStreaming: controls.busy,
      isCompacting: false, hasPendingAsyncWork: false, queuedMessageCount: 0, queuedMessages: { steering: [], followUp: [] },
      model: controls.model, thinkingLevel: controls.thinkingLevel }; },
    async status() { return { sessionId: controls.sessionId, isSettled: !controls.busy, isStreaming: controls.busy,
      isCompacting: false, hasPendingAsyncWork: false, queuedMessageCount: 0, steeringCount: 0, followUpCount: 0 }; },
    async models() { return [
      { provider: "synthetic", id: "fixture", name: "Fixture", reasoning: true, thinking: { efforts: ["low", "high"] } },
      { provider: "synthetic", id: "other", name: "Other", reasoning: false }]; },
    async thinkingLevels(): Promise<("off" | "low" | "high")[]> { return ["off", "low", "high"]; },
    async selectModel(provider: string, id: string) { controls.model = { ...controls.model, provider, id, name: id }; },
    async setThinkingLevel(level: "off" | "low" | "high") { controls.thinkingLevel = level; },
    async retireIdle() { return controls.retirement ?? { status: "closed", drain: controls.drain }; },
    async branchMessages() { return controls.branchPoints; },
    async branch() {
      if (controls.branchFailure !== undefined) throw controls.branchFailure;
      const result = controls.branchResult ?? { text: "Synthetic fixture input", cancelled: false };
      if (!result.cancelled && controls.branchSessionId) {
        controls.sessionId = controls.branchSessionId; controls.sessionFile = "/synthetic/branch.jsonl";
      }
      return result;
    },
  };
  const branchItem = (): CatalogDescriptor => ({ ...selected, nativeSessionId: controls.branchSessionId ?? "",
    reference: "branch-reference", parentSession: controls.branchParent,
    ownership: { state: "free", observedAt: selected.observedAt } });
  const catalog = new CatalogClient(async command => {
    if (controls.catalogFailure !== undefined) throw controls.catalogFailure;
    return command.type === "describe_session"
    ? { status: "verified", observedAt: selected.observedAt,
      item: command.reference === "branch-reference" ? branchItem() : command.reference === other.reference ? other : selected }
    : { status: "complete", snapshot: "synthetic-snapshot", observedAt: selected.observedAt,
      expiresAt: "2099-11-16T00:00:00.000Z", examined: 2, failures: [],
      items: [selected, other, ...(controls.branchSessionId === undefined ? [] : [branchItem()])] };
  });
  const supervisor = new SessionSupervisor({ authority, grants, index, catalog, ...(launchOwned ? { launchOwned } : {
    async launch() {
      ++controls.launches; await controls.launch();
      const childExit = Promise.withResolvers<number>();
      exited = childExit;
      return { ...worker, exited: childExit.promise, notificationCount: controls.notificationCount,
        async close(policy) {
          const drain = await controls.close(policy);
          controls.closed = true; childExit.resolve(drain.code); return drain;
        } };
    },
  }) });
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
