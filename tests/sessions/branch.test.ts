import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openBrowserAccess, type BrowserAccess, type BrowserAuthority } from "../../packages/access/index.ts";
import type { CatalogTransport } from "../../packages/compatibility/catalog-transport.ts";
import type { CatalogDescriptor } from "../../packages/contracts/generated/omp-wire.ts";
import { DirectoryGrants } from "../../packages/workspaces/grants.ts";
import { SessionIndex } from "../../packages/sessions/index.ts";
import { SessionSupervisor } from "../../packages/sessions/supervisor.ts";
import { OriginalStore, type OriginalScope } from "../../packages/attachments/store.ts";
import { nativeFixture } from "../catalog/fixture.ts";
import { catalog, launch } from "./worker.ts";

/** Fixture authoring only: the pinned native reader owns every product read below. */
const extra = [
  { type: "message", id: "entry-1", parentId: "entry-0", timestamp: "2026-01-01T00:00:02.000Z",
    message: { role: "assistant", content: [{ type: "text", text: "Synthetic answer" }], timestamp: 1767225602000 } },
  { type: "message", id: "entry-2", parentId: "entry-1", timestamp: "2026-01-01T00:00:03.000Z",
    message: { role: "user", content: [{ type: "text", text: "Follow-up question" }], timestamp: 1767225603000 } },
];
interface Fixture {
  home: string; cwd: string; dataDir: string; root: string; file: string; origin: string; cookie: string;
  authority: BrowserAuthority; grants: DirectoryGrants; index: SessionIndex; discovery: CatalogTransport;
  identity: BrowserAccess; selected: CatalogDescriptor; supervisor: SessionSupervisor; disposed(): Promise<void>;
}
async function fixture(onBranch?: (identity: BrowserAccess, previous: { sessionId: string; instanceId: string },
  native: { sessionId: string; instanceId: string }, entryIds: readonly string[]) => void | Promise<void>): Promise<Fixture> {
  const home = await mkdtemp(join(tmpdir(), "session-branch-"));
  const root = await nativeFixture(home, 2);
  const file = join(root, "bucket", "native-0000.jsonl");
  await Bun.write(file, (await readFile(file, "utf8")) + extra.map(row => JSON.stringify(row)).join("\n") + "\n");
  const cwd = join(home, "project"), dataDir = join(home, "host"), origin = "http://127.0.0.1:4321";
  const authority = openBrowserAccess({ dataDir, origin }), grants = new DirectoryGrants(dataDir), index = new SessionIndex(dataDir);
  grants.confirm(grants.preview(cwd).confirmation);
  const discovery = await catalog(home);
  const selected = (await discovery.catalog.page()).items.find(item => item.nativeSessionId === "native-0000")!;
  const exchange = await authority.handle(new Request(authority.bootstrapLink(), { headers: { host: "127.0.0.1:4321" } }));
  const cookie = exchange!.headers.get("set-cookie")!.split(";")[0]!;
  const identity = authority.admit(new Request(origin + "/api/sessions", { headers: { host: "127.0.0.1:4321", cookie } }), "read");
  if (identity instanceof Response) throw new Error("SYNTHETIC_AUTHENTICATION_FAILED");
  const supervisor = new SessionSupervisor({ authority, grants, index, catalog: discovery.catalog, launch: directory => launch(home, directory),
    ...(onBranch ? { onBranch } : {}) });
  async function disposed() { await supervisor.close(); await discovery.close(); authority.close(); grants.close(); index.close(); await rm(home, { recursive: true, force: true }); }
  return { home, cwd, dataDir, root, file, origin, cookie, authority, grants, index, discovery, identity, selected, supervisor, disposed };
}
/** Public native reads only: the retained tree of one Session, in its own order. */
async function retained(f: Fixture, supervisor = f.supervisor, sessionId = "native-0000") {
  const access = supervisor.treeAccess(f.identity, sessionId), opened = await access.history.open("tree");
  try {
    const ids: string[] = []; let cursor: string | undefined = opened.cursor;
    while (cursor) {
      const page = await access.history.page(cursor);
      ids.push(...page.items.filter(item => item.kind === "message" || item.kind === "compaction"
        || item.kind === "branch_summary" || item.kind === "reset_boundary" || item.kind === "custom_message").map(item => item.id));
      cursor = page.nextCursor;
    }
    return ids;
  } finally { await access.history.close(opened.snapshot); }
}
const digest = async (path: string) => createHash("sha256").update(await readFile(path)).digest("hex");

