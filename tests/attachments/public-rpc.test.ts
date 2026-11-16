import { expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { z } from "zod";
import { AttachmentClient, isAttachmentReceipt } from "../../packages/contracts/attachments.ts";
import type {
  AttachmentReceipt, PreparedAttachmentLink, SubmissionResult,
} from "../../packages/contracts/generated/omp-wire.ts";
import { nativeFixture } from "../catalog/fixture.ts";
import { decodeSubmission, submissionHistory, terminalSubmission } from "../submissions/fixture.ts";
import { negotiateStrict, selectedDescriptor, strictWorker } from "../continuation/worker.ts";

// Same originals as the existing provider tracer; expected hashes independently recorded with Python hashlib.
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";
const text = "Controlled prepared document";
const pngSha256 = "6b1048f8a6d40bac0b2954c18fefa40c4ea7a96120fc2e54b7317c0e43c2bbec";
const textSha256 = "fd4d618665fd8dbb429346ec93e6996c7f60ce30e0cf40de732e5a1ac9ef8419";
const invalidSha256 = "eddf68639913a3cb8331cdfe7f87559e0beccf2c289c0d90ac4d89b3204004f8";
const preparedImageSha256 = "b9c50aa231fe688a56f0808874659608cdf2db9ba4c8b64aa0252a775c961fe4";
const preparedTextSha256 = "e603d01747bf11e95e94972008c3befe7d041b60b064fa8134add64c18019b0e";
const runtime = ["--offline", "--model", "attachment-controlled/literal", "--no-lsp", "--no-skills", "--no-rules",
  "--no-spotlight", "--no-judge", "--no-context-files", "--trusted-extension",
  path.resolve("compatibility/omp/fixtures/attachment-provider.ts")];
const entriesSchema = z.object({ entries: z.array(z.object({ id: z.string() }).catchall(z.unknown())),
  leafId: z.string().nullable() });
const effectsSchema = z.object({ inputCalls: z.number(), modelAttempts: z.number(), modelDispatches: z.number(),
  toolCalls: z.number(), blockedPayloads: z.number(), requests: z.array(z.object({
    images: z.array(z.object({ sha256: z.string(), mimeType: z.string(), bytes: z.number() })),
    text: z.array(z.object({ role: z.string(), sha256: z.string() })),
  })) });
type Worker = ReturnType<typeof strictWorker>;

async function withWorker(run: (fixture: Awaited<ReturnType<typeof openWorker>>) => Promise<void>): Promise<void> {
  if (!Reflect.get(globalThis, Symbol.for("omp.s0.network-guard")) || os.tmpdir() !== "/tmp") {
    throw Error("ATTACHMENT_PUBLIC_FIXTURE_PREIMPORT_GUARD_AND_TOP_TMP_REQUIRED");
  }
  const home = await fs.mkdtemp("/tmp/attachment-public-");
  let fixture: Awaited<ReturnType<typeof openWorker>> | undefined;
  try { fixture = await openWorker(home); await run(fixture); }
  finally {
    try {
      if (fixture) {
        try { expect((await fixture.worker.close()).code).toBe(0); }
        finally { fixture.worker.child.kill(); await fixture.worker.child.exited; }
      }
    } finally { await fs.rm(home, { recursive: true, force: true }); }
  }
}

async function openWorker(home: string) {
  await nativeFixture(home);
  const selected = await selectedDescriptor(home), cwd = path.join(home, "project");
  const worker = strictWorker(home, cwd, runtime);
  try {
    await negotiateStrict(worker);
    expect(await worker.request({ type: "strict_start", intent: "continue", reference: selected.reference,
      expectedCwd: cwd })).toMatchObject({ success: true });
    const client = new AttachmentClient(async command => {
      const response = await worker.request(command);
      if (!response.success) throw Error(`ATTACHMENT_PUBLIC_PREPARE_${String(response.code)}`);
      return response.data;
    }, isAttachmentReceipt);
    return { worker, client, selected, effects: async () => effectsSchema.parse(
      await Bun.file(path.join(home, "attachment-effects.json")).json()) };
  } catch (failure) { worker.child.kill(); await worker.child.exited; throw failure; }
}

async function entries(worker: Worker) {
  const response = await worker.request({ type: "get_entries" });
  expect(response.success).toBe(true);
  return entriesSchema.parse(response.data);
}

function consent(receipt: AttachmentReceipt) {
  return { receiptId: receipt.receiptId, resultDigest: receipt.resultDigest, draftRevision: receipt.draftRevision,
    authorityGeneration: receipt.authorityGeneration, acceptedDegradations: [] };
}

function submission(fixture: Awaited<ReturnType<typeof openWorker>>, receipt: AttachmentReceipt, key: string) {
  const { sourceId, instanceId, nativeSessionId } = fixture.selected;
  return { type: "submission_submit", clientSubmissionId: key, inputType: "prompt", sourceId, instanceId,
    nativeSessionId, preparationId: receipt.preparationId, message: "ordinary @missing-path prose",
    preparationConsent: consent(receipt) };
}

function savedLink(result: SubmissionResult, originalId: string, role: "input" | "prepared") {
  const matches = result.relations.flatMap(relation => (relation.attachments ?? [])
    .filter(link => link.originalId === originalId).map(link => ({ relation, link })));
  expect(matches).toHaveLength(1);
  const match = matches[0];
  if (!match?.relation.entryId || !match.link.entryPart) throw Error("ATTACHMENT_PUBLIC_SAVED_LOCATOR_MISSING");
  expect(match.relation).toMatchObject({ role, status: "observed", persistence: "committed",
    availability: "retained" });
  expect(match.link.entryPartUnavailable).toBeUndefined();
  expect(match.link.entryPart.index).toBeGreaterThanOrEqual(0);
  expect(match.link.entryPart.index).toBeLessThanOrEqual(65_535);
  return { entryId: match.relation.entryId, link: match.link, locator: match.link.entryPart };
}

function expectedLink(receipt: AttachmentReceipt, originalId: string,
  representationKind: PreparedAttachmentLink["representationKind"]) {
  const item = receipt.items.find(item => item.originalId === originalId);
  if (!item || item.status !== "ready") throw Error("ATTACHMENT_PUBLIC_READY_ITEM_MISSING");
  return { originalId: item.originalId, originalSha256: item.originalSha256, preparedId: item.preparedId,
    preparedSha256: item.preparedSha256, representationKind };
}

async function verifySavedParts(worker: Worker, receipt: AttachmentReceipt, result: SubmissionResult) {
  const image = savedLink(result, "image", "input"), document = savedLink(result, "document", "prepared");
  expect(image.link).toMatchObject(expectedLink(receipt, "image", "image"));
  expect(document.link).toMatchObject(expectedLink(receipt, "document", "text"));
  expect(image.locator.kind).toBe("content"); expect(document.locator.kind).toBe("files");
  const saved = await entries(worker);
  const imageEntry = saved.entries.filter(entry => entry.id === image.entryId);
  const documentEntry = saved.entries.filter(entry => entry.id === document.entryId);
  expect(imageEntry).toHaveLength(1); expect(documentEntry).toHaveLength(1);
  const input = z.object({ role: z.literal("user"), content: z.array(z.unknown()) }).parse(imageEntry[0]?.message);
  const companion = z.object({ role: z.literal("fileMention"), files: z.array(z.unknown()) })
    .parse(documentEntry[0]?.message);
  const part = z.object({ type: z.literal("image"), data: z.string(), mimeType: z.string() })
    .parse(input.content[image.locator.index]);
  expect(part).toEqual({ type: "image", data: png, mimeType: "image/png" });
  expect(Bun.SHA256.hash(Buffer.from(part.data, "base64"), "hex")).toBe(pngSha256);
  const file = z.object({ content: z.string() }).parse(companion.files[document.locator.index]);
  expect(file.content).toBe(text); expect(Bun.SHA256.hash(file.content, "hex")).toBe(textSha256);
  const history = await submissionHistory(worker);
  for (const { entryId, link } of [image, document]) {
    const rows = history.filter(item => item.entryId === entryId);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.submission?.origin).toEqual(result.origin);
      expect(row.submission?.attachments).toContainEqual(link);
    }
  }
}

