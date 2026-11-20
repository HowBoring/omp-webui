import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { OriginalStore, type OriginalScope } from "../../packages/attachments/store.ts";
import { originalHistoryResponse, retainedEntries } from "../../apps/host/src/original-history.ts";
import type { TreeHistory } from "../../packages/tree/service.ts";

const sourceId = "a".repeat(64), instanceId = "b".repeat(64);
const scope: OriginalScope = { hostId: "host", browserId: "browser", pageId: "page", profileId: "profile",
  sourceId, instanceId, sessionId: "native", canonicalCwd: "/synthetic/project", draftId: "draft",
  authorityEpoch: "epoch", explicitOpen: true };
const access = () => ({ ...scope });
const image = Uint8Array.from([71, 73, 70, 56, 57, 97, 1, 0, 1, 0, 0, 0, 0, 59]);
const sha256 = createHash("sha256").update(image).digest("hex");
const attempt = { clientSubmissionId: "send", preparationId: "prepared-draft", draftRevision: "v1",
  authorityGeneration: "grant-v1" };
async function* body() { yield image; }
const roots: string[] = [];
const stores: OriginalStore[] = [];
function fixture() {
  const dataDir = mkdtempSync("/tmp/original-history-");
  roots.push(dataDir);
  return { dataDir, open: () => {
    const store = new OriginalStore({ dataDir, recovery: "exclusive-host-startup", clock: () => 0 });
    stores.push(store);
    return store;
  } };
}
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function evidence(objectId: string) {
  const attachment = { originalId: objectId, originalSha256: sha256, preparedId: "prepared-object",
    preparedSha256: "c".repeat(64), representationKind: "image" as const };
  const consent = { receiptId: "receipt", resultDigest: "d".repeat(64), draftRevision: attempt.draftRevision,
    authorityGeneration: attempt.authorityGeneration };
  const { representationKind, ...preparedItem } = attachment;
  return {
    receipt: { version: "attachment-preparation-v1", budgetVersion: "attachment-budgets-v1", ...consent,
      preparationId: attempt.preparationId, draftId: scope.draftId, draftFingerprint: "e".repeat(64),
      binding: { sourceId, instanceId, nativeSessionId: "native", contextId: "context", modelFingerprint: "model",
        imageCapable: true },
      expiresAt: 60_000, status: "ready", items: [{ ...preparedItem, status: "ready", degradations: [],
        representation: { kind: representationKind, mimeType: "image/gif", data: "R0lGODlhAQABAAAAADs=",
          width: 1, height: 1 } }] },
    result: { version: "durable-submission-v1", clientSubmissionId: attempt.clientSubmissionId,
      target: { sourceId, instanceId, nativeSessionId: "native" },
      origin: { sourceId, instanceId, nativeSessionId: "native", clientSubmissionId: attempt.clientSubmissionId },
      found: true, admission: "local", reservation: "committed", persistence: "committed",
      operationOutcome: "succeeded", terminal: true, inputOutcome: "generated", duplicate: false, nextOffset: null,
      preparation: { ...consent, acceptedDegradations: [], attachments: [attachment] },
      relations: [{ relationId: "entry:user", entryId: "user", role: "input", availability: "retained",
        status: "observed", persistence: "committed", attachments: [{ ...attachment,
          entryPart: { kind: "content", index: 0 } }] }] },
  };
}

async function committed(store: OriginalStore) {
  const original = await store.stage(access, { displayName: "photo.gif", mediaType: "image/gif",
    byteLength: image.length }, body());
  const { receipt, result } = evidence(original.objectId);
  store.reserveForSubmission(access, attempt, [original.objectId], receipt);
  store.recordSubmission(access, attempt.clientSubmissionId, result);
  return original;
}

function history(entryIds: string[], retained = entryIds): TreeHistory {
  const opened = { snapshot: "snapshot", cursor: "cursor", scope: "tree",
    cut: { first: 0, last: entryIds.length }, expiresAt: 60_000, nativeParts: entryIds.length };
  return {
    open: async () => opened,
    page: async () => ({ ...opened, complete: true, items: retained.map(id => ({ id, kind: "message" })) }),
    close: async () => {},
  } as unknown as TreeHistory;
}

