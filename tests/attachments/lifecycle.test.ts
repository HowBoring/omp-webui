import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { linkSync, mkdtempSync, readdirSync, renameSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { OriginalStore, originalLimits, type OriginalLimits, type OriginalProtection, type OriginalScope,
  type OriginalStoreOptions } from "../../packages/attachments/store.ts";

const hour = 60 * 60 * 1000;
const scope: OriginalScope = { hostId: "host", browserId: "browser", pageId: "page", profileId: "profile",
  sourceId: "source", instanceId: "instance", sessionId: "native", canonicalCwd: "/synthetic/project",
  draftId: "draft", authorityEpoch: "epoch", explicitOpen: true };
const access = () => ({ ...scope });
const descriptor = { displayName: "notes.txt", mediaType: "text/plain" as const, byteLength: 4 };
async function* body() { yield new TextEncoder().encode("note"); }

const roots: string[] = [];
const stores: OriginalStore[] = [];
const clearProtection = () => ({ status: "unreferenced", revision: "1" } as const);
function fixture(protection: OriginalStoreOptions["protection"] | null = clearProtection,
  limits: Partial<OriginalLimits> = { totalBytes: 8 }) {
  const dataDir = mkdtempSync("/tmp/attachment-lifecycle-");
  roots.push(dataDir);
  let now = 100 * hour;
  return {
    advance: (delta: number) => { now += delta; },
    open: (recovery: OriginalStoreOptions["recovery"] = "exclusive-host-startup") => {
      const store = new OriginalStore({ dataDir, recovery, limits, clock: () => now,
        ...(protection ? { protection } : {}) });
      stores.push(store);
      return store;
    },
    dataDir,
  };
}
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

test("an unsent Original becomes collectable at 24 hours across read and Store restart", async () => {
  const { advance, open } = fixture();
  const store = open();
  const original = await store.stage(access, descriptor, body());
  advance(24 * hour - 1);
  expect((await store.read(access, original.objectId)).bytes).toEqual(new TextEncoder().encode("note"));
  expect(store.collectExpired()).toEqual({ expired: 0, reclaimed: 0, next: null });
  store.close();

  const reopened = open();
  advance(1);
  expect(reopened.collectExpired()).toEqual({ expired: 1, reclaimed: 1, next: null });
  await expect(reopened.read(access, original.objectId)).rejects.toThrow("attachment_object_unavailable");
  expect(reopened.usage(access).chargedBytes).toBe(0);
});

test("confirmed edit and active recovery renew only the referenced Originals in the exact draft", async () => {
  const { advance, open } = fixture();
  const store = open();
  const otherAccess = () => ({ ...scope, pageId: "other-page" });
  const original = await store.stage(access, descriptor, body());
  const other = await store.stage(otherAccess, descriptor, body());
  expect(original.sha256).toBe(other.sha256);
  advance(12 * hour);
  expect(store.touchDraft(access, "explicit-edit", [original.objectId, other.objectId]))
    .toEqual({ renewed: [original.objectId], unavailable: [other.objectId] });
  advance(12 * hour);
  expect(store.collectExpired()).toEqual({ expired: 1, reclaimed: 1, next: null });
  await expect(store.read(otherAccess, other.objectId)).rejects.toThrow("attachment_object_unavailable");
  const second = open("shared-connection");
  expect(second.touchDraft(access, "active-recovery", [other.objectId, original.objectId]))
    .toEqual({ renewed: [original.objectId], unavailable: [other.objectId] });
  advance(24 * hour);
  expect(store.touchDraft(access, "active-recovery", [original.objectId]))
    .toEqual({ renewed: [], unavailable: [original.objectId] });
  expect(store.collectExpired()).toEqual({ expired: 1, reclaimed: 1, next: null });
});

test("confirmed deletion removes only the reviewed logical Original and frees its charged bytes", async () => {
  const { open } = fixture();
  const store = open();
  const original = await store.stage(access, descriptor, body());
  const sameBytes = await store.stage(access, descriptor, body());
  expect(sameBytes.sha256).toBe(original.sha256);
  expect(() => store.previewDeletion(() => ({ ...scope, pageId: "elsewhere" }), original.objectId))
    .toThrow("attachment_object_unavailable");
  const preview = store.previewDeletion(access, original.objectId);
  expect(preview.original).toEqual(original);
  expect(preview.impact).toEqual({ draftId: "draft", losesOriginalAccess: true, laterToolReadsMayFail: true });
  expect(store.usage(access).chargedBytes).toBe(8);

  expect(store.confirmDeletion(access, original.objectId, preview.confirmationId)).toEqual({ reclaimed: true });
  expect(() => store.confirmDeletion(access, original.objectId, preview.confirmationId))
    .toThrow("attachment_deletion_confirmation_required");
  await expect(store.read(access, original.objectId)).rejects.toThrow("attachment_object_unavailable");
  expect((await store.read(access, sameBytes.objectId)).sha256).toBe(original.sha256);
  expect(store.usage(access).chargedBytes).toBe(4);
});

test("retention and confirmed deletion require a current exact unreferenced determination", async () => {
  let protection: OriginalProtection = { status: "unreferenced", revision: "1" };
  const { authorityEpoch, explicitOpen, ...expectedBinding } = scope;
  const { advance, open } = fixture(({ objectId, binding }) => {
    if (objectId !== original.objectId || !Bun.deepEquals(binding, expectedBinding)) throw Error("wrong Original scope");
    return protection;
  });
  const store = open();
  const original = await store.stage(access, descriptor, body());
  advance(24 * hour);
  for (const status of ["occupied", "executing", "unresolved-submission", "native-associated", "unknown"] as const) {
    protection = { status: "unreferenced", revision: status };
    const { confirmationId } = store.previewDeletion(access, original.objectId);
    protection = { status };
    expect(() => store.confirmDeletion(access, original.objectId, confirmationId)).toThrow("attachment_original_protected");
    expect(() => store.previewDeletion(access, original.objectId)).toThrow("attachment_original_protected");
    expect(store.collectExpired()).toEqual({ expired: 0, reclaimed: 0, next: null });
    protection = { status: "unreferenced", revision: `${status}-cleared` };
    expect(() => store.confirmDeletion(access, original.objectId, confirmationId))
      .toThrow("attachment_deletion_confirmation_required");
  }
  const superseded = store.previewDeletion(access, original.objectId);
  protection = { status: "unreferenced", revision: "2" };
  expect(() => store.confirmDeletion(access, original.objectId, superseded.confirmationId))
    .toThrow("attachment_deletion_confirmation_required");
  expect(store.usage(access).chargedBytes).toBe(4);
  const fresh = store.previewDeletion(access, original.objectId);
  expect(store.confirmDeletion(access, original.objectId, fresh.confirmationId)).toEqual({ reclaimed: true });
});

test("the initial clock starts at publication and collects a published Original whose reply was lost", async () => {
  const { advance, open } = fixture();
  const store = open(), collector = open("shared-connection");
  async function* slowBody() {
    advance(24 * hour);
    expect(collector.collectExpired()).toEqual({ expired: 0, reclaimed: 0, next: null });
    yield new TextEncoder().encode("note");
  }
  async function uploadWithDroppedReply() {
    await store.stage(access, descriptor, slowBody());
    throw Error("carrier dropped reply");
  }
  await expect(uploadWithDroppedReply()).rejects.toThrow("carrier dropped reply");
  expect(collector.usage(access).chargedBytes).toBe(4);
  advance(24 * hour - 1);
  expect(collector.collectExpired()).toEqual({ expired: 0, reclaimed: 0, next: null });
  advance(1);
  expect(collector.collectExpired()).toEqual({ expired: 1, reclaimed: 1, next: null });
  expect(collector.usage(access).chargedBytes).toBe(0);
});

test("an Original from the previous Store schema retains its original staged clock during migration", async () => {
  const { dataDir, open, advance } = fixture();
  const objectId = "f7f91233-40ac-4167-a974-895a1ab1380a";
  const sha256 = "edb465624291e4053c6c5ea4b7eb320dec773e10a57d26b95dcf0564f8e310f8";
  {
    using previous = new Database(join(dataDir, "originals.sqlite"), { strict: true });
    previous.exec(`CREATE TABLE budget (id INTEGER PRIMARY KEY, limits TEXT NOT NULL);
      CREATE TABLE originals (id TEXT PRIMARY KEY, scope TEXT NOT NULL, size INTEGER NOT NULL,
        displayName TEXT NOT NULL, mediaType TEXT NOT NULL, state TEXT NOT NULL, sha256 TEXT, stagedAt INTEGER NOT NULL);`);
    previous.query("INSERT INTO budget VALUES (1, ?)").run(JSON.stringify({ ...originalLimits, totalBytes: 8 }));
    const scopeKey = JSON.stringify(["host", "browser", "page", "profile", "source", "instance", "native",
      "/synthetic/project", "draft"]);
    previous.query("INSERT INTO originals VALUES (?, ?, 4, 'notes.txt', 'text/plain', 'staged-unprepared', ?, ?)")
      .run(objectId, scopeKey, sha256, 76 * hour + 1);
  }
  writeFileSync(join(dataDir, `${objectId}.original`), "note", { mode: 0o600 });

  const migrated = open();
  expect((await migrated.read(access, objectId)).sha256).toBe(sha256);
  expect(migrated.collectExpired()).toEqual({ expired: 0, reclaimed: 0, next: null });
  advance(1);
  expect(migrated.collectExpired()).toEqual({ expired: 1, reclaimed: 1, next: null });
});

test("absent or unavailable lifecycle protection retains old Originals", async () => {
  for (const protection of [null, () => { throw Error("protection unavailable"); }] as const) {
    const { advance, open } = fixture(protection);
    const store = open();
    const original = await store.stage(access, descriptor, body());
    advance(48 * hour);
    expect(store.collectExpired()).toEqual({ expired: 0, reclaimed: 0, next: null });
    expect(() => store.previewDeletion(access, original.objectId)).toThrow("attachment_original_protected");
    if (protection) await expect(store.read(access, original.objectId)).rejects.toThrow("attachment_original_protected");
    else expect((await store.read(access, original.objectId)).objectId).toBe(original.objectId);
  }
});

test("the staging read refuses known unresolved or Native-associated Originals across reopen", async () => {
  let protection: OriginalProtection = clearProtection();
  const { open } = fixture(() => protection);
  const store = open();
  const { objectId } = await store.stage(access, descriptor, body());
  store.close();

  const reopened = open();
  for (const status of ["unresolved-submission", "native-associated"] as const) {
    protection = { status };
    await expect(reopened.read(access, objectId)).rejects.toThrow("attachment_original_protected");
  }
  expect(reopened.usage(access).chargedBytes).toBe(4);
});

test("a collection pass advances after a bounded number of IDs even when none are eligible", async () => {
  const { open } = fixture(clearProtection, { totalBytes: 1024, draftObjects: 256 });
  const store = open();
  for (let index = 0; index < 129; index++) await store.stage(access, descriptor, body());

  const first = store.collectExpired();
  expect(first).toEqual({ expired: 0, reclaimed: 0, next: expect.any(String) });
  expect(store.collectExpired(first.next ?? undefined)).toEqual({ expired: 0, reclaimed: 0, next: null });
});

test("revocation during confirmation and elapsed confirmations require a fresh user action", async () => {
  let allowed = true, revokeOnInspection = false;
  const { advance, open } = fixture(() => {
    if (revokeOnInspection) allowed = false;
    return { status: "unreferenced", revision: "1" };
  });
  const authorized = () => { if (!allowed) throw Error("revoked"); return access(); };
  const store = open();
  const { objectId } = await store.stage(authorized, descriptor, body());
  const preview = store.previewDeletion(authorized, objectId);
  revokeOnInspection = true;
  expect(() => store.confirmDeletion(authorized, objectId, preview.confirmationId)).toThrow("attachment_authority_unavailable");
  revokeOnInspection = false;
  allowed = true;
  expect(() => store.confirmDeletion(authorized, objectId, preview.confirmationId))
    .toThrow("attachment_deletion_confirmation_required");
  const expiring = store.previewDeletion(authorized, objectId);
  advance(5 * 60 * 1000);
  expect(() => store.confirmDeletion(authorized, objectId, expiring.confirmationId))
    .toThrow("attachment_deletion_confirmation_required");
  expect(store.usage(authorized).chargedBytes).toBe(4);
});

test("a confirmation that expires during the final authority check cannot remove an Original", async () => {
  const { open, advance } = fixture();
  const store = open();
  const { objectId } = await store.stage(access, descriptor, body());
  const { confirmationId } = store.previewDeletion(access, objectId);
  let checks = 0;
  expect(() => store.confirmDeletion(() => {
    if (++checks === 2) advance(5 * 60 * 1000);
    return access();
  }, objectId, confirmationId)).toThrow("attachment_deletion_confirmation_required");
  expect((await store.read(access, objectId)).objectId).toBe(objectId);
});

test("deletion on a second connection invalidates a read at its final authority check", async () => {
  const { open } = fixture();
  const store = open(), second = open("shared-connection");
  const { objectId } = await store.stage(access, descriptor, body());
  const { confirmationId } = second.previewDeletion(access, objectId);
  let checks = 0;
  await expect(store.read(() => {
    if (++checks === 2) second.confirmDeletion(access, objectId, confirmationId);
    return access();
  }, objectId)).rejects.toThrow("attachment_object_unavailable");
});

test("logical deletion keeps failed physical cleanup charged until exclusive recovery", async () => {
  const { dataDir, open } = fixture();
  const store = open();
  const { objectId } = await store.stage(access, descriptor, body());
  const stillStaged = await store.stage(access, descriptor, body());
  const link = `${dataDir}-linked`;
  roots.push(link);
  const name = readdirSync(dataDir).find(name => name.startsWith(objectId));
  if (!name) throw Error("fixture payload absent");
  linkSync(join(dataDir, name), link);

  const { confirmationId } = store.previewDeletion(access, objectId);
  expect(store.confirmDeletion(access, objectId, confirmationId)).toEqual({ reclaimed: false });
  await expect(store.read(access, objectId)).rejects.toThrow("attachment_object_unavailable");
  await expect(store.stage(access, descriptor, body())).rejects.toThrow("attachment_store_full");
  expect(store.usage(access).chargedBytes).toBe(8);
  store.close();

  unlinkSync(link);
  const unexpected = join(dataDir, `${objectId}.partial`);
  writeFileSync(unexpected, "x", { mode: 0o600 });
  expect(() => open()).toThrow("attachment_unaccounted_data");
  expect(readdirSync(dataDir)).toContain(name);
  expect(readdirSync(dataDir)).toContain(`${objectId}.partial`);
  unlinkSync(unexpected);
  const reopened = open();
  expect(reopened.usage(access).chargedBytes).toBe(4);
  await expect(reopened.read(access, objectId)).rejects.toThrow("attachment_object_unavailable");
  expect((await reopened.read(access, stillStaged.objectId)).sha256).toBe(stillStaged.sha256);
  expect((await reopened.stage(access, descriptor, body())).byteLength).toBe(4);
});

test("exclusive recovery preserves an oversized interrupted publication for investigation", async () => {
  const { dataDir, open } = fixture();
  const store = open(), displaced = `${dataDir}-displaced`;
  roots.push(displaced);
  const interrupted = () => {
    if (readdirSync(dataDir).some(name => name.endsWith(".original"))) {
      renameSync(dataDir, displaced);
      throw Error("interrupted publication");
    }
    return access();
  };
  await expect(store.stage(interrupted, descriptor, body())).rejects.toThrow("attachment_authority_unavailable");
  store.close();
  renameSync(displaced, dataDir);
  const payload = readdirSync(dataDir).find(name => name.endsWith(".original"));
  if (!payload) throw Error("fixture payload absent");
  writeFileSync(join(dataDir, payload), "oversized");
  expect(() => open()).toThrow("attachment_unaccounted_data");
  expect(readdirSync(dataDir)).toContain(payload);

  writeFileSync(join(dataDir, payload), "note");
  const reopened = open();
  expect(reopened.usage(access).chargedBytes).toBe(0);
  expect((await reopened.stage(access, descriptor, body())).byteLength).toBe(4);
});

test("repeating bounded expiry passes drain a large stale inventory without an unbounded pause", async () => {
  const { advance, open } = fixture(clearProtection, { totalBytes: 1024 });
  const store = open();
  const one = { displayName: "one.txt", mediaType: "text/plain" as const, byteLength: 1 };
  for (let index = 0; index < 130; index++) {
    await store.stage(() => ({ ...scope, draftId: `draft-${index}` }), one,
      (async function* () { yield new Uint8Array([97]); })());
  }
  expect(store.usage(access)).toMatchObject({ chargedBytes: 130, objects: 130 });
  advance(24 * hour);
  expect(store.collectExpiredPages(1)).toEqual({ expired: 128, reclaimed: 128 });
  expect(store.collectExpiredPages(1)).toEqual({ expired: 2, reclaimed: 2 });
  expect(store.usage(access)).toMatchObject({ chargedBytes: 0, objects: 0 });
});
