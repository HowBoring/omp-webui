/** Public Remote / real HistoryClient / synthetic native DTO port; no Native or browser execution. */
import { expect, test } from "bun:test";
import { z } from "zod";
import { Context } from "@deepseek-ai/cordis";
import TypertRegistry from "@deepseek-ai/dsh-typert-registry";
import RemoteAccessService from "@deepseek-ai/dsh-api-remote-access";
import { TypertGatewayService } from "@deepseek-ai/dsh-api-gateway";
import { Peer, clientRequestSchema } from "@deepseek-ai/dsh-client-connection";
import { installConnection } from "@deepseek-ai/dsh-client-connection/client";
import { apply as registry } from "@deepseek-ai/dsh-typert-registry/client";
import { apply as gateway } from "@deepseek-ai/dsh-api-gateway/client";
import { HistoryClient } from "../../packages/contracts/generated/history-client.ts";
import type { HistoryCut, HistoryOpen, HistoryPage, HistoryItem } from "../../packages/contracts/generated/omp-wire.ts";
import { treeContribution, treeHostContribution, type TreeResult } from "../../packages/contracts/tree.ts";
import { ReadonlyTree } from "../../packages/tree/service.ts";

const cut: HistoryCut = { durability: "not_attested", sourceBindingStatus: "worker", sourceId: "source",
  sessionId: "session", workerId: "worker", contextId: "context", contentRevision: "content-v1",
  nativeRevision: 7, retainedRevision: "retained-v1", leafId: "e", observationSeq: 8 };
const item = (id: string, parentId: string | null, active: boolean, text: string): HistoryItem =>
  ({ id, parentId, active, text, kind: "message", role: "user" });
const rows: HistoryItem[][] = [
  [item("a", null, true, "Earlier retained question"), item("x", "a", false, "Abandoned answer")],
  [{ ...item("c", "a", true, "Native summary"), kind: "compaction", boundary: "compaction" },
    item("d", "c", true, "Before reset\n[Native pruned content]")],
  [{ ...item("r", "d", true, "Native reset"), kind: "reset_boundary", boundary: "reset" },
    item("e", "r", true, "Current question")],
];
const opened: HistoryOpen = { version: "coherent-history-v1", handoff: "current", snapshot: "native-snapshot",
  cursor: "cursor-0", cursors: { tree: "cursor-0", active: "active", running: "running", live: "live" },
  scope: "tree", cut, expiresAt: Date.now() + 100_000, count: 6, streaming: false, compacting: false,
  prefix: null, scannedBytes: 100, scanMs: 1, snapshotMs: 1,
  limits: { entries: 20000, runningMessages: 10000, scanItems: 60000, bytes: 1000000, nativeItemBytes: 1000000,
    itemBytes: 512 * 1024, ms: 1000, snapshotBytes: 256 * 1024 * 1024, cacheBytes: 512 * 1024 * 1024, snapshots: 8,
    pageItems: 32, pageBytes: 768 * 1024, responseBytes: 1024 * 1024, ttlMs: 100000, contentItems: 64,
    contentPageBytes: 10000, liveEvents: 1024, liveBytes: 1000000, pollItems: 100 } };