function route(store: OriginalStore, options: { retained?: string[]; revoke?: () => boolean } = {}) {
  return (request: Request) => originalHistoryResponse(request, {
    admit: () => options.revoke?.() ? new Response("denied", { status: 403 }) : { hostId: "host", credentialId: "browser", expiresAt: 1 },
    session: () => ({ scope: { ...scope, sourceId: "c".repeat(64) }, history: history(["user"], options.retained ?? ["user"]) }),
    store,
  });
}

test("historical Originals stay readable after Host restart and in a branch copy of the same source", async () => {
  const { open } = fixture();
  const first = open();
  const original = await committed(first);
  first.close();
  const reopened = open();
  expect(await reopened.history(access, ["user"])).toEqual([{ entryId: "user", objectId: original.objectId,
    displayName: "photo.gif", mediaType: "image/gif", byteLength: image.length, sha256,
    availability: "available" }]);
  expect(new Uint8Array((await reopened.readHistorical(access, "user", original.objectId, ["user"])).bytes))
    .toEqual(image);
  const branch = () => ({ ...scope, sourceId: "c".repeat(64) });
  expect(await reopened.history(branch, ["user"])).toHaveLength(1);
  for (const field of ["browserId", "pageId", "hostId", "profileId", "instanceId", "sessionId"] as const) {
    expect(await reopened.history(() => ({ ...branch(), [field]: "other" }), ["user"])).toEqual([]);
  }
  await expect(reopened.readHistorical(() => ({ ...scope, browserId: "other" }), "user", original.objectId, ["user"]))
    .rejects.toThrow("attachment_object_unavailable");
  expect(reopened.history(access, ["files"])).toEqual([]);
});

test("missing and corrupt original files keep a typed reason and leave Native history untouched", async () => {
  const { open, dataDir } = fixture();
  const store = open();
  const original = await committed(store);
  const file = join(dataDir, `${original.objectId}.original`);
  unlinkSync(file);
  expect((await store.history(access, ["user"]))[0]).toMatchObject({ availability: "missing" });
  await expect(store.readHistorical(access, "user", original.objectId, ["user"]))
    .rejects.toThrow("attachment_original_unavailable");
  writeFileSync(file, new Uint8Array(image.length).fill(7));
  await expect(store.readHistorical(access, "user", original.objectId, ["user"]))
    .rejects.toThrow("attachment_original_corrupt");
  expect(await store.history(access, ["user"])).toHaveLength(1);
});

test("the public route rechecks admission, retention and representation on every GET/HEAD", async () => {
  const { open } = fixture();
  const store = open();
  const original = await committed(store);
  const handle = route(store);
  const query = `sessionId=native&entryId=user`;
  const list = await handle(new Request(`http://127.0.0.1/api/ompOriginals/history?${query}`));
  expect(list.status).toBe(200);
  expect((await list.json() as { items: unknown[] }).items).toHaveLength(1);
  const inline = await handle(new Request(`http://127.0.0.1/api/ompOriginals/original?${query}&objectId=${original.objectId}&disposition=inline`));
  expect(inline.status).toBe(200);
  expect(inline.headers.get("content-disposition")).toStartWith("inline;");
  expect(inline.headers.get("x-content-type-options")).toBe("nosniff");
  expect(Buffer.from(await inline.arrayBuffer())).toEqual(Buffer.from(image));
  const head = await handle(new Request(`http://127.0.0.1/api/ompOriginals/original?${query}&objectId=${original.objectId}&disposition=attachment`, { method: "HEAD" }));
  expect(head.status).toBe(200);
  expect(head.headers.get("content-length")).toBe(String(image.length));
  expect(await head.text()).toBe("");
  expect((await handle(new Request(`http://127.0.0.1/api/ompOriginals/original?${query}&objectId=${original.objectId}&disposition=attachment`, { method: "POST" }))).status).toBe(405);
  expect((await handle(new Request(`http://127.0.0.1/api/ompOriginals/history?sessionId=native&entryId=other`))).status).toBe(404);
  expect((await handle(new Request(`http://127.0.0.1/api/ompOriginals/history?${query}&entryId=user`))).status).toBe(400);
  expect((await route(store, { revoke: () => true })(new Request(`http://127.0.0.1/api/ompOriginals/history?${query}`))).status).toBe(403);
});

test("retention scanning is bounded and reports only entries this exact Native history contains", async () => {
  expect([...await retainedEntries(history(["user"]), ["user", "other"])]).toEqual(["user"]);
});
