import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, unlinkSync,
  writeFileSync } from "node:fs";
import { join } from "node:path";
import { OriginalStore, type OriginalScope, type OriginalLimits } from "../../packages/attachments/store.ts";
import { OriginalIntake } from "../../packages/attachments/intake.ts";

const roots: string[] = [];
const stores: OriginalStore[] = [];
const image = Uint8Array.from([71, 73, 70, 56, 57, 97, 1, 0, 1, 0, 0, 0, 0, 59]);
const scope: OriginalScope = { hostId: "host", browserId: "browser", pageId: "page", profileId: "profile",
  sourceId: "source", instanceId: "instance", sessionId: "native", canonicalCwd: "/synthetic/project",
  draftId: "draft", authorityEpoch: "epoch", explicitOpen: true };
const access = () => ({ ...scope });
function open(limits: Partial<OriginalLimits> = {}) {
  const dataDir = mkdtempSync(join("/tmp", "attachment-source-")); roots.push(dataDir);
  const store = new OriginalStore({ dataDir, recovery: "exclusive-host-startup", limits }); stores.push(store);
  return { store, dataDir };
}
async function* bytes(value = image) { yield value; }
const descriptor = { displayName: "../../project/overwrite.gif", mediaType: "image/gif" as const,
  byteLength: image.length };
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

test("two SQLite connections reserve a shared budget before reading concurrent bodies", async () => {
  const limits = { totalBytes: 20 };
  const { store, dataDir } = open(limits);
  const second = new OriginalStore({ dataDir, recovery: "shared-connection", limits }); stores.push(second);
  let entered!: () => void, release!: () => void;
  const waiting = new Promise<void>(resolve => { entered = resolve; });
  const barrier = new Promise<void>(resolve => { release = resolve; });
  async function* stalled() { entered(); await barrier; yield image.subarray(0, 5); yield image.subarray(5); }
  const first = store.stage(access, descriptor, stalled());
  await waiting;
  let read = false;
  async function* untouched() { read = true; yield image; }
  await expect(second.stage(access, descriptor, untouched())).rejects.toThrow("attachment_store_full");
  expect(read).toBe(false);
  expect(second.usage(access).chargedBytes).toBe(14);
  release();
  const accepted = await first;
  expect((await second.read(access, accepted.objectId)).bytes).toEqual(image);
  store.close(); second.close();
  const reopened = new OriginalStore({ dataDir, recovery: "exclusive-host-startup", limits }); stores.push(reopened);
  expect(reopened.usage(access).chargedBytes).toBe(14);
  await expect(reopened.stage(access, descriptor, bytes())).rejects.toThrow("attachment_store_full");
});

test("in-flight intake reservations are bounded separately from durable objects", async () => {
  const { store } = open({ intakes: 1 });
  let release!: () => void, entered!: () => void;
  const waiting = new Promise<void>(resolve => { entered = resolve; });
  const barrier = new Promise<void>(resolve => { release = resolve; });
  async function* stalled() { entered(); await barrier; yield image; }
  const first = store.stage(access, descriptor, stalled());
  await waiting;
  let second: Promise<unknown> | undefined;
  try {
    second = store.stage(() => ({ ...scope, draftId: "other-draft" }), descriptor, bytes());
    await expect(second).rejects.toThrow("attachment_intake_budget");
  } finally { release(); await first; await second?.catch(() => {}); }
  expect((await store.stage(access, descriptor, bytes())).state).toBe("staged-unprepared");
});

test("current browser, page, directory, profile, source, instance, Session and draft rights fence each read", async () => {
  const { store } = open();
  const first = await store.stage(access, descriptor, bytes());
  for (const field of ["hostId", "browserId", "pageId", "profileId", "sourceId", "instanceId", "sessionId",
    "canonicalCwd", "draftId"] as const) {
    await expect(store.read(() => ({ ...scope, [field]: "other" }), first.objectId))
      .rejects.toThrow("attachment_object_unavailable");
  }
  const otherAccess = () => ({ ...scope, browserId: "other" });
  const other = await store.stage(otherAccess, descriptor, bytes());
  expect(other.sha256).toBe(first.sha256);
  expect(other.objectId).not.toBe(first.objectId);
  await expect(store.read(access, other.objectId)).rejects.toThrow("attachment_object_unavailable");
  await expect(store.read(access, first.sha256)).rejects.toThrow("attachment_object_unavailable");
  await expect(store.read(() => { throw Error("revoked"); }, first.objectId))
    .rejects.toThrow("attachment_authority_unavailable");
});