async function fixture(options: { pages?: HistoryItem[][]; changedCut?: Partial<HistoryCut>; nativeError?: string;
  emptyContinuation?: boolean; advertisedParts?: number; openMetadata?: Partial<Pick<HistoryOpen, "snapshot" | "cut">> } = {}) {
  const host = new Context(), client = new Context();
  await host.plugin(TypertRegistry); await host.plugin(RemoteAccessService); await host.plugin(TypertGatewayService, {});
  host.typert.register(treeHostContribution);
  const initialPeer = new Peer(host, { principal: { kind: "owner" }, interactions: "none" });
  let peer = initialPeer;
  const peers = [initialPeer];
  const commands: string[] = [];
  let permitted = true, epoch = "projection-1", failPage = false, cancel = false;
  let afterRead: (() => void) | undefined;
  let transformPage: ((page: HistoryPage) => HistoryPage) | undefined;
  let rewritten = false;
  let pageBarrier: Promise<void> | undefined;
  let releasePage: (() => void) | undefined;
  let enteredPage: (() => void) | undefined;
  const pages = structuredClone(options.pages ?? rows);
  const currentOpen = { ...opened, ...options.openMetadata };
  const history = new HistoryClient(async command => {
    commands.push(command.type);
    if (command.type === "history_snapshot_close") return { closed: true };
    if (command.type === "history_snapshot_open") {
      if (command.scope !== "tree" || command.handoff !== "current") throw Error("UNEXPECTED_NATIVE_SCOPE");
      return structuredClone({ ...currentOpen,
        count: options.advertisedParts ?? pages.reduce((sum, page) => sum + page.length, 0) });
    }
    if (command.type !== "history_snapshot_page") throw Error("UNEXPECTED_NATIVE_OPERATION");
    if (failPage) throw Error(options.nativeError ?? "history_stale_cursor");
    if (pageBarrier) { enteredPage?.(); await pageBarrier; pageBarrier = undefined; }
    const index = Number(command.cursor.slice("cursor-".length));
    const page: HistoryPage = { snapshot: currentOpen.snapshot, scope: "tree", cut: { ...currentOpen.cut,
      ...(index > 0 ? options.changedCut : {}), ...(rewritten ? { contentRevision: "rewritten-current-cut" } : {}) }, expiresAt: currentOpen.expiresAt,
      items: pages[index] ?? [], complete: true,
      ...(index < pages.length - 1 || options.emptyContinuation ? { nextCursor: `cursor-${index + 1}` } : {}) };
    afterRead?.(); afterRead = undefined;
    return transformPage?.(page) ?? page;
  });
  new ReadonlyTree(host, (caller, sessionId) => {
    if (caller !== peer || !permitted || sessionId !== "session") throw Error("PRIVATE_SYNTHETIC_DENIAL");
    return { history, sourceId: "source", sessionId, workerId: "worker", contextId: "context", epoch };
  });
  installConnection(client, { interactions: "none", transport: {
    async fetch(_url, init) {
      const call = clientRequestSchema.parse(JSON.parse(String(init.body)));
      const descriptor = treeContribution.methods["ompTree/read"];
      if (!descriptor) throw Error("fixture descriptor absent");
      const payload = z.strictObject({ args: z.record(z.string(), z.unknown()) }).parse(call.payload);
      const args = z.record(z.string(), z.unknown()).parse(
        descriptor.input({ strict: true }).create().parse(payload.args));
      try {
        const value = await host.typertGateway.invoke({ namespace: "ompTree", method: "read", args, peer,
          ...(cancel ? { signal: AbortSignal.abort() } : {}) });
        cancel = false;
        return Response.json({ type: "server-response", rpcId: call.rpcId, result: { ok: true, value } });
      } catch {
        return Response.json({ type: "server-response", rpcId: call.rpcId, result: { ok: false,
          error: { code: "gateway/bad-request", message: "Tree refused", details: {} } } });
      }
    }, openStream: async function* () {},
  } });
  registry(client); gateway(client); await client.remote.$mount(treeContribution);
  const read = async (request: Parameters<typeof client.remote.ompTree.read>[0]): Promise<TreeResult> => {
    const response = await client.remote.ompTree.read(request);
    if (!response.ok) throw Error("REMOTE_REJECTED"); return response.value;
  };
  return { read, commands, revoke: () => { permitted = false; }, occupy: () => { permitted = false; },
    changeEpoch: () => { epoch = "projection-2"; }, rewrite: () => { rewritten = true; },
    transformPage: (transform: (page: HistoryPage) => HistoryPage) => { transformPage = transform; },
    switchPeer: () => { peer = new Peer(host, { principal: { kind: "owner" }, interactions: "none" }); peers.push(peer); },
    restorePeer: () => { peer = initialPeer; }, failPage: () => { failPage = true; },
    revokeDuringRead: () => { afterRead = () => { permitted = false; }; },
    cancelNext: () => { cancel = true; },
    holdNextPage: () => {
      pageBarrier = new Promise<void>(resolve => { releasePage = resolve; });
      return new Promise<void>(resolve => { enteredPage = resolve; });
    },
    releasePage: () => { releasePage?.(); },
    dispose: async () => { await client.fiber.dispose(); await Promise.all(peers.map(value => value.dispose())); await host.fiber.dispose(); } };
}

