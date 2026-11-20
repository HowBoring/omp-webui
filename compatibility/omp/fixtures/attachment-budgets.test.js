import { expect, test } from "bun:test";
import { AttachmentPreparations } from "../../../vendor/omp/packages/coding-agent/src/attachments/receipts";

test("raw aggregate ceiling refuses the first byte beyond 32 MiB even with padded base64", async () => {
  const binding = { sourceId: "a".repeat(64), instanceId: "b".repeat(64), nativeSessionId: "synthetic",
    contextId: "c".repeat(64), modelFingerprint: "d".repeat(64), imageCapable: true };
  const bytes = new Uint8Array(8 * 1024 * 1024 + 1);
  const store = new AttachmentPreparations(() => binding);
  const data = bytes.toBase64(), sha256 = Bun.SHA256.hash(bytes, "hex");
  await expect(store.prepare({ preparationId: "over-aggregate", draftId: "draft", draftRevision: "1",
    authorityGeneration: "grant", message: "keep draft", objects: Array.from({ length: 4 }, (_, index) => ({
      originalId: `object-${index}`, format: "png", sha256, data,
    })) })).rejects.toThrow("ATTACHMENT_INPUT_BUDGET");
});