test("a native branch keeps only the target's source ancestors and leaves the source Session intact", async () => {
  const f = await fixture();
  try {
    const opened = await f.supervisor.open(f.identity, f.selected);
    expect(opened.registration.nativeSessionId).toBe("native-0000");
    const points = await f.supervisor.branchPoints(f.identity, opened.workerId);
    expect(points.generation).toBe(opened.generation);
    expect(points.points.map(point => point.entryId)).toEqual(["entry-0", "entry-2"]);
    const before = await digest(f.file);
    const result = await f.supervisor.branch(f.identity, opened.workerId, opened.generation, "entry-2");
    if (result.status !== "created") throw new Error("BRANCH_NOT_CREATED");
    const branchedId = result.nativeSessionId;
    expect({ previousSessionId: result.previousSessionId, targetEntryId: result.targetEntryId,
      retainedEntries: result.retainedEntries, text: result.text })
      .toEqual({ previousSessionId: "native-0000", targetEntryId: "entry-2", retainedEntries: 2, text: "Follow-up question" });
    expect(branchedId).not.toBe("native-0000");
    expect(result.view).toMatchObject({ state: "open", registration: { nativeSessionId: branchedId } });
    expect(await digest(f.file)).toBe(before);
    // The destination holds exactly the ancestors of the cut and never the target itself.
    expect(await retained(f, f.supervisor, branchedId)).toEqual(["entry-0", "entry-1"]);
    // The source Session, its sibling Session and its full path stay readable and unchanged.
    const source = await f.supervisor.switchTo(f.identity, f.selected);
    expect(source.registration.nativeSessionId).toBe("native-0000");
    expect(await retained(f)).toEqual(["entry-0", "entry-1", "entry-2"]);
    const sibling = (await f.discovery.catalog.page()).items.find(item => item.nativeSessionId === "native-0001")!;
    expect((await f.supervisor.switchTo(f.identity, sibling)).state).toBe("open");
    expect((await f.discovery.catalog.page()).items.map(item => item.nativeSessionId))
      .toEqual(expect.arrayContaining(["native-0000", "native-0001", branchedId]));
  } finally { await f.disposed(); }
}, 90_000);

test("a Host-verified native branch inherits Originals only for forwarded entry ids", async () => {
  const copied: number[] = [];
  let store: OriginalStore | undefined;
  const f = await fixture((_identity, previous, native, entryIds) => {
    copied.push(store!.inheritBranchLinks(previous.sessionId, previous.instanceId, native.sessionId, native.instanceId, entryIds));
  });
  const dataDir = await mkdtemp(join(tmpdir(), "branch-links-"));
  try {
    store = new OriginalStore({ dataDir, recovery: "exclusive-host-startup", clock: () => 0 });
    const opened = await f.supervisor.open(f.identity, f.selected);
    const sourceRegistration = opened.registration;
    const source: OriginalScope = { ...branchSource(), sessionId: sourceRegistration.nativeSessionId,
      sourceId: sourceRegistration.sourceId, instanceId: sourceRegistration.instanceId };
    const originalId = await associate(store, source);
    expect(store.history(() => source, ["entry-0"])).toHaveLength(1);
    const result = await f.supervisor.branch(f.identity, opened.workerId, opened.generation, "entry-2");
    if (result.status !== "created") throw new Error("BRANCH_NOT_CREATED");
    expect(result.nativeSessionId).not.toBe("native-0000");
    const registration = result.view!.registration;
    const branch: OriginalScope = { ...source, sessionId: registration.nativeSessionId, sourceId: registration.sourceId, instanceId: registration.instanceId };
    expect(store.history(() => branch, ["entry-0", "entry-1"])).toEqual([{ entryId: "entry-0", objectId: originalId,
      displayName: "photo.gif", mediaType: "image/gif", byteLength: branchImage.length, sha256: branchSha,
      availability: "available", width: null, height: null }]);
    expect(new Uint8Array((await store.readHistorical(() => branch, "entry-0", originalId, ["entry-0"])).bytes))
      .toEqual(branchImage);
    expect(copied).toEqual([1]);
    // The source Session keeps its own link row and instance.
    expect(store.history(() => source, ["entry-0"])).toHaveLength(1);
    expect(store.history(() => ({ ...branch, browserId: "other" }), ["entry-0"])).toEqual([]);
    expect(store.history(() => ({ ...branch, instanceId: source.instanceId }), ["entry-0"])).toEqual([]);
    await expect(store.readHistorical(() => ({ ...branch, pageId: "other" }), "entry-0", originalId, ["entry-0"]))
      .rejects.toThrow("attachment_object_unavailable");
    expect(await f.supervisor.switchTo(f.identity, f.selected)).toMatchObject({ registration: { nativeSessionId: "native-0000" } });
  } finally { store?.close(); await rm(dataDir, { recursive: true, force: true }); await f.disposed(); }
}, 90_000);

test("a native branch at the first user message creates an empty Session with the unsent text", async () => {
  const f = await fixture();
  try {
    const opened = await f.supervisor.open(f.identity, f.selected);
    const result = await f.supervisor.branch(f.identity, opened.workerId, opened.generation, "entry-0");
    if (result.status !== "created") throw new Error("BRANCH_NOT_CREATED");
    expect(result).toMatchObject({ retainedEntries: 0, text: "Synthetic fixture input", previousSessionId: "native-0000" });
    expect(await retained(f, f.supervisor, result.nativeSessionId)).toEqual([]);
    expect(result.view).toMatchObject({ state: "open" });
  } finally { await f.disposed(); }
}, 90_000);