test("revocation between chunks cleans partial bytes and leaves the budget reusable", async () => {
  const { store } = open({ totalBytes: 14 });
  let allowed = true;
  const current = () => { if (!allowed) throw Error("revoked"); return access(); };
  async function* revoked() { yield image.subarray(0, 7); allowed = false; yield image.subarray(7); }
  await expect(store.stage(current, descriptor, revoked())).rejects.toThrow("attachment_authority_unavailable");
  expect(store.usage(access).chargedBytes).toBe(0);
  expect((await store.stage(access, descriptor, bytes())).byteLength).toBe(14);
});

test("exclusive startup reclaims interrupted partial data only after its directory returns", async () => {
  const { store, dataDir } = open({ totalBytes: 14 });
  const displaced = `${dataDir}-displaced`;
  roots.push(displaced);
  async function* interrupted() {
    yield image.subarray(0, 7);
    renameSync(dataDir, displaced);
    yield image.subarray(7);
  }
  await expect(store.stage(access, descriptor, interrupted())).rejects.toThrow();
  store.close();
  renameSync(displaced, dataDir);
  const reopened = new OriginalStore({ dataDir, recovery: "exclusive-host-startup", limits: { totalBytes: 14 } });
  stores.push(reopened);
  expect(reopened.usage(access).chargedBytes).toBe(0);
  expect((await reopened.stage(access, descriptor, bytes())).byteLength).toBe(14);
});

test("single-object, draft-count and draft-byte refusals preserve already staged originals", async () => {
  for (const limits of [{ objectBytes: 13 }, { draftObjects: 1 }, { draftBytes: 20 }]) {
    const { store } = open(limits);
    if (limits.objectBytes) {
      await expect(store.stage(access, descriptor, bytes())).rejects.toThrow("attachment_object_budget");
      continue;
    }
    const first = await store.stage(access, descriptor, bytes());
    await expect(store.stage(access, descriptor, bytes())).rejects.toThrow("attachment_draft_budget");
    expect((await store.read(access, first.objectId)).bytes).toEqual(image);
  }
});

test("short, oversized and disguised image streams cannot publish or consume quota", async () => {
  const { store } = open();
  for (const value of [image.subarray(0, 10), new Uint8Array(15), new Uint8Array(14)]) {
    await expect(store.stage(access, descriptor, bytes(value))).rejects.toThrow();
    expect(store.usage(access).chargedBytes).toBe(0);
  }
});

test("a missing original is a bounded public failure and its charged bytes are not silently reclaimed", async () => {
  const { store, dataDir } = open();
  const original = await store.stage(access, descriptor, bytes());
  // Real external-storage fault at the configured private filesystem seam, not a database/private-field assertion.
  const payload = readdirSync(dataDir).find(name => readFileSync(join(dataDir, name)).equals(Buffer.from(image)));
  if (!payload) throw Error("fixture payload absent");
  unlinkSync(join(dataDir, payload));
  await expect(store.read(access, original.objectId)).rejects.toThrow("attachment_original_unavailable");
  expect(store.usage(access).chargedBytes).toBe(14);
});

test("display traversal cannot overwrite a project file and stored bytes remain owner-only", async () => {
  const { store, dataDir } = open();
  const project = mkdtempSync("/tmp/attachment-project-"); roots.push(project);
  const path = join(project, "kept.gif"); writeFileSync(path, "keep project content");
  const original = await store.stage(access, { ...descriptor, displayName: path }, bytes());
  expect(readFileSync(path, "utf8")).toBe("keep project content");
  expect(original.displayName).toBe(path);
  expect(statSync(dataDir).mode & 0o777).toBe(0o700);
  expect(readdirSync(dataDir).every(name => (statSync(join(dataDir, name)).mode & 0o077) === 0)).toBe(true);
});

