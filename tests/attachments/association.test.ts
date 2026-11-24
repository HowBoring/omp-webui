import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { OriginalStore, type OriginalScope } from "../../packages/attachments/store.ts";

const target = { sourceId: "a".repeat(64), instanceId: "b".repeat(64), nativeSessionId: "native" };
const scope: OriginalScope = { hostId: "host", browserId: "browser", pageId: "page", profileId: "profile",
  sourceId: target.sourceId, instanceId: target.instanceId, sessionId: target.nativeSessionId,
  canonicalCwd: "/synthetic/project", draftId: "draft", authorityEpoch: "epoch", explicitOpen: true };
const access = () => ({ ...scope });
const attempt = { clientSubmissionId: "send", preparationId: "prepared-draft", draftRevision: "v1",
  authorityGeneration: "grant-v1" };
const descriptor = { displayName: "notes.txt", mediaType: "text/plain" as const, byteLength: 4 };
const bytes = new TextEncoder().encode("note");
const originalSha256 = "edb465624291e4053c6c5ea4b7eb320dec773e10a57d26b95dcf0564f8e310f8";
const preparedSha256 = "c".repeat(64);
async function* body() { yield bytes; }

const roots: string[] = [];
const stores: OriginalStore[] = [];
function fixture() {
  const dataDir = mkdtempSync("/tmp/original-association-");
  roots.push(dataDir);
  let now = 0;
  return {
    dataDir,
    advance: () => { now += 24 * 60 * 60 * 1000; },
    open: (recovery: "exclusive-host-startup" | "shared-connection" = "exclusive-host-startup") => {
      const store = new OriginalStore({ dataDir, recovery, clock: () => now,
        protection: () => ({ status: "unreferenced", revision: "1" }) });
      stores.push(store);
      return store;
    },
  };
}
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function publicEvidence(objectId: string) {
  const attachment = { originalId: objectId, originalSha256, preparedId: "prepared-object", preparedSha256,
    representationKind: "text" as const };
  const consent = { receiptId: "receipt", resultDigest: "d".repeat(64), draftRevision: attempt.draftRevision,
    authorityGeneration: attempt.authorityGeneration };
  const { representationKind, ...preparedItem } = attachment;
  const receipt = { version: "attachment-preparation-v1", budgetVersion: "attachment-budgets-v1", ...consent,
    preparationId: attempt.preparationId, draftId: scope.draftId, draftFingerprint: "e".repeat(64),
    binding: { ...target, contextId: "context", modelFingerprint: "model", imageCapable: true },
    expiresAt: 60_000, status: "ready", items: [{ ...preparedItem, status: "ready", degradations: [],
      representation: { kind: representationKind, text: "prepared note" } }] };
  const result = { version: "durable-submission-v1", clientSubmissionId: attempt.clientSubmissionId, target,
    origin: { ...target, clientSubmissionId: attempt.clientSubmissionId }, found: true, admission: "local",
    reservation: "committed", persistence: "committed", operationOutcome: "succeeded", terminal: true,
    inputOutcome: "generated", duplicate: false, nextOffset: null,
    preparation: { ...consent, acceptedDegradations: [], attachments: [attachment] },
    relations: [
      { relationId: "entry:user", entryId: "user", role: "input", availability: "retained",
        status: "observed", persistence: "committed" },
      { relationId: "entry:files", entryId: "files", role: "prepared", availability: "retained",
        status: "observed", persistence: "committed", attachments: [{ ...attachment,
          entryPart: { kind: "files", index: 0 } }] },
    ],
  };
  return { receipt, result };
}

test("committed same-Session attachment evidence preserves exact Original bytes through Store reopen", async () => {
  const { open, advance } = fixture();
  const first = open();
  const original = await first.stage(access, descriptor, body());
  const unrelated = await first.stage(access, descriptor, body());
  const { receipt, result } = publicEvidence(original.objectId);
  first.reserveForSubmission(access, attempt, [original.objectId], receipt);
  first.close();

  const reopened = open();
  advance();
  expect(reopened.collectExpired()).toEqual({ expired: 1, reclaimed: 1, next: null });
  await expect(reopened.readAssociated(access, "files", original.objectId, result))
    .rejects.toThrow("attachment_object_unavailable");
  reopened.recordSubmission(access, attempt.clientSubmissionId, result);
  reopened.close();

  const committed = open();
  expect(committed.collectExpired()).toEqual({ expired: 0, reclaimed: 0, next: null });
  expect(await committed.readAssociated(access, "files", original.objectId, result)).toMatchObject({
    objectId: original.objectId, sha256: originalSha256, bytes, state: "native-associated",
    nativeAssociation: { clientSubmissionId: "send", entryId: "files", entryPart: { kind: "files", index: 0 } },
  });
  await expect(committed.readAssociated(access, "files", unrelated.objectId, result))
    .rejects.toThrow("attachment_object_unavailable");
});