test("complete native pages keep active path and abandoned-node preview separate without mutation", async () => {
  const f = await fixture();
  try {
    const start = await f.read({ operation: "open", sessionId: "session" });
    expect(start.status).toBe("opened");
    if (start.status !== "opened") throw Error("open failed");
    const first = await f.read({ operation: "page", snapshot: start.snapshot, cursor: start.cursor });
    expect(first.status === "page" && first.continuity).toBe("partial");
    expect(await f.read({ operation: "preview", snapshot: start.snapshot, entryId: "x" }))
      .toEqual({ status: "error", code: "tree_incomplete" });
    let page = first;
    while (page.status === "page" && page.nextCursor) {
      page = await f.read({ operation: "page", snapshot: start.snapshot, cursor: page.nextCursor });
    }
    expect(page.status === "page" && page.activePath).toEqual(["a", "c", "d", "r", "e"]);
    const preview = await f.read({ operation: "preview", snapshot: start.snapshot, entryId: "x" });
    expect(preview.status === "preview" && { selected: preview.node.id, active: preview.node.active,
      leaf: preview.position.leafId, text: preview.text }).toEqual({
      selected: "x", active: false, leaf: "e", text: "Abandoned answer",
    });
    expect(f.commands.every(type => ["history_snapshot_open", "history_snapshot_page", "history_snapshot_close"]
      .includes(type))).toBe(true);
    expect(f.commands.filter(type => type === "history_snapshot_open")).toHaveLength(1);
  } finally { await f.dispose(); }
});

async function complete(f: Awaited<ReturnType<typeof fixture>>) {
  const start = await f.read({ operation: "open", sessionId: "session" });
  if (start.status !== "opened") throw Error("fixture open failed");
  let cursor: string | undefined = start.cursor, last: TreeResult = start;
  while (cursor) {
    last = await f.read({ operation: "page", snapshot: start.snapshot, cursor });
    cursor = last.status === "page" ? last.nextCursor : undefined;
  }
  return { start, last };
}

test("an overlapping refused read cannot release another in-flight page's exclusion", async () => {
  const f = await fixture();
  try {
    const start = await f.read({ operation: "open", sessionId: "session" });
    if (start.status !== "opened") throw Error("fixture open failed");
    const entered = f.holdNextPage();
    const pending = f.read({ operation: "page", snapshot: start.snapshot, cursor: start.cursor });
    await entered;
    expect(await f.read({ operation: "preview", snapshot: start.snapshot, entryId: "a" }))
      .toEqual({ status: "error", code: "tree_read_busy" });
    expect(await f.read({ operation: "preview", snapshot: start.snapshot, entryId: "x" }))
      .toEqual({ status: "error", code: "tree_read_busy" });
    f.releasePage();
    expect((await pending).status).toBe("page");
  } finally { f.releasePage(); await f.dispose(); }
});

test("public Tree component folds retained segments and selection leaves current position unchanged", async () => {
  const { TreeBrowser } = await import("../../packages/tree/browser.ts");
  const { TreePanel } = await import("../../packages/tree/panel.tsx");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { createElement } = await import("react");
  const f = await fixture();
  const browser = new TreeBrowser("session", f.read);
  try {
    await browser.open();
    expect(browser.getSnapshot().phase).toBe("partial");
    await browser.nextPage(); await browser.nextPage();
    await browser.select("x");
    const html = renderToStaticMarkup(createElement(TreePanel, { browser }));
    expect(html).toContain("Abandoned answer");
    expect(html).toContain("Current native leaf: e");
    expect(html).toContain("Retained history before compaction");
    expect(html).toContain("Retained history before reset");
    expect(html).not.toContain("<details open");
    expect(browser.getSnapshot().activePath).toEqual(["a", "c", "d", "r", "e"]);
    expect(browser.getSnapshot().selectedId).toBe("x");
  } finally { browser.dispose(); await f.dispose(); }
});

test("full-page parent continuity, leaf membership and active flags fail closed", async () => {
  const cases: { pages: HistoryItem[][]; code: string }[] = [
    { pages: [[item("a", "missing", true, "untrusted")]], code: "tree_parent_missing" },
    { pages: [[item("a", "b", true, "untrusted"), item("b", "a", true, "untrusted")]], code: "tree_parent_cycle" },
    { pages: [[item("a", null, true, "untrusted")]], code: "tree_leaf_missing" },
    { pages: [[item("e", null, false, "untrusted")]], code: "tree_active_path_mismatch" },
  ];
  for (const entry of cases) {
    const f = await fixture({ pages: entry.pages });
    try {
      const { start, last } = await complete(f);
      expect(last).toEqual({ status: "error", code: entry.code });
      expect(await f.read({ operation: "preview", snapshot: start.snapshot, entryId: "a" }))
        .toEqual({ status: "error", code: "tree_snapshot_unavailable" });
    } finally { await f.dispose(); }
  }
});