test("actual public PNG and text commit exact indexed parts with matching query and history links", async () => {
  await withWorker(async fixture => {
    const { worker, client } = fixture, before = await entries(worker), effects = await fixture.effects();
    const receipt = await client.prepare({ preparationId: "prepared-mixed", draftId: "draft", draftRevision: "1",
      authorityGeneration: "grant", message: "ordinary @missing-path prose", objects: [
        { originalId: "image", format: "png", sha256: pngSha256, data: png },
        { originalId: "document", format: "utf8", sha256: textSha256, data: Buffer.from(text).toBase64() },
      ] });
    expect(receipt).toMatchObject({ status: "ready", binding: { sourceId: fixture.selected.sourceId,
      instanceId: fixture.selected.instanceId, nativeSessionId: fixture.selected.nativeSessionId }, items: [
      { status: "ready", originalId: "image", originalSha256: pngSha256, preparedSha256: preparedImageSha256,
        representation: { kind: "image", mimeType: "image/png", data: png, width: 1, height: 1 }, degradations: [] },
      { status: "ready", originalId: "document", originalSha256: textSha256, preparedSha256: preparedTextSha256,
        representation: { kind: "text", text }, degradations: [] },
    ] });
    expect(await entries(worker)).toEqual(before); expect(await fixture.effects()).toEqual(effects);
    expect(await worker.request(submission(fixture, receipt, "mixed-success"))).toMatchObject({ success: true });
    const result = await terminalSubmission(worker, "mixed-success");
    const { sourceId, instanceId, nativeSessionId } = fixture.selected;
    expect(result).toMatchObject({ terminal: true, operationOutcome: "succeeded", inputOutcome: "generated",
      persistence: "committed", reservation: "committed", target: { sourceId, instanceId, nativeSessionId },
      origin: { sourceId, instanceId, nativeSessionId, clientSubmissionId: "mixed-success" },
      preparation: consent(receipt) });
    await verifySavedParts(worker, receipt, result);
    expect(await fixture.effects()).toMatchObject({ inputCalls: effects.inputCalls + 1,
      modelAttempts: effects.modelAttempts + 1, modelDispatches: effects.modelDispatches + 1,
      toolCalls: effects.toolCalls, blockedPayloads: effects.blockedPayloads });
    const request = (await fixture.effects()).requests.at(-1);
    expect(request?.images).toEqual([{ mimeType: "image/png", bytes: 68, sha256: pngSha256 }]);
    expect(request?.text).toContainEqual({ role: "fileMention", sha256: textSha256 });
  });
}, 45_000);