test("a repeated Native submission reply cannot stand in for a current read-only query", async () => {
  const first = fixture().open();
  const original = await first.stage(access, descriptor, body());
  const { receipt, result } = publicEvidence(original.objectId);
  first.reserveForSubmission(access, attempt, [original.objectId], receipt);
  expect(() => first.recordSubmission(access, attempt.clientSubmissionId, { ...result, duplicate: true }))
    .toThrow("attachment_association_evidence_invalid");
  await expect(first.readAssociated(access, "files", original.objectId, result))
    .rejects.toThrow("attachment_object_unavailable");
});

test("exact reservation and association retries are idempotent and conflicting evidence cannot retarget them", async () => {
  const { open } = fixture(), first = open(), second = open("shared-connection");
  const original = await first.stage(access, descriptor, body());
  const sameBytes = await first.stage(access, descriptor, body());
  const { receipt, result } = publicEvidence(original.objectId);
  expect(() => first.reserveForSubmission(access, attempt, [sameBytes.objectId], receipt))
    .toThrow("attachment_association_evidence_invalid");
  expect(() => first.reserveForSubmission(access, attempt, [original.objectId], {
    ...receipt, items: receipt.items.map(item => ({ ...item, originalSha256: "f".repeat(64) })),
  })).toThrow("attachment_association_evidence_invalid");

  first.reserveForSubmission(access, attempt, [original.objectId], receipt);
  second.reserveForSubmission(access, attempt, [original.objectId], receipt);
  expect(() => second.reserveForSubmission(access, attempt, [sameBytes.objectId], publicEvidence(sameBytes.objectId).receipt))
    .toThrow("attachment_association_conflict");
  expect(() => second.reserveForSubmission(access, { ...attempt, clientSubmissionId: "another" }, [original.objectId], receipt))
    .toThrow("attachment_association_conflict");

  first.recordSubmission(access, attempt.clientSubmissionId, result);
  second.recordSubmission(access, attempt.clientSubmissionId, result);
  const swapped = { ...result, relations: result.relations.map(relation => relation.role !== "prepared" ? relation : {
    ...relation, relationId: "entry:other", entryId: "other",
  }) };
  expect(() => second.recordSubmission(access, attempt.clientSubmissionId, swapped)).toThrow("attachment_association_conflict");
  await expect(second.readAssociated(access, "other", original.objectId, swapped)).rejects.toThrow("attachment_association_conflict");
  expect((await second.readAssociated(access, "files", original.objectId, result)).bytes).toEqual(bytes);
  expect((await second.read(access, sameBytes.objectId)).state).toBe("staged-unprepared");
});

test("the initiating entry of a text-only association remains exact after Store reopen", async () => {
  const { open } = fixture(), first = open();
  const original = await first.stage(access, descriptor, body());
  const { receipt, result } = publicEvidence(original.objectId);
  first.reserveForSubmission(access, attempt, [original.objectId], receipt);
  first.recordSubmission(access, attempt.clientSubmissionId, result);
  first.close();

  const reopened = open();
  const changedInput = { ...result, relations: result.relations.map(relation => relation.role !== "input" ? relation : {
    ...relation, relationId: "entry:different-user", entryId: "different-user",
  }) };
  await expect(reopened.readAssociated(access, "files", original.objectId, changedInput))
    .rejects.toThrow("attachment_association_conflict");
  expect(() => reopened.recordSubmission(access, attempt.clientSubmissionId, changedInput))
    .toThrow("attachment_association_conflict");
  reopened.recordSubmission(access, attempt.clientSubmissionId, result);
  expect((await reopened.readAssociated(access, "files", original.objectId, result)).bytes).toEqual(bytes);
});