test("every native source-cut field fences subsequent pages, including same-shape retained rewrites", async () => {
  const changes: Partial<HistoryCut>[] = [
    { contentRevision: "rewritten-same-leaf-and-count" }, { retainedRevision: "rewritten-payload" },
    { nativeRevision: 8 }, { observationSeq: 9 }, { leafId: "x" }, { contextId: "new-context" },
    { sourceId: "other-source" }, { sessionId: "other-session" }, { workerId: "other-worker" },
    { sourceBindingStatus: "catalog", catalogBinding: { sourceId: "source", instanceId: "instance",
      nativeSessionId: "session", reference: "SYNTHETIC_PRIVATE_REFERENCE" } },
  ];
  for (const changedCut of changes) {
    const f = await fixture({ changedCut });
    try {
      const { start, last } = await complete(f);
      expect(last).toEqual({ status: "error", code: "tree_source_changed" });
      expect(JSON.stringify(start)).not.toContain("SYNTHETIC_PRIVATE_REFERENCE");
    } finally { await f.dispose(); }
  }
});

test("the exact catalog reference fences reads while staying private to the Host", async () => {
  const catalogBinding = { sourceId: "source", instanceId: "instance", nativeSessionId: "session",
    reference: "SYNTHETIC_PRIVATE_REFERENCE" };
  const f = await fixture({ openMetadata: { cut: { ...cut, sourceBindingStatus: "catalog", catalogBinding } },
    changedCut: { catalogBinding: { ...catalogBinding, reference: "SYNTHETIC_CHANGED_REFERENCE" } } });
  try {
    const { start, last } = await complete(f);
    expect(JSON.stringify(start)).not.toContain(catalogBinding.reference);
    expect(last).toEqual({ status: "error", code: "tree_source_changed" });
  } finally { await f.dispose(); }
});

test("unknown content and continuity types block preview without returning their payload", async () => {
  for (const mutation of [
    { kind: "future_continuity_record" }, { role: "future_message_role" },
    { kind: "message", boundary: "reset" as const },
  ]) {
    const f = await fixture({ pages: [[{ ...item("e", null, true, "SYNTHETIC_PRIVATE_PAYLOAD"), ...mutation }]] });
    try {
      const { last } = await complete(f);
      expect(last.status).toBe("error");
      expect(JSON.stringify(last)).not.toContain("SYNTHETIC_PRIVATE_PAYLOAD");
    } finally { await f.dispose(); }
  }
});

test("internal configuration/state records use fixed presentation and never serialize native payload fields", async () => {
  const f = await fixture({ pages: [[{ ...item("e", null, true, "SYNTHETIC_SECRET"), kind: "credential_pin",
    provider: "SYNTHETIC_PROVIDER", model: "SYNTHETIC_MODEL",
    contents: [{ cursor: "PRIVATE_CONTENT_CURSOR", mimeType: "image/png", bytes: 1, sha256: "private-digest",
      origin: "retained_native", originalAssociation: "unproven" }] }]] });
  try {
    const { start, last } = await complete(f);
    const preview = await f.read({ operation: "preview", snapshot: start.snapshot, entryId: "e" });
    expect(preview.status === "preview" && preview.text).toBe("[Internal native record; content hidden]");
    expect(JSON.stringify({ start, last, preview })).not.toMatch(/SYNTHETIC_SECRET|SYNTHETIC_PROVIDER|SYNTHETIC_MODEL|PRIVATE_CONTENT_CURSOR|private-digest/);
  } finally { await f.dispose(); }
});

test("split native entries assemble across pages and missing or reordered parts explicitly invalidate", async () => {
  const part = { ...item("e", null, true, "Before "), entryId: "e", partIndex: 0, partCount: 2 };
  const tail = { ...part, id: "e:part:1", text: "after", partIndex: 1 };
  const f = await fixture({ pages: [[part], [tail]] });
  try {
    const { start, last } = await complete(f);
    expect(last.status === "page" && last.activePath).toEqual(["e"]);
    const preview = await f.read({ operation: "preview", snapshot: start.snapshot, entryId: "e" });
    expect(preview.status === "preview" && preview.text).toBe("Before after");
  } finally { await f.dispose(); }
  for (const pages of [[[part]], [[tail]], [[part], [{ ...tail, parentId: "changed-parent" }]]]) {
    const broken = await fixture({ pages });
    try { expect((await complete(broken)).last.status).toBe("error"); }
    finally { await broken.dispose(); }
  }
});

