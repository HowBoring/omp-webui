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
import { sessionsContribution } from "../../packages/contracts/sessions.ts";
import { treeContribution } from "../../packages/contracts/tree.ts";
import { CatalogClient } from "../../packages/contracts/generated/catalog-client.ts";
import { HistoryClient } from "../../packages/contracts/generated/history-client.ts";
import { StrictStartClient } from "../../packages/contracts/generated/strict-client.ts";
import { SubmissionClient, isSubmissionResult } from "../../packages/contracts/submissions.ts";
import { AttachmentClient } from "../../packages/contracts/generated/attachment-client.ts";
import { NavigationClient } from "../../packages/contracts/generated/navigation-client.ts";
import { isAttachmentReceipt } from "../../packages/contracts/attachment-preparation.ts";
import validState from "../../packages/contracts/generated/strict-state.js";
import type { CatalogDescriptor, HistoryCut, HistoryOpen, HistoryItem, StrictStartState } from "../../packages/contracts/generated/omp-wire.ts";

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

test("the product Chat Host serves the read-only tree to a real DSH client and nothing else", async () => {
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
    const open: HistoryOpen = { version: "coherent-history-v1", handoff: "current", snapshot: "native-snapshot",
      cursor: "cursor-0", cursors: { tree: "cursor-0", active: "active", running: "running", live: "live" },
      scope: "tree", cut, expiresAt, count: 6, streaming: false, compacting: false,
      prefix: null, scannedBytes: 100, scanMs: 1, snapshotMs: 1,
      limits: { entries: 20000, runningMessages: 10000, scanItems: 60000, bytes: 1000000, nativeItemBytes: 1000000,
        itemBytes: 512 * 1024, ms: 1000, snapshotBytes: 256 * 1024 * 1024, cacheBytes: 512 * 1024 * 1024, snapshots: 8,
        pageItems: 32, pageBytes: 768 * 1024, responseBytes: 1024 * 1024, ttlMs: 100000, contentItems: 64,
        contentPageBytes: 10000, liveEvents: 1024, liveBytes: 1000000, pollItems: 100 } };
    if (command.type === "history_snapshot_open") return open;
    if (command.type !== "history_snapshot_page") throw Error("UNEXPECTED_NATIVE_OPERATION");
    const index = Number(command.cursor.slice("cursor-".length));
    return { snapshot: "native-snapshot", scope: "tree", cut, expiresAt: open.expiresAt, items: items[index] ?? [],
      complete: true, ...(index < items.length - 1 ? { nextCursor: `cursor-${index + 1}` } : {}) };
  });
  const catalog = new CatalogClient(async command => command.type === "describe_session"
    ? { status: "verified", observedAt: selected.observedAt, item: selected }
    : { status: "complete", snapshot: "synthetic-snapshot", observedAt: selected.observedAt,
      expiresAt: "2099-11-16T00:00:00.000Z", examined: 1, failures: [], items: [selected] });
  let launched = false;
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
        navigation: new NavigationClient(async () => { throw new Error("UNUSED"); }, (_value): _value is never => false, (_value): _value is never => false),
        async submitCommand() { throw new Error("UNUSED"); },
        async command() { return { status: "answered" }; }, async control() { return {}; },
        async steer() { throw new Error("UNUSED"); }, async followUp() { throw new Error("UNUSED"); },
        async setAskDialog() { return { enabled: true }; }, get readyPolicy(): unknown { return undefined; },
        async state() { return { sessionId: selected.nativeSessionId, isSettled: true, isStreaming: false,
          isCompacting: false, hasPendingAsyncWork: false, queuedMessageCount: 0,
          queuedMessages: { steering: [], followUp: [] }, model: { provider: "synthetic", id: "fixture", name: "Fixture",
            api: "synthetic", baseUrl: "http://127.0.0.1/", reasoning: false, input: ["text"],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 4096 },
          thinkingLevel: "off" as const }; },
        async models() { return []; }, async thinkingLevels(): Promise<("off" | "low" | "high")[]> { return ["off"]; },
        async selectModel() {}, async setThinkingLevel() {},
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
    await ctx.remote.$mount(sessionsContribution); await ctx.remote.$mount(treeContribution);

    const preview = await ctx.remote.ompSessions.preview(cwd); if (!preview.ok) throw preview.error;
    const grant = await ctx.remote.ompSessions.confirm(preview.value.confirmation); if (!grant.ok) throw grant.error;
    const list = await ctx.remote.ompSessions.catalog({ pageSize: 8 }); if (!list.ok) throw list.error;
    const choice = list.value.choices.find(value => value.nativeSessionId === "native-session")!;
    expect((await ctx.remote.ompSessions.open(choice.selectionId)).ok).toBe(true);
    expect(launched).toBe(true);

    const before = commands.length;
    const openedTree = await ctx.remote.ompTree.read({ operation: "open", sessionId: "native-session" });
    expect(openedTree.ok).toBe(true);
    if (!openedTree.ok || openedTree.value.status !== "opened") throw new Error("TREE_OPEN_FAILED");
    let cursor: string | undefined = openedTree.value.cursor;
    while (cursor) {
      const page = await ctx.remote.ompTree.read({ operation: "page", snapshot: openedTree.value.snapshot, cursor });
      if (!page.ok || page.value.status !== "page") throw new Error("TREE_PAGE_FAILED");
      cursor = page.value.nextCursor;
    }
    const previewRead = await ctx.remote.ompTree.read({ operation: "preview", snapshot: openedTree.value.snapshot, entryId: "e" });
    expect(previewRead.ok && previewRead.value.status === "preview" && previewRead.value.text).toBe("Current question");
    expect((await ctx.remote.ompTree.read({ operation: "close", snapshot: openedTree.value.snapshot })).ok).toBe(true);
    // Only the documented read-only snapshot calls. A presentation journal or model call would add commands.
    expect(commands.slice(before)).toEqual(["history_snapshot_open", "history_snapshot_page", "history_snapshot_page",
      "history_snapshot_page", "history_snapshot_page", "history_snapshot_close"]);

    const wrong = await ctx.remote.ompTree.read({ operation: "open", sessionId: "other-session" });
    expect(wrong.ok).toBe(true);
    expect(wrong.ok && wrong.value.status === "error" && wrong.value.code).toBe("tree_authority_unavailable");

    await host.revokeAll();
    const revoked = await ctx.remote.ompTree.read({ operation: "open", sessionId: "native-session" }).catch(() => undefined);
    expect(revoked === undefined || revoked.ok === false).toBe(true);
  } finally {
    await ctx.fiber.dispose(); await host.stop(); await rm(home, { recursive: true, force: true });
  }
});