test("inherited, incomplete, and mismatched causal evidence leaves the Original held without a historical read", async () => {
  const { open, advance } = fixture(), store = open();
  const original = await store.stage(access, descriptor, body());
  const { receipt, result } = publicEvidence(original.objectId);
  store.reserveForSubmission(access, attempt, [original.objectId], receipt);
  const [input, prepared] = result.relations;
  for (const query of [
    { ...result, admission: "inherited" },
    { ...result, origin: { ...result.origin, nativeSessionId: "another" } },
    { ...result, target: { ...result.target, sourceId: "f".repeat(64) } },
    { ...result, operationOutcome: "unknown" },
    { ...result, nextOffset: 128 },
    { ...result, inputOutcome: "no_input" },
    { ...result, preparation: undefined },
    { ...result, preparation: { ...result.preparation, resultDigest: "f".repeat(64) } },
    { ...result, relations: [prepared] },
    { ...result, relations: [input, { ...prepared, availability: "removed" }] },
    { ...result, relations: [input, { ...prepared, role: "additional" }] },
    { ...result, relations: [input, { ...prepared, attachments: [{ ...result.preparation.attachments[0],
      entryPartUnavailable: "ambiguous" }] }] },
    { ...result, relations: [input, prepared, prepared] },
  ]) {
    expect(() => store.recordSubmission(access, attempt.clientSubmissionId, query))
      .toThrow("attachment_association_evidence_invalid");
  }
  advance();
  expect(store.collectExpired()).toEqual({ expired: 0, reclaimed: 0, next: null });
  await expect(store.readAssociated(access, "files", original.objectId, result))
    .rejects.toThrow("attachment_object_unavailable");
});

test("a pending submission invalidates a staged deletion confirmation across Store connections", async () => {
  const { open } = fixture(), store = open(), peer = open("shared-connection");
  const original = await store.stage(access, descriptor, body());
  const { confirmationId } = store.previewDeletion(access, original.objectId);
  const { receipt, result } = publicEvidence(original.objectId);
  peer.reserveForSubmission(access, attempt, [original.objectId], receipt);
  expect(() => store.confirmDeletion(access, original.objectId, confirmationId)).toThrow("attachment_original_protected");
  expect(store.touchDraft(access, "explicit-edit", [original.objectId]))
    .toEqual({ renewed: [], unavailable: [original.objectId] });
  await expect(store.read(access, original.objectId)).rejects.toThrow("attachment_original_protected");
  peer.recordSubmission(access, attempt.clientSubmissionId, result);
  expect(() => store.previewDeletion(access, original.objectId)).toThrow("attachment_object_unavailable");
  expect(store.usage(access).chargedBytes).toBe(4);
});

test("a hold on another connection during final authorization invalidates a staged read", async () => {
  const { open } = fixture(), store = open(), peer = open("shared-connection");
  const original = await store.stage(access, descriptor, body());
  const { receipt, result } = publicEvidence(original.objectId);
  let checks = 0;
  const holdDuringAuthorization = () => {
    if (++checks === 2) peer.reserveForSubmission(access, attempt, [original.objectId], receipt);
    return access();
  };
  await expect(store.read(holdDuringAuthorization, original.objectId)).rejects.toThrow("attachment_original_protected");
  expect(store.usage(access).chargedBytes).toBe(4);
  peer.recordSubmission(access, attempt.clientSubmissionId, result);
  expect((await store.readAssociated(access, "files", original.objectId, result)).bytes).toEqual(bytes);
});

test("associated reads recheck current scope and revoke bytes if the authority epoch changes during a read", async () => {
  const { open } = fixture(), store = open();
  const original = await store.stage(access, descriptor, body());
  const { receipt, result } = publicEvidence(original.objectId);
  store.reserveForSubmission(access, attempt, [original.objectId], receipt);
  store.recordSubmission(access, attempt.clientSubmissionId, result);
  for (const field of ["hostId", "browserId", "pageId", "profileId", "sourceId", "instanceId", "sessionId",
    "canonicalCwd", "draftId"] as const) {
    const readOther = () => ({ ...scope, [field]: "another" });
    await expect(store.readAssociated(readOther, "files", original.objectId, result))
      .rejects.toThrow("attachment_object_unavailable");
  }
  let checks = 0;
  const revoke = () => ({ ...scope, authorityEpoch: ++checks === 1 ? scope.authorityEpoch : "revoked" });
  await expect(store.readAssociated(revoke, "files", original.objectId, result)).rejects.toThrow("attachment_binding_changed");
  const disconnected = (): OriginalScope => { throw new Error("Peer is disconnected"); };
  await expect(store.readAssociated(disconnected, "files", original.objectId, result))
    .rejects.toThrow("attachment_authority_unavailable");
});

