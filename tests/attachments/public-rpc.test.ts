import { expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import validateReceipt from "../../packages/contracts/generated/attachment-receipt.js";
import { nativeFixture } from "../catalog/fixture.ts";
import { controlledRuntime, terminalSubmission } from "../submissions/fixture.ts";
import type { AttachmentReceipt } from "../../packages/contracts/generated/omp-wire.ts";
import { negotiateStrict, selectedDescriptor, strictWorker } from "../continuation/worker.ts";

test("actual public preparation returns a matched receipt without model/tool/input or native append effects", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "submission-attachment-public-"));
  let worker: ReturnType<typeof strictWorker> | undefined;
  let phase = "fixture";
  try {
    await nativeFixture(home);
    const selected = await selectedDescriptor(home), cwd = path.join(home, "project");
    phase = "negotiate";
    worker = strictWorker(home, cwd, controlledRuntime);
    await negotiateStrict(worker);
    phase = "strict-open";
    expect(await worker.request({ type: "strict_start", intent: "continue", reference: selected.reference, expectedCwd: cwd }))
      .toMatchObject({ success: true });
    const before = await worker.request({ type: "get_entries" });
    phase = "prepare";
    const bytes = new TextEncoder().encode("native prepared contents");
    const response = await worker.request({ type: "attachment_prepare", preparationId: "preparation-1", draftId: "draft-1",
      draftRevision: "1", authorityGeneration: "grant-1", message: "ordinary @missing-path prose",
      objects: [{ originalId: "original-1", format: "utf8", sha256: Bun.SHA256.hash(bytes, "hex"), data: bytes.toBase64() }] });
    expect(response.success).toBe(true);
    phase = "verify";
    expect(validateReceipt(response.data)).toBe(true);
    expect(response.data).toMatchObject({ status: "ready", binding: { sourceId: selected.sourceId,
      instanceId: selected.instanceId, nativeSessionId: selected.nativeSessionId },
      items: [{ status: "ready", originalId: "original-1", representation: { kind: "text", text: "native prepared contents" } }] });
    expect((await worker.request({ type: "get_entries" })).data).toEqual(before.data);
    expect(await Bun.file(path.join(home, "submission-provider-effects.json")).exists()).toBe(false);
    if (!validateReceipt(response.data)) throw new Error("fixture_receipt_invalid");
    const receipt = response.data as AttachmentReceipt;
    phase = "consume";
    expect(await worker.request({ type: "submission_submit", clientSubmissionId: "attached-input-1", inputType: "prompt",
      sourceId: selected.sourceId, instanceId: selected.instanceId, nativeSessionId: selected.nativeSessionId,
      preparationId: receipt.preparationId, message: "ordinary @missing-path prose",
      preparationConsent: { receiptId: receipt.receiptId, resultDigest: receipt.resultDigest,
        draftRevision: "1", authorityGeneration: "grant-1", acceptedDegradations: [] } })).toMatchObject({ success: true });
    const committed = await terminalSubmission(worker, "attached-input-1");
    expect(committed).toMatchObject({ terminal: true, inputOutcome: "generated", persistence: "committed" });
    expect(committed.relations).toContainEqual(expect.objectContaining({ role: "prepared", persistence: "committed",
      attachments: [expect.objectContaining({ originalId: "original-1", originalSha256: Bun.SHA256.hash(bytes, "hex") })] }));
    expect((await worker.close()).code).toBe(0);
  } catch (error) {
    throw new Error(`Attachment public fixture failed during ${phase}`, { cause: error });
  } finally {
    worker?.child.kill(); await worker?.child.exited;
    await fs.rm(home, { recursive: true, force: true });
  }
}, 30_000);
