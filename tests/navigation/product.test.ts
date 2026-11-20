/** Product Host route + real DSH client over HTTP; synthetic native DTOs only, no Native execution. */
import { expect, test } from "bun:test";
import { Context } from "@deepseek-ai/cordis";
import { installConnection } from "@deepseek-ai/dsh-client-connection/client";
import { apply as registry } from "@deepseek-ai/dsh-typert-registry/client";
import { apply as gateway } from "@deepseek-ai/dsh-api-gateway/client";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startSessionComponentServer } from "../../apps/host/src/session-component-server.ts";
import { NavigationOperationStore } from "../../apps/host/src/navigation-operations.ts";
import { sessionsContribution } from "../../packages/contracts/sessions.ts";
import { historyNavigationSourceContribution } from "../../packages/contracts/history-navigation-source.ts";
import { CatalogClient } from "../../packages/contracts/generated/catalog-client.ts";
import { HistoryClient } from "../../packages/contracts/generated/history-client.ts";
import { StrictStartClient } from "../../packages/contracts/generated/strict-client.ts";
import { SubmissionClient, isSubmissionResult } from "../../packages/contracts/submissions.ts";
import { AttachmentClient } from "../../packages/contracts/generated/attachment-client.ts";
import { NavigationClient } from "../../packages/contracts/generated/navigation-client.ts";
import type { NavigationPreview, NavigationResult } from "../../packages/contracts/generated/omp-wire.ts";
import { isAttachmentReceipt } from "../../packages/contracts/attachment-preparation.ts";
import validState from "../../packages/contracts/generated/strict-state.js";
import validHistoryOpen from "../../packages/contracts/generated/history-open.js";
import validHistoryPage from "../../packages/contracts/generated/history-page.js";
import type { CatalogDescriptor, HistoryCut, HistoryOpen, HistoryItem, StrictStartState } from "../../packages/contracts/generated/omp-wire.ts";

const previewFor = (entryId: string, targetRevision = "rev-target") => ({ version: "durable-navigation-v1" as const,
  target: { sourceId: "source", instanceId: "instance", nativeSessionId: "native-session" }, entryId,
  targetParentId: "d", targetRevision, contextRevision: "content-v1" });
const navigationResult = (navigationId: string, preview: ReturnType<typeof previewFor>, actualLeafId: string | null = preview.entryId) => ({
  version: "durable-navigation-v1" as const, navigationId, target: preview.target, found: true, duplicate: false,
  admission: "local" as const, outcome: "committed" as const, reservation: "committed" as const,
  persistence: "committed" as const, terminal: true, origin: { ...preview.target, navigationId },
  requestedTargetId: preview.entryId, targetParentId: preview.targetParentId, actualLeafId,
  targetRevision: preview.targetRevision, contextRevision: preview.contextRevision,
  draftStatus: "inline" as const, editorText: "Returned question", draftOriginEntryId: preview.entryId,
  draftContentRevision: preview.targetRevision, commitId: "commit-1" });
const items: HistoryItem[][] = [
  [{ id: "a", parentId: null, active: true, text: "Earlier retained question", kind: "message", role: "user" },
    { id: "x", parentId: "a", active: false, text: "Abandoned answer", kind: "message", role: "assistant" }],
  [{ ...{ id: "c", parentId: "a", active: true, text: "Native summary", kind: "message", role: "user" } as HistoryItem,
    kind: "compaction", boundary: "compaction" },
    { id: "d", parentId: "c", active: true, text: "Before reset", kind: "message", role: "user" }],
  [{ ...{ id: "r", parentId: "d", active: true, text: "Native reset", kind: "message", role: "user" } as HistoryItem,
    kind: "reset_boundary", boundary: "reset" },
    { id: "e", parentId: "r", active: true, text: "Current question", kind: "message", role: "user" }],
];