test("preview rejects a changed split tail under an unchanged cut", async () => {
  const part = { ...item("e", null, true, "Before "), entryId: "e", partIndex: 0, partCount: 2 };
  const tail = { ...part, id: "e:part:1", text: "after", partIndex: 1 };
  const f = await fixture({ pages: [[part], [tail]] });
  try {
    const { start, last } = await complete(f);
    expect(last.status === "page" && last.continuity).toBe("complete");
    f.transformPage(page => page.items[0]?.id === tail.id
      ? { ...page, items: [{ ...tail, text: "other" }] } : page);
    expect(await f.read({ operation: "preview", snapshot: start.snapshot, entryId: "e" }))
      .toEqual({ status: "error", code: "tree_source_changed" });
  } finally { await f.dispose(); }
});

test("preview returns no partial text when authority is revoked during its final native page", async () => {
  const part = { ...item("e", null, true, "Before "), entryId: "e", partIndex: 0, partCount: 2 };
  const tail = { ...part, id: "e:part:1", text: "after", partIndex: 1 };
  const f = await fixture({ pages: [[part], [tail]] });
  try {
    const { start } = await complete(f);
    f.transformPage(page => {
      if (page.items[0]?.id === tail.id) f.revoke();
      return page;
    });
    expect(await f.read({ operation: "preview", snapshot: start.snapshot, entryId: "e" }))
      .toEqual({ status: "error", code: "tree_authority_unavailable" });
    expect(await f.read({ operation: "preview", snapshot: start.snapshot, entryId: "e" }))
      .toEqual({ status: "error", code: "tree_snapshot_unavailable" });
  } finally { await f.dispose(); }
});

test("native pruning remains explicit readable text and preview makes no model-input claim", async () => {
  const f = await fixture();
  try {
    const { start } = await complete(f);
    const preview = await f.read({ operation: "preview", snapshot: start.snapshot, entryId: "d" });
    expect(preview.status === "preview" && { text: preview.text, modelInput: preview.modelInput,
      originals: preview.attachments }).toEqual({ text: "Before reset\n[Native pruned content]",
      modelInput: "not_an_input_audit", originals: "original_association_unproven" });
  } finally { await f.dispose(); }
});

test("revocation or external writer occupation refuses open before any native history read", async () => {
  for (const denial of ["revoke", "occupy"] as const) {
    const f = await fixture();
    try {
      f[denial]();
      expect(await f.read({ operation: "open", sessionId: "session" }))
        .toEqual({ status: "error", code: "tree_authority_unavailable" });
      expect(f.commands).toEqual([]);
    } finally { await f.dispose(); }
  }
});

test("authority revoked during native read withholds all returned history and destroys its cached selection", async () => {
  const f = await fixture();
  try {
    const start = await f.read({ operation: "open", sessionId: "session" });
    if (start.status !== "opened") throw Error("fixture open failed");
    f.revokeDuringRead();
    expect(await f.read({ operation: "page", snapshot: start.snapshot, cursor: start.cursor }))
      .toEqual({ status: "error", code: "tree_authority_unavailable" });
    expect(await f.read({ operation: "preview", snapshot: start.snapshot, entryId: "a" }))
      .toEqual({ status: "error", code: "tree_snapshot_unavailable" });
  } finally { await f.dispose(); }
});

test("changed broker/projection binding refuses preview even with a previously complete tree", async () => {
  const f = await fixture();
  try {
    const { start } = await complete(f); f.changeEpoch();
    expect(await f.read({ operation: "preview", snapshot: start.snapshot, entryId: "x" }))
      .toEqual({ status: "error", code: "tree_binding_changed" });
  } finally { await f.dispose(); }
});

test("native cursor expiry during preview clears the public component instead of returning cached text", async () => {
  const { TreeBrowser } = await import("../../packages/tree/browser.ts");
  const f = await fixture(), browser = new TreeBrowser("session", f.read);
  try {
    await browser.open(); await browser.nextPage(); await browser.nextPage(); await browser.select("x");
    expect(browser.getSnapshot().preview?.text).toBe("Abandoned answer");
    f.failPage(); await browser.select("e");
    expect(browser.getSnapshot()).toEqual({ phase: "blocked", pending: false, pages: [], activePath: [],
      visiblePage: 0, error: "history_stale_cursor" });
  } finally { browser.dispose(); await f.dispose(); }
});

