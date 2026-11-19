import { expect, test } from "bun:test";
import { AttachmentPreparations } from "../../../vendor/omp/packages/coding-agent/src/attachments/receipts";

const binding = { sourceId: "a".repeat(64), instanceId: "b".repeat(64), nativeSessionId: "synthetic",
  contextId: "c".repeat(64), modelFingerprint: "d".repeat(64), imageCapable: true };
const object = (id, bytes) => ({ originalId: id, format: "utf8", sha256: Bun.SHA256.hash(bytes, "hex"), data: bytes.toBase64() });
const draft = objects => ({ preparationId: crypto.randomUUID(), draftId: "tab-draft", draftRevision: "1",
  authorityGeneration: "grant-1", message: "preserve this prose", objects });

test("one invalid original prevents the entire input from becoming consumable", async () => {
  const store = new AttachmentPreparations(() => binding);
  const receipt = await store.prepare(draft([
    object("valid", new TextEncoder().encode("valid text")), object("invalid", new Uint8Array([0xc3, 0x28])),
  ]));
  expect(receipt.status).toBe("failed");
  expect(receipt.items.map(item => item.status)).toEqual(["ready", "failed"]);
  expect(() => store.validateAndFreeze({ receiptId: receipt.receiptId, resultDigest: receipt.resultDigest,
    draftRevision: "1", authorityGeneration: "grant-1", acceptedDegradations: [] })).toThrow("ATTACHMENT_NOT_READY");
});

test("consent binds actual truncation and consumption uses the staged text after receipt edits", async () => {
  const store = new AttachmentPreparations(() => binding);
  const receipt = await store.prepare(draft([object("long", new TextEncoder().encode("A".repeat(60_000)))]));
  const consent = { receiptId: receipt.receiptId, resultDigest: receipt.resultDigest,
    draftRevision: "1", authorityGeneration: "grant-1", acceptedDegradations: [] };
  expect(() => store.validateAndFreeze(consent)).toThrow("ATTACHMENT_DEGRADATION_CONSENT_REQUIRED");
  receipt.items[0].representation.text = "changed after preparation";
  const consumed = store.validateAndFreeze({ ...consent, acceptedDegradations: ["text_truncated"] });
  expect(consumed.message).toBe("preserve this prose");
  expect(consumed.companionMessages[0].files[0].content).toBe("A".repeat(51_200));
  expect(consumed.attachments[0].originalId).toBe("long");
});

test("model changes invalidate the receipt before any consumption", async () => {
  let current = { ...binding };
  const store = new AttachmentPreparations(() => current);
  const receipt = await store.prepare(draft([object("model-bound", new TextEncoder().encode("model-bound text"))]));
  current = { ...current, modelFingerprint: "e".repeat(64) };
  expect(() => store.validateAndFreeze({ receiptId: receipt.receiptId, resultDigest: receipt.resultDigest,
    draftRevision: "1", authorityGeneration: "grant-1", acceptedDegradations: [] })).toThrow("ATTACHMENT_CONTEXT_CHANGED");
});

test("late consent cannot use a cancelled ready receipt", async () => {
  const store = new AttachmentPreparations(() => binding);
  const receipt = await store.prepare(draft([object("cancelled", new TextEncoder().encode("not sent"))]));
  expect(store.cancel(receipt.preparationId)).toEqual({ cancelled: true });
  expect(() => store.validateAndFreeze({ receiptId: receipt.receiptId, resultDigest: receipt.resultDigest,
    draftRevision: "1", authorityGeneration: "grant-1", acceptedDegradations: [] })).toThrow("ATTACHMENT_RECEIPT_STALE");
});

test("changed result, draft revision or authority cannot reuse prior consent", async () => {
  const store = new AttachmentPreparations(() => binding);
  const receipt = await store.prepare(draft([object("fenced", new TextEncoder().encode("fenced text"))]));
  const consent = { receiptId: receipt.receiptId, resultDigest: receipt.resultDigest,
    draftRevision: "1", authorityGeneration: "grant-1", acceptedDegradations: [] };
  for (const change of [{ resultDigest: "0".repeat(64) }, { draftRevision: "2" }, { authorityGeneration: "revoked" }]) {
    expect(() => store.validateAndFreeze({ ...consent, ...change })).toThrow("ATTACHMENT_CONSENT_STALE");
  }
});
