import { expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { AttachmentClient, isAttachmentReceipt } from "../../packages/contracts/attachments.ts";
import { nativeFixture } from "../catalog/fixture.ts";
import { terminalSubmission } from "../submissions/fixture.ts";
import { negotiateStrict, selectedDescriptor, strictWorker } from "../continuation/worker.ts";

const runtime = ["--offline", "--model", "attachment-controlled/literal", "--no-lsp", "--no-skills", "--no-rules",
  "--no-spotlight", "--no-judge", "--no-context-files", "--trusted-extension", path.resolve("compatibility/omp/fixtures/attachment-provider.ts")];
interface Effects { inputCalls: number; modelAttempts: number; modelDispatches: number; toolCalls: number;
  blockedPayloads: number; requests: { images: { sha256: string; mimeType: string; bytes: number }[] }[] }

test("actual native provider receives staged image bytes and refuses cloned/re-written controlled context", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "attachment-native-provider-"));
  let worker: ReturnType<typeof strictWorker> | undefined;
  let phase = "fixture";
  try {
    await nativeFixture(home); const selected = await selectedDescriptor(home);
    worker = strictWorker(home, path.join(home, "project"), runtime);
    await negotiateStrict(worker);
    expect(await worker.request({ type: "strict_start", intent: "continue", reference: selected.reference, expectedCwd: path.join(home, "project") }))
      .toMatchObject({ success: true });
    const request = async (command: object) => { const response = await worker!.request(command);
      if (!response.success) throw Error(`native_${String(response.error)}_${String(response.code)}`); return response.data; };
    const client = new AttachmentClient(request, isAttachmentReceipt);
    const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");
    const document = new TextEncoder().encode("Controlled prepared document");
    const effects = (): Promise<Effects> => Bun.file(path.join(home, "attachment-effects.json")).json();
    let serial = 0;
    for (const scenario of ["plain", "clone-images", "context-drop", "payload-rewrite"]) {
      phase = `${scenario}:prepare`; const before = await effects();
      const receipt = await client.prepare({ preparationId: `preparation-${++serial}`, draftId: "draft", draftRevision: `${serial}`,
        authorityGeneration: "grant", message: scenario, objects: [
          { originalId: "image", format: "png", sha256: Bun.SHA256.hash(image, "hex"), data: image.toBase64() },
          { originalId: "document", format: "utf8", sha256: Bun.SHA256.hash(document, "hex"), data: document.toBase64() },
        ] });
      expect(receipt.status).toBe("ready"); expect(await effects()).toEqual(before);
      const staged = receipt.items[0];
      if (!staged || staged.status !== "ready" || staged.representation.kind !== "image") throw Error("no prepared image");
      phase = `${scenario}:submit`;
      const submitted = await worker.request({ type: "submission_submit", clientSubmissionId: `input-${serial}`, inputType: "prompt",
        sourceId: selected.sourceId, instanceId: selected.instanceId, nativeSessionId: selected.nativeSessionId,
        preparationId: receipt.preparationId, message: scenario, preparationConsent: { receiptId: receipt.receiptId,
          resultDigest: receipt.resultDigest, draftRevision: `${serial}`, authorityGeneration: "grant",
          acceptedDegradations: [...new Set(receipt.items.flatMap(item => item.status === "ready" ? item.degradations : []))] } });
      if (scenario === "clone-images") {
        expect(submitted.success).toBe(false); expect((await effects()).modelDispatches).toBe(before.modelDispatches); continue;
      }
      expect(submitted.success).toBe(true); const result = await terminalSubmission(worker, `input-${serial}`);
      expect(result.persistence).toBe("committed");
      const after = await effects();
      if (scenario === "plain") {
        if (after.modelDispatches !== before.modelDispatches + 1) {
          const errors = worker.frames.flatMap(frame => {
            const message = frame.message;
            return message && typeof message === "object" && "errorMessage" in message ? [message.errorMessage] : [];
          });
          throw Error(JSON.stringify({ after, errors }));
        }
        expect(after.modelDispatches).toBe(before.modelDispatches + 1);
        expect(after.requests.at(-1)?.images).toContainEqual({ mimeType: staged.representation.mimeType,
          bytes: Buffer.byteLength(staged.representation.data, "base64"),
          sha256: Bun.SHA256.hash(Buffer.from(staged.representation.data, "base64"), "hex") });
        expect(result.relations).toContainEqual(expect.objectContaining({ role: "input", persistence: "committed",
          attachments: [expect.objectContaining({ originalId: "image", preparedId: staged.preparedId })] }));
      } else expect(after.modelDispatches).toBe(before.modelDispatches);
    }
    expect((await worker.close()).code).toBe(0);
  } catch (error) { throw Error(`Attachment provider fixture failed during ${phase}`, { cause: error }); }
  finally { worker?.child.kill(); await worker?.child.exited; await fs.rm(home, { recursive: true, force: true }); }
}, 45_000);