test("stale client cursors cannot rewind paging or revive an invalidated snapshot", async () => {
  const f = await fixture();
  try {
    const start = await f.read({ operation: "open", sessionId: "session" });
    if (start.status !== "opened") throw Error("fixture open failed");
    await f.read({ operation: "page", snapshot: start.snapshot, cursor: start.cursor });
    expect(await f.read({ operation: "page", snapshot: start.snapshot, cursor: start.cursor }))
      .toEqual({ status: "error", code: "tree_stale_cursor" });
    expect(await f.read({ operation: "preview", snapshot: start.snapshot, entryId: "a" }))
      .toEqual({ status: "error", code: "tree_snapshot_unavailable" });
  } finally { await f.dispose(); }
});

test("a late page after public view invalidation cannot restore old nodes or preview", async () => {
  const { TreeBrowser } = await import("../../packages/tree/browser.ts");
  const f = await fixture(), browser = new TreeBrowser("session", f.read);
  try {
    await browser.open();
    const entered = f.holdNextPage(), pending = browser.nextPage();
    await entered; browser.invalidate("tree_binding_changed"); f.releasePage(); await pending;
    expect(browser.getSnapshot()).toEqual({ phase: "blocked", pending: false, pages: [], activePath: [],
      visiblePage: 0, error: "tree_binding_changed" });
  } finally { f.releasePage(); browser.dispose(); await f.dispose(); }
});

test("canceled invocation authority cannot start a native tree read", async () => {
  const f = await fixture();
  try {
    f.cancelNext();
    expect(await f.read({ operation: "open", sessionId: "session" }))
      .toEqual({ status: "error", code: "tree_authority_unavailable" });
    expect(f.commands).toEqual([]);
  } finally { await f.dispose(); }
});

test("native diagnostics are reduced to stable read errors without private error text", async () => {
  const f = await fixture({ nativeError: "SYNTHETIC_PRIVATE_ERROR /private/path?token=synthetic" });
  try {
    const start = await f.read({ operation: "open", sessionId: "session" });
    if (start.status !== "opened") throw Error("fixture open failed");
    f.failPage();
    expect(await f.read({ operation: "page", snapshot: start.snapshot, cursor: start.cursor }))
      .toEqual({ status: "error", code: "tree_read_failed" });
  } finally { await f.dispose(); }
});


test("a second authorized Browser View cannot read or evict another view's snapshot", async () => {
  const f = await fixture();
  try {
    const { start } = await complete(f);
    f.switchPeer();
    expect(await f.read({ operation: "preview", snapshot: start.snapshot, entryId: "x" }))
      .toEqual({ status: "error", code: "tree_binding_changed" });
    f.restorePeer();
    const preview = await f.read({ operation: "preview", snapshot: start.snapshot, entryId: "x" });
    expect(preview.status === "preview" && preview.text).toBe("Abandoned answer");
  } finally { await f.dispose(); }
});

test("preview rereads a strict native cursor and refuses changed source content rather than cached text", async () => {
  const f = await fixture();
  try {
    const { start } = await complete(f); f.rewrite();
    expect(await f.read({ operation: "preview", snapshot: start.snapshot, entryId: "x" }))
      .toEqual({ status: "error", code: "tree_source_changed" });
  } finally { await f.dispose(); }
});

test("a larger synthetic tree remains reachable through native pages and renders bounded node windows", async () => {
  const { TreeBrowser } = await import("../../packages/tree/browser.ts");
  const { TreePanel } = await import("../../packages/tree/panel.tsx");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { createElement } = await import("react");
  const pages: HistoryItem[][] = [];
  for (let index = 0; index < 2048; index++) {
    if (index % 32 === 0) pages.push([]);
    pages.at(-1)?.push(item(index === 2047 ? "e" : `node-${index}`,
      index === 0 ? null : `node-${index - 1}`, true, `Retained ${index}`));
  }
  const f = await fixture({ pages }), browser = new TreeBrowser("session", f.read);
  try {
    await browser.open();
    while (browser.getSnapshot().phase === "partial") await browser.nextPage();
    expect(browser.getSnapshot().activePath).toHaveLength(2048);
    expect(f.commands.filter(type => type === "history_snapshot_page")).toHaveLength(64);
    expect(f.commands.filter(type => type === "history_snapshot_open")).toHaveLength(1);
    const html = renderToStaticMarkup(createElement(TreePanel, { browser }));
    expect((html.match(/aria-pressed=/g) ?? [])).toHaveLength(96);
    expect(html).toContain("Show more retained nodes");
  } finally { browser.dispose(); await f.dispose(); }
});