test("raw intake requires explicit verified Open and never reads the body on a mismatched target", async () => {
  const { store } = open();
  const caller = {};
  let opened = false, actualSession = "native", bodyRead = false;
  const intake = new OriginalIntake(store, (current, target) => {
    if (current !== caller || !opened) throw Error("not explicitly opened");
    return { ...scope, sessionId: actualSession, draftId: target.draftId };
  });
  async function* body() { bodyRead = true; yield image.subarray(0, 3); yield image.subarray(3); }
  const target = { sessionId: "native", draftId: "draft" };
  await expect(intake.stage(caller, target, descriptor, body())).rejects.toThrow("attachment_authority_unavailable");
  expect(bodyRead).toBe(false);
  opened = true; actualSession = "other-session";
  await expect(intake.stage(caller, target, descriptor, body())).rejects.toThrow("attachment_authority_unavailable");
  expect(bodyRead).toBe(false);
  actualSession = "native";
  const original = await intake.stage(caller, target, descriptor, body());
  expect((await intake.read(caller, target, original.objectId)).bytes).toEqual(image);
  opened = false;
  await expect(intake.read(caller, target, original.objectId)).rejects.toThrow("attachment_authority_unavailable");
});

test("an authority-epoch change during upload invalidates publication without losing prior draft objects", async () => {
  const { store } = open();
  const prior = await store.stage(access, descriptor, bytes());
  let epoch = "epoch";
  async function* changed() { yield image.subarray(0, 8); epoch = "new-epoch"; yield image.subarray(8); }
  await expect(store.stage(() => ({ ...scope, authorityEpoch: epoch }), descriptor, changed()))
    .rejects.toThrow("attachment_binding_changed");
  expect(store.usage(access).chargedBytes).toBe(14);
  expect((await store.read(access, prior.objectId)).bytes).toEqual(image);
});

test("a second connection cannot change the persisted budget to bypass a full store", async () => {
  const { store, dataDir } = open({ totalBytes: 14 });
  await store.stage(access, descriptor, bytes());
  expect(() => new OriginalStore({ dataDir, recovery: "shared-connection", limits: { totalBytes: 28 } }))
    .toThrow("attachment_limits_changed");
  expect(store.usage(access).chargedBytes).toBe(14);
});

test("storage corruption refuses exact-original reads rather than returning changed content", async () => {
  const { store, dataDir } = open();
  const original = await store.stage(access, descriptor, bytes());
  const payload = readdirSync(dataDir).find(name => readFileSync(join(dataDir, name)).equals(Buffer.from(image)));
  if (!payload) throw Error("fixture payload absent");
  writeFileSync(join(dataDir, payload), Uint8Array.from([71, 73, 70, 56, 57, 97, 2, 0, 1, 0, 0, 0, 0, 59]));
  await expect(store.read(access, original.objectId)).rejects.toThrow("attachment_original_corrupt");
  expect(store.usage(access).chargedBytes).toBe(14);
});

test("restart refuses unaccounted payloads even when their names reuse a known object ID", async () => {
  const { store, dataDir } = open();
  const original = await store.stage(access, descriptor, bytes());
  store.close();
  writeFileSync(join(dataDir, original.objectId), image);
  expect(() => new OriginalStore({ dataDir, recovery: "exclusive-host-startup" }))
    .toThrow("attachment_unaccounted_data");
});

test("exact originals survive Host restart without becoming prepared or sent", async () => {
  const { store, dataDir } = open();
  const original = await store.stage(access, descriptor, bytes());
  store.close();
  const reopened = new OriginalStore({ dataDir, recovery: "exclusive-host-startup" }); stores.push(reopened);
  expect(original).toMatchObject({ state: "staged-unprepared", nativeAssociation: "unassociated",
    displayName: descriptor.displayName, byteLength: 14,
    sha256: "1f19970f056cd116a5fe3c02422c1ee1ac827136df470b5c89af492620512aa4" });
  expect((await reopened.read(access, original.objectId)).bytes).toEqual(image);
  expect(original.objectId).not.toContain("gif");
});

test("aborting a stalled upload releases its reservation without waiting for another chunk", async () => {
  const { store } = open();
  const abort = new AbortController();
  let entered!: () => void;
  const waiting = new Promise<void>(resolve => { entered = resolve; });
  let release!: (value: IteratorResult<Uint8Array>) => void;
  const body: AsyncIterable<Uint8Array> = { [Symbol.asyncIterator]() { return {
    next() { entered(); return new Promise(resolve => { release = resolve; }); },
  }; } };
  const pending = store.stage(access, descriptor, body, abort.signal);
  await waiting; abort.abort();
  const outcome = await Promise.race([pending.then(() => "published", error => String(error)),
    new Promise<string>(resolve => setTimeout(() => resolve("still waiting"), 30))]);
  release({ done: true, value: undefined });
  await pending.catch(() => {});
  expect(outcome).toContain("attachment_canceled");
  expect(store.usage(access).chargedBytes).toBe(0);
});