test("the product Chat Host serves durable native navigation to a real DSH client without replay or new input", async () => {
  const home = await mkdtemp(join(tmpdir(), "tree-product-")), cwd = join(home, "project"), dataDir = join(home, "state");
  await mkdir(cwd);
  const selected: CatalogDescriptor = { sourceId: "source", instanceId: "instance", reference: "opaque-reference",
    nativeSessionId: "native-session", aliases: [], cwd: { status: "known", recorded: cwd, canonical: cwd },
    createdAt: "2026-11-16T00:00:00.000Z", modifiedAt: "2026-11-16T00:00:00.000Z",
    observedAt: "2026-11-16T00:00:00.000Z", ownership: { state: "free", observedAt: "2026-11-16T00:00:00.000Z" } };
  const binding = { ...selected, ownership: { ...selected.ownership, state: "held" as const } };
  const opened: StrictStartState = { version: "strict-start-v1", phase: "open", intent: "continue", cwd,
    nativeSessionId: selected.nativeSessionId, binding };
  const commands: string[] = [];
  const expiresAt = Date.now() + 100_000;
  const history = new HistoryClient(async command => {
    commands.push(command.type);
    if (command.type === "history_snapshot_close") return { closed: true };
    const cut: HistoryCut = { durability: "not_attested", sourceBindingStatus: "worker", sourceId: "source",
      sessionId: "native-session", workerId: "native-worker", contextId: "context", contentRevision: "content-v1",
      nativeRevision: 7, retainedRevision: "retained-v1", leafId: "e", observationSeq: 8 };
    const open: HistoryOpen = { version: "coherent-history-v1", snapshot: "native-snapshot",
      cursor: command.type === "history_snapshot_open" && command.scope === "active" ? "active" : "cursor-0",
      cursors: { tree: "cursor-0", active: "active", running: "running", live: "live" },
      scope: command.type === "history_snapshot_open" ? command.scope : "tree",
      handoff: command.type === "history_snapshot_open" ? command.handoff ?? "current" : "current",
      cut, expiresAt, count: 5, streaming: false, compacting: false,
      prefix: null, scannedBytes: 100, scanMs: 1, snapshotMs: 1,
      limits: { entries: 20000, runningMessages: 10000, scanItems: 60000, bytes: 1000000, nativeItemBytes: 1000000,
        itemBytes: 512 * 1024, ms: 1000, snapshotBytes: 256 * 1024 * 1024, cacheBytes: 512 * 1024 * 1024, snapshots: 8,
        pageItems: 32, pageBytes: 768 * 1024, responseBytes: 1024 * 1024, ttlMs: 100000, contentItems: 64,
        contentPageBytes: 10000, liveEvents: 1024, liveBytes: 1000000, pollItems: 100 } };
    if (command.type === "history_snapshot_open") return open;
    if (command.type === "history_observation_poll") return { cut, after: command.after, through: cut.observationSeq,
      events: [], hasMore: false };
    if (command.type !== "history_snapshot_page") throw Error(`UNEXPECTED_NATIVE_OPERATION ${command.type}`);
    if (command.cursor === "active") return { snapshot: "native-snapshot", scope: "active", cut, expiresAt,
      items: items.flat().filter(item => item.active), complete: true };
    if (command.cursor === "live") return { snapshot: "native-snapshot", scope: "live", cut, expiresAt, complete: true,
      items: [{ id: "live-e", parentId: "r", active: true, kind: "message", role: "user", text: "Current question",
        livePhase: "ended", live: { workerId: "native-worker", messageId: "live-e", sourceId: "source",
          sessionId: "native-session", contextId: "context", branchLeafId: "e" } }] };
    const index = Number(command.cursor.slice("cursor-".length));
    return { snapshot: "native-snapshot", scope: "tree", cut, expiresAt: open.expiresAt, items: items[index] ?? [],
      complete: true, ...(index < items.length - 1 ? { nextCursor: `cursor-${index + 1}` } : {}) };
  });
  const catalog = new CatalogClient(async command => command.type === "describe_session"
    ? { status: "verified", observedAt: selected.observedAt, item: selected }
    : { status: "complete", snapshot: "synthetic-snapshot", observedAt: selected.observedAt,
      expiresAt: "2099-11-16T00:00:00.000Z", examined: 1, failures: [], items: [selected] });
  let launched = false, navBusy = false;
  class Options {
    readonly dataDir = dataDir;
    readonly port = 0;
    readonly catalog = catalog;
    readonly manifest = join(home, "absent-manifest");
    readonly launcher = join(home, "absent-launcher");
    readonly chat = true as const;
    async launch(_cwd: string) {
      launched = true;
      const exit = Promise.withResolvers<number>();
      const worker = {
        frames: [{ type: "ready", interactionPolicy: { version: "1", explicitAnswersOnly: true, nativeExpiry: "cancel",
          toolExpiry: "cancel", invalidAnswer: "pending" } }],
        startup: new StrictStartClient(async () => opened, (value): value is StrictStartState => validState(value)),
        history,
        subscribe: () => () => {},
        submissions: new SubmissionClient(async () => { throw new Error("UNUSED"); }, isSubmissionResult),
        attachments: new AttachmentClient(async () => { throw new Error("UNUSED"); }, isAttachmentReceipt),
        navigation: new NavigationClient(async command => {
          if (command.type === "navigation_inspect") return previewFor(command.entryId);
          if (command.type === "navigate_tree_committed") return {
            ...navigationResult(command.navigationId, previewFor(command.entryId)),
            ...(command.entryId === "drift" ? { requestedTargetId: "other" } : {}) };
          if (command.type === "navigation_query") return navigationResult(command.navigationId, previewFor("e"));
          throw new Error("UNEXPECTED_NAVIGATION_OPERATION");
        }, (value): value is NavigationResult => typeof value === "object" && value !== null,
          (value): value is NavigationPreview => typeof value === "object" && value !== null),
        async submitCommand() { throw new Error("UNUSED"); },
        async command() { return { status: "answered" }; }, async control() { return {}; },
        async state() { return { sessionId: selected.nativeSessionId, isSettled: !navBusy, isStreaming: false,
          isCompacting: false, hasPendingAsyncWork: false, queuedMessageCount: 0,
          queuedMessages: { steering: [], followUp: [] }, model: { provider: "synthetic", id: "fixture", name: "Fixture",
            api: "synthetic", baseUrl: "http://127.0.0.1/", reasoning: false, input: ["text"],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 4096 },
          thinkingLevel: "off" as const }; },
        async models() { return []; }, async thinkingLevels(): Promise<("off" | "low" | "high")[]> { return ["off"]; },
        async selectModel() {}, async setThinkingLevel() {},
        async branchMessages() { return [{ entryId: "entry-0", text: "Synthetic fixture input" }]; },
        async branch() { return { text: "Synthetic fixture input", cancelled: false }; },
        async retireIdle() { return { status: "closed" as const, drain: { code: 0, forced: false, stderrBytes: 0,
          stdoutEOF: true, stderrEOF: true } }; },
        exited: exit.promise, notificationCount: 0,
        async close() { exit.resolve(0); return { code: 0, forced: false, stderrBytes: 0, stdoutEOF: true, stderrEOF: true }; },
      };
      return worker;
    }
  }
  const host = await startSessionComponentServer(new Options());
  const ctx = new Context();
  try {
    const origin = host.server.url.origin;
    const exchange = await fetch(host.bootstrapLink(), { redirect: "manual" });
    const cookie = exchange.headers.get("set-cookie")!.split(";")[0]!;
    const { csrf } = await (await fetch(`${origin}/auth/status`, { headers: { cookie } })).json() as { csrf: string };
    installConnection(ctx, { interactions: "none", transport: {
      fetch: (url, init) => fetch(new URL(url, origin), {
        ...init, headers: { cookie, origin, "x-omp-csrf": csrf, "content-type": "application/json" },
      }), openStream: async function*() {},
    } });
    registry(ctx); gateway(ctx);
    await ctx.remote.$mount(sessionsContribution); await ctx.remote.$mount(historyNavigationSourceContribution);

    const preview = await ctx.remote.ompSessions.preview(cwd); if (!preview.ok) throw preview.error;
    const grant = await ctx.remote.ompSessions.confirm(preview.value.confirmation); if (!grant.ok) throw grant.error;
    const list = await ctx.remote.ompSessions.catalog({ pageSize: 8 }); if (!list.ok) throw list.error;
    const choice = list.value.choices.find(value => value.nativeSessionId === "native-session")!;
    expect((await ctx.remote.ompSessions.open(choice.selectionId)).ok).toBe(true);
    expect(launched).toBe(true);

    const action = (request: Parameters<typeof ctx.remote.ompHistoryNavigationSource.action>[0]) =>
      ctx.remote.ompHistoryNavigationSource.action(request);
    const inspected = await action({ operation: "inspect", sessionId: "native-session", entryId: "e" });
    if (!inspected.ok) throw new Error(`INSPECT_FAILED ${inspected.error.message}`);
    expect(inspected.ok).toBe(true);
    if (!inspected.ok || inspected.value.status !== "confirmation") throw new Error(`NO_CONFIRMATION ${JSON.stringify(inspected)}`);
    expect(inspected.value).toMatchObject({ sessionId: "native-session", entryId: "e", targetParentId: "d" });
    const commandsBefore = commands.length;
    const confirmed = await action({ operation: "confirm", token: inspected.value.token });
    if (!confirmed.ok) throw new Error(`CONFIRM_FAILED ${confirmed.error.message}`);
    expect(confirmed.ok).toBe(true);
    if (!confirmed.ok || confirmed.value.status !== "operation") throw new Error(`NO_OPERATION ${JSON.stringify(confirmed)}`);
    expect(confirmed.value).toMatchObject({ outcome: "committed", persistence: "committed", projection: "ready",
      actualLeafId: "e", commitId: "commit-1", draft: { text: "Returned question", originEntryId: "e" } });
    // The only native work after confirm is reopening the rebuilt presentation; no prompt/model/new branch.
    expect(commands.slice(commandsBefore).every(type => type.startsWith("history_"))).toBe(true);
    expect(commands.slice(commandsBefore)).not.toContain("prompt");
    const code = (result: Awaited<ReturnType<typeof action>>) => result.ok ? result.value.status === "error" ? result.value.code : "ok" : "transport";
    expect(code(await action({ operation: "confirm", token: inspected.value.token }))).toBe("navigation_confirmation_unavailable");
    expect(commands.length).toBeGreaterThan(commandsBefore);

    const cancelled = await action({ operation: "inspect", sessionId: "native-session", entryId: "d" });
    if (!cancelled.ok || cancelled.value.status !== "confirmation") throw new Error("NO_CONFIRMATION");
    expect((await action({ operation: "cancel", token: cancelled.value.token })).ok)
      .toBe(true);
    expect(code(await action({ operation: "confirm", token: cancelled.value.token }))).toBe("navigation_confirmation_unavailable");

    const drift = await action({ operation: "inspect", sessionId: "native-session", entryId: "drift" });
    if (!drift.ok || drift.value.status !== "confirmation") throw new Error("NO_CONFIRMATION");
    const mismatch = await action({ operation: "confirm", token: drift.value.token });
    expect(mismatch.ok && mismatch.value.status === "operation" ? mismatch.value.projection : "error")
      .toBe("invalidated");

    navBusy = true;
    expect(code(await action({ operation: "inspect", sessionId: "native-session", entryId: "e" })))
      .toBe("navigation_stop_required_new_action");
    navBusy = false;

    expect(code(await action({ operation: "inspect", sessionId: "other-session", entryId: "e" })))
      .toBe("navigation_authority_unavailable");
    expect(code(await action({ operation: "query", sessionId: "native-session", navigationId: "missing" })))
      .toBe("navigation_operation_unavailable");
    const stored = await Bun.file(`${dataDir}/history-navigation-operations.json`).json() as
      { operations: { state: string; outcome?: string; persistence?: string; actualLeafId?: string }[] };
    const resolved = stored.operations.find(operation => operation.state === "resolved");
    expect(resolved).toMatchObject({ state: "resolved", outcome: "committed", persistence: "committed", actualLeafId: "e" });
    const reopened = await new NavigationOperationStore(dataDir).read((resolved as unknown as { navigationId: string }).navigationId);
    expect(reopened).toMatchObject({ state: "resolved", outcome: "committed", persistence: "committed", actualLeafId: "e" });
    await host.revokeAll();
    let revoked: unknown;
    try { revoked = await ctx.remote.ompTree.read({ operation: "open", sessionId: "native-session" }); } catch { revoked = undefined; }
    expect(revoked).toBeUndefined();
  } finally {
    await ctx.fiber.dispose(); await host.stop(); await rm(home, { recursive: true, force: true });
  }
});