test("assistant entries and stale generations never become a branch", async () => {
  const f = await fixture();
  try {
    const opened = await f.supervisor.open(f.identity, f.selected);
    await expect(f.supervisor.branch(f.identity, opened.workerId, opened.generation, "entry-1"))
      .rejects.toThrow("SESSION_BRANCH_TARGET_UNAVAILABLE");
    expect(f.supervisor.view(f.identity, opened.workerId)).toMatchObject({ state: "open", generation: opened.generation });
    await expect(f.supervisor.branch(f.identity, opened.workerId, crypto.randomUUID(), "entry-0"))
      .rejects.toThrow("SESSION_MANUAL_OPEN_REQUIRED");
    // No cut happened: the source still owns the target and no new Session exists.
    expect(await retained(f)).toEqual(["entry-0", "entry-1", "entry-2"]);
    expect((await f.discovery.catalog.page()).items).toHaveLength(2);
  } finally { await f.disposed(); }
}, 90_000);

test("a branched Session survives a Host restart and keeps the source independent", async () => {
  const f = await fixture();
  const created = await f.supervisor.open(f.identity, f.selected);
  const result = await f.supervisor.branch(f.identity, created.workerId, created.generation, "entry-2");
  if (result.status !== "created" || !result.view) throw new Error("BRANCH_VIEW_MISSING");
  const branchedId = result.nativeSessionId;
  await f.supervisor.close();
  const index = new SessionIndex(f.dataDir), discovery = await catalog(f.home);
  const supervisor = new SessionSupervisor({ authority: f.authority, grants: f.grants, index, catalog: discovery.catalog,
    launch: directory => launch(f.home, directory) });
  try {
    const descriptor = (await discovery.catalog.page()).items.find(item => item.nativeSessionId === branchedId)!;
    expect(descriptor.parentSession).toContain("native-0000.jsonl");
    const reopened = await supervisor.open(f.identity, descriptor);
    expect(reopened).toMatchObject({ state: "open", registration: { nativeSessionId: branchedId } });
    expect(await retained(f, supervisor, branchedId)).toEqual(["entry-0", "entry-1"]);
    const source = (await discovery.catalog.page()).items.find(item => item.nativeSessionId === "native-0000")!;
    expect((await supervisor.switchTo(f.identity, source)).registration.nativeSessionId).toBe("native-0000");
    expect(await retained(f, supervisor)).toEqual(["entry-0", "entry-1", "entry-2"]);
  } finally { await supervisor.close(); await discovery.close(); index.close(); await f.disposed(); }
}, 90_000);

const branchImage = Uint8Array.from([71, 73, 70, 56, 57, 97, 1, 0, 1, 0, 0, 0, 0, 59]);
const branchSha = createHash("sha256").update(branchImage).digest("hex");
function branchSource(): OriginalScope {
  return { hostId: "host", browserId: "browser", pageId: "page", profileId: "profile", sourceId: "a".repeat(64),
    instanceId: "b".repeat(64), sessionId: "native-0000", canonicalCwd: "/synthetic/project", draftId: "draft",
    authorityEpoch: "epoch", explicitOpen: true };
}
async function associate(store: OriginalStore, scope: OriginalScope) {
  async function* body() { yield branchImage; }
  const original = await store.stage(() => scope, { displayName: "photo.gif", mediaType: "image/gif",
    byteLength: branchImage.length }, body());
  const consent = { receiptId: "receipt", resultDigest: "d".repeat(64), draftRevision: "v1", authorityGeneration: "grant-v1" };
  const attachment = { originalId: original.objectId, originalSha256: branchSha, preparedId: "prepared-object",
    preparedSha256: "c".repeat(64), representationKind: "image" as const };
  const target = { sourceId: scope.sourceId, instanceId: scope.instanceId, nativeSessionId: scope.sessionId };
  const { representationKind, ...preparedItem } = attachment;
  store.reserveForSubmission(() => scope, { clientSubmissionId: "send", preparationId: "prepared-draft",
    draftRevision: "v1", authorityGeneration: "grant-v1" }, [original.objectId], {
    version: "attachment-preparation-v1", budgetVersion: "attachment-budgets-v1", ...consent,
    preparationId: "prepared-draft", draftId: scope.draftId, draftFingerprint: "e".repeat(64),
    binding: { ...target, contextId: "context", modelFingerprint: "model", imageCapable: true },
    expiresAt: 60_000, status: "ready", items: [{ ...preparedItem, status: "ready", degradations: [],
      representation: { kind: representationKind, mimeType: "image/gif", data: "R0lGODlhAQABAAAAADs=", width: 1, height: 1 } }] });
  store.recordSubmission(() => scope, "send", { version: "durable-submission-v1", clientSubmissionId: "send",
    target, origin: { ...target, clientSubmissionId: "send" }, found: true, admission: "local",
    reservation: "committed", persistence: "committed", operationOutcome: "succeeded", terminal: true,
    inputOutcome: "generated", duplicate: false, nextOffset: null,
    preparation: { ...consent, acceptedDegradations: [], attachments: [attachment] },
    relations: [{ relationId: "entry:entry-0", entryId: "entry-0", role: "input", availability: "retained",
      status: "observed", persistence: "committed", attachments: [{ ...attachment,
        entryPart: { kind: "content", index: 0 } }] }] });
  return original.objectId;
}