test("raw intake rejects an invalid target with one bounded code before body consumption", async () => {
  const { store } = open();
  const intake = new OriginalIntake(store, () => access());
  let consumed = false;
  async function* untouched() { consumed = true; yield image; }
  const target = { sessionId: "", draftId: "draft" };
  let pending: Promise<unknown> | undefined;
  expect(() => { pending = intake.stage({}, target, descriptor, untouched()); }).not.toThrow();
  await expect(pending).rejects.toThrow(/^attachment_invalid_target$/);
  expect(consumed).toBe(false);
  expect(store.usage(access).chargedBytes).toBe(0);
  expect(() => { pending = intake.read({}, target, "opaque-id"); }).not.toThrow();
  await expect(pending).rejects.toThrow(/^attachment_invalid_target$/);
});

test("raw intake rejects invalid descriptors without exposing schema details or consuming bytes", async () => {
  const { store } = open();
  const intake = new OriginalIntake(store, () => access());
  let consumed = false;
  async function* untouched() { consumed = true; yield image; }
  for (const invalid of [{ ...descriptor, byteLength: 0 }, { ...descriptor, displayName: "" },
    { ...descriptor, mediaType: "text/html" as const }]) {
    // @ts-expect-error The raw boundary must validate malformed runtime descriptors too.
    await expect(intake.stage({}, { sessionId: "native", draftId: "draft" }, invalid, untouched()))
      .rejects.toThrow(/^attachment_invalid_descriptor$/);
  }
  expect(consumed).toBe(false);
  expect(store.usage(access).chargedBytes).toBe(0);
});

test("raw intake bounds SQLite reservation errors and can stage after the storage fault clears", async () => {
  const { store, dataDir } = open();
  const intake = new OriginalIntake(store, () => access());
  const target = { sessionId: "native", draftId: "draft" };
  let consumed = false;
  async function* untouched() { consumed = true; yield image; }
  // A directory prevents SQLite from creating its rollback journal at the real filesystem boundary.
  const journal = join(dataDir, "originals.sqlite-journal");
  mkdirSync(journal);
  try {
    await expect(intake.stage({}, target, descriptor, untouched())).rejects.toThrow(/^attachment_storage_unavailable$/);
    expect(consumed).toBe(false);
  } finally { rmSync(journal, { recursive: true, force: true }); }
  expect(store.usage(access).chargedBytes).toBe(0);
  const staged = await intake.stage({}, target, descriptor, bytes());
  expect((await intake.read({}, target, staged.objectId)).bytes).toEqual(image);
});

test("raw intake retains revocation, binding, cancellation and quota refusal codes", async () => {
  const { store } = open({ totalBytes: 14 });
  let allowed = true, epoch = "epoch";
  const intake = new OriginalIntake(store, () => {
    if (!allowed) throw Error("revoked");
    return { ...scope, authorityEpoch: epoch };
  });
  const target = { sessionId: "native", draftId: "draft" };
  async function* revoked() { yield image.subarray(0, 7); allowed = false; yield image.subarray(7); }
  await expect(intake.stage({}, target, descriptor, revoked())).rejects.toThrow(/^attachment_authority_unavailable$/);
  allowed = true;
  async function* rebound() { yield image.subarray(0, 7); epoch = "new-epoch"; yield image.subarray(7); }
  await expect(intake.stage({}, target, descriptor, rebound())).rejects.toThrow(/^attachment_binding_changed$/);
  const abort = new AbortController(); abort.abort();
  await expect(intake.stage({}, target, descriptor, bytes(), abort.signal)).rejects.toThrow(/^attachment_canceled$/);
  expect(store.usage(access).chargedBytes).toBe(0);
  const original = await intake.stage({}, target, descriptor, bytes());
  await expect(intake.stage({}, target, descriptor, bytes())).rejects.toThrow(/^attachment_store_full$/);
  allowed = false;
  await expect(intake.read({}, target, original.objectId)).rejects.toThrow(/^attachment_authority_unavailable$/);
});

test("raw intake bounds oversized attachment-like producer errors and releases the reservation", async () => {
  const { store } = open();
  const intake = new OriginalIntake(store, () => access());
  async function* failed(): AsyncGenerator<Uint8Array> { throw Error(`attachment_${"x".repeat(100)}`); }
  await expect(intake.stage({}, { sessionId: "native", draftId: "draft" }, descriptor, failed()))
    .rejects.toThrow(/^attachment_storage_unavailable$/);
  expect(store.usage(access).chargedBytes).toBe(0);
});