test("a committed association distinguishes damaged and missing Original bytes while keeping its charge", async () => {
  const { open, dataDir } = fixture(), store = open();
  const original = await store.stage(access, descriptor, body());
  const { receipt, result } = publicEvidence(original.objectId);
  store.reserveForSubmission(access, attempt, [original.objectId], receipt);
  store.recordSubmission(access, attempt.clientSubmissionId, result);
  const payload = join(dataDir, `${original.objectId}.original`);
  writeFileSync(payload, "junk");
  await expect(store.readAssociated(access, "files", original.objectId, result)).rejects.toThrow("attachment_original_corrupt");
  unlinkSync(payload);
  await expect(store.readAssociated(access, "files", original.objectId, result)).rejects.toThrow("attachment_original_unavailable");
  expect(store.usage(access).chargedBytes).toBe(4);
});

test("a mixed preparation commits only when both Native input and companion locators are proved", async () => {
  const store = fixture().open();
  const note = await store.stage(access, descriptor, body());
  const gifBytes = Buffer.from("R0lGODlhAQABAAAAADs=", "base64");
  async function* imageBody() { yield gifBytes; }
  const image = await store.stage(access, { displayName: "image.gif", mediaType: "image/gif", byteLength: 14 }, imageBody());
  const { receipt, result } = publicEvidence(note.objectId);
  const imageIdentity = { originalId: image.objectId,
    originalSha256: "1f19970f056cd116a5fe3c02422c1ee1ac827136df470b5c89af492620512aa4",
    preparedId: "prepared-image", preparedSha256: "f".repeat(64) };
  const selected = [note.objectId, image.objectId], mixedReceipt = { ...receipt, items: [...receipt.items,
    { ...imageIdentity, status: "ready", degradations: ["image_transformed"],
      representation: { kind: "image", mimeType: "image/png", data: "Ynl0ZXM=", width: 1, height: 1 } }] };
  store.reserveForSubmission(access, attempt, selected, mixedReceipt);
  const link = { ...imageIdentity, representationKind: "image" };
  const partiallyCommitted = { ...result, preparation: { ...result.preparation,
    acceptedDegradations: ["image_transformed"], attachments: [...result.preparation.attachments, link] } };
  expect(() => store.recordSubmission(access, attempt.clientSubmissionId, partiallyCommitted))
    .toThrow("attachment_association_evidence_invalid");
  await expect(store.readAssociated(access, "files", note.objectId, partiallyCommitted)).rejects.toThrow("attachment_object_unavailable");
  const [input, companion] = result.relations;
  const committed = { ...partiallyCommitted, relations: [{ ...input, attachments: [{ ...link,
    entryPart: { kind: "content", index: 2 } }] }, companion] };
  store.recordSubmission(access, attempt.clientSubmissionId, committed);
  await expect(store.readAssociated(access, "user", note.objectId, committed)).rejects.toThrow("attachment_object_unavailable");
  expect(await store.readAssociated(access, "user", image.objectId, committed)).toMatchObject({
    bytes: gifBytes, mediaType: "image/gif", nativeAssociation: { entryPart: { kind: "content", index: 2 } },
  });
  expect((await store.readAssociated(access, "files", note.objectId, committed)).bytes).toEqual(bytes);
});

test("a verified branch forwards exact Original links to its own Session and instance only", async () => {
  const store = fixture().open();
  const original = await store.stage(access, descriptor, body());
  const { receipt, result } = publicEvidence(original.objectId);
  store.reserveForSubmission(access, attempt, [original.objectId], receipt);
  store.recordSubmission(access, attempt.clientSubmissionId, result);
  expect(store.inheritBranchLinks(scope.sessionId, scope.instanceId, "native-branch", "branch-instance", ["files"])).toBe(1);
  expect(store.inheritBranchLinks(scope.sessionId, scope.instanceId, "native-branch", "branch-instance", ["files"])).toBe(1);

  const branch = () => ({ ...scope, sessionId: "native-branch", instanceId: "branch-instance" });
  expect(store.history(branch, ["files"])).toMatchObject([{ entryId: "files", objectId: original.objectId, availability: "available" }]);
  expect((await store.readHistorical(branch, "files", original.objectId, ["files"])).bytes).toEqual(bytes);
  expect(store.history(() => ({ ...branch(), pageId: "other-page" }), ["files"])).toEqual([]);
  await expect(store.readHistorical(branch, "files", original.objectId, []))
    .rejects.toThrow("attachment_object_unavailable");
});