test("actual public failed mixed preparation refuses all input before reservation or effects", async () => {
  await withWorker(async fixture => {
    const { worker, client } = fixture, before = await entries(worker), effects = await fixture.effects();
    const receipt = await client.prepare({ preparationId: "prepared-failed", draftId: "draft", draftRevision: "1",
      authorityGeneration: "grant", message: "ordinary @missing-path prose", objects: [
        { originalId: "image", format: "png", sha256: pngSha256, data: png },
        { originalId: "invalid", format: "utf8", sha256: invalidSha256, data: Buffer.from([0xc3, 0x28]).toBase64() },
      ] });
    expect(receipt).toMatchObject({ status: "failed", items: [
      { status: "ready", originalId: "image", originalSha256: pngSha256, preparedSha256: preparedImageSha256 },
      { status: "failed", originalId: "invalid", originalSha256: invalidSha256, code: "attachment_invalid_utf8" },
    ] });
    expect(await entries(worker)).toEqual(before); expect(await fixture.effects()).toEqual(effects);
    expect(await worker.request(submission(fixture, receipt, "mixed-refused")))
      .toMatchObject({ success: false, code: "ATTACHMENT_NOT_READY", error: "ATTACHMENT_NOT_READY" });
    const missing = decodeSubmission(await worker.request({ type: "submission_query",
      clientSubmissionId: "mixed-refused" }));
    expect(missing).toMatchObject({ found: false, admission: "absent", reservation: "absent", terminal: false,
      inputOutcome: "unresolved", operationOutcome: "unknown", persistence: "unresolved", relations: [],
      nextOffset: null });
    expect(await entries(worker)).toEqual(before); expect(await fixture.effects()).toEqual(effects);
    expect(await client.cancel(receipt.preparationId)).toEqual({ cancelled: true });
  });
}, 45_000);