test("tree pages and old previews remain reachable past the former aggregate text limit", async () => {
  const text = "x".repeat(32 * 1024);
  const pages = Array.from({ length: 26 }, (_, page) => Array.from({ length: 20 }, (_, offset) => {
    const index = page * 20 + offset;
    return item(index === 519 ? "e" : `node-${index}`, index ? `node-${index - 1}` : null, true,
      index === 0 ? "Old question" : text);
  }));
  const f = await fixture({ pages });
  try {
    const { start, last } = await complete(f);
    expect(last.status).toBe("page");
    expect(last.status === "page" && last.activePath).toHaveLength(520);
    const preview = await f.read({ operation: "preview", snapshot: start.snapshot, entryId: "node-0" });
    expect(preview.status === "preview" && preview.text).toBe("Old question");
  } finally { await f.dispose(); }
});

const previewBudgetCases = [
  { name: "too many preview pages", partsPerPage: 1, partText: "x" },
  { name: "too much preview text", partsPerPage: 16, partText: "x".repeat(32 * 1024) },
];
for (const { name, partsPerPage, partText } of previewBudgetCases) {
  test(`refusing ${name} leaves other Tree selections available`, async () => {
    const { TreeBrowser } = await import("../../packages/tree/browser.ts");
    const pages = [[item("a", null, true, "Small question")]];
    for (let index = 0; index < 65; index++) {
      if (index % partsPerPage === 0) pages.push([]);
      pages.at(-1)?.push({ ...item(`e:part:${index}`, "a", true, partText),
        entryId: "e", partIndex: index, partCount: 65 });
    }
    const f = await fixture({ pages }), browser = new TreeBrowser("session", f.read);
    try {
      await browser.open();
      while (browser.getSnapshot().phase === "partial") await browser.nextPage();
      expect(browser.getSnapshot().phase).toBe("complete");
      await browser.select("e");
      expect(browser.getSnapshot()).toMatchObject({ phase: "complete", error: "tree_preview_budget" });
      expect(browser.getSnapshot().preview).toBeUndefined();
      expect(f.commands.filter(type => type === "history_snapshot_page")).toHaveLength(pages.length);
      await browser.select("a");
      expect(browser.getSnapshot().preview?.text).toBe("Small question");
      expect(browser.getSnapshot().error).toBeUndefined();
    } finally { browser.dispose(); await f.dispose(); }
  });
}


test("an empty nonterminal native page cannot grow an unbounded cursor chain", async () => {
  const f = await fixture({ pages: [[]], emptyContinuation: true });
  try {
    const start = await f.read({ operation: "open", sessionId: "session" });
    if (start.status !== "opened") throw Error("fixture open failed");
    expect(await f.read({ operation: "page", snapshot: start.snapshot, cursor: start.cursor }))
      .toEqual({ status: "error", code: "tree_invalid_page" });
  } finally { await f.dispose(); }
});

test("an oversized advertised snapshot is refused before any native page allocation", async () => {
  const f = await fixture({ advertisedParts: 60001 });
  try {
    expect(await f.read({ operation: "open", sessionId: "session" }))
      .toEqual({ status: "error", code: "tree_cache_budget" });
    expect(f.commands).toEqual(["history_snapshot_open", "history_snapshot_close"]);
  } finally { await f.dispose(); }
});

test("oversized native snapshot metadata is refused and closed before reading any page", async () => {
  const catalogBinding = { sourceId: "source", instanceId: "instance", nativeSessionId: "session",
    reference: "x".repeat(4097) };
  for (const openMetadata of [{ snapshot: "x".repeat(257) },
    { cut: { ...cut, sourceBindingStatus: "catalog" as const, catalogBinding } }]) {
    const f = await fixture({ openMetadata });
    try {
      expect(await f.read({ operation: "open", sessionId: "session" }))
        .toEqual({ status: "error", code: "tree_cache_budget" });
      expect(f.commands).toEqual(["history_snapshot_open", "history_snapshot_close"]);
    } finally { await f.dispose(); }
  }
});
