import { expect, test } from "bun:test";
import { AttachmentClient, isAttachmentReceipt } from "../../packages/contracts/attachment-preparation.ts";
import type { AttachmentReceipt } from "../../packages/contracts/attachment-preparation.ts";

const originalSha256 = "6a9cfc3d9eb4b9a1b55940fa37ae90db079977b0d6bcc472cc606237acc0f966";
const preparedSha256 = "01208a513d3672416dcaab14c2884285bb763de95d47fcc3f2e3749d3225a21e";
const input = { preparationId: "prep", draftId: "draft", draftRevision: "1", authorityGeneration: "grant",
  message: "prose", objects: [{ originalId: "original", format: "utf8" as const, sha256: originalSha256, data: "aGVsbG8gc3RhZ2Vk" }] };
function receipt(): AttachmentReceipt {
  return { version: "attachment-preparation-v1", budgetVersion: "attachment-budgets-v1", receiptId: "receipt",
    preparationId: "prep", draftId: "draft", draftRevision: "1", authorityGeneration: "grant", draftFingerprint: "a".repeat(64),
    binding: { sourceId: "b".repeat(64), instanceId: "c".repeat(64), nativeSessionId: "synthetic",
      contextId: "d".repeat(64), modelFingerprint: "e".repeat(64), imageCapable: true },
    expiresAt: 4102444800000, status: "ready", resultDigest: "f".repeat(64),
    items: [{ originalId: "original", originalSha256, preparedId: "prepared", preparedSha256, status: "ready",
      representation: { kind: "text", text: "hello staged" }, degradations: [] }] };
}

test("same-source client accepts an independently hashed staged representation", async () => {
  const client = new AttachmentClient(async () => receipt(), isAttachmentReceipt);
  expect((await client.prepare(input)).items[0]).toMatchObject({ preparedSha256, originalId: "original" });
});

test("client refuses a schema-valid changed representation instead of displaying it under an old digest", async () => {
  const changed = receipt();
  changed.items[0] = { ...changed.items[0]!, status: "ready", preparedSha256,
    representation: { kind: "text", text: "changed after native preparation" }, degradations: [] };
  const client = new AttachmentClient(async () => changed, isAttachmentReceipt);
  await expect(client.prepare(input)).rejects.toThrow("ATTACHMENT_RECEIPT_INVALID");
});

test("client refuses a receipt returned for a different controlled original", async () => {
  const changed = receipt(); changed.items[0]!.originalId = "another-original";
  const client = new AttachmentClient(async () => changed, isAttachmentReceipt);
  await expect(client.prepare(input)).rejects.toThrow("ATTACHMENT_RECEIPT_INVALID");
});
