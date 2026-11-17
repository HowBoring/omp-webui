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
// Actual public OMP preparation discloses this 1x1 original's transformation to a 200x200 model image.
const preparedImageSha256 = "d39598a3d443533997fb6f9bdb856a1f7d05912f78753c9653391dae5b8942ff";
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
    attachmentText: z.array(z.object({ role: z.string(), sha256: z.string(), bytes: z.number(),
      occurrences: z.number().int().min(1).max(2) })),
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

function consent(receipt: AttachmentReceipt, acceptedDegradations: string[] = []) {
  return { receiptId: receipt.receiptId, resultDigest: receipt.resultDigest, draftRevision: receipt.draftRevision,
    authorityGeneration: receipt.authorityGeneration, acceptedDegradations };
}

function submission(fixture: Awaited<ReturnType<typeof openWorker>>, receipt: AttachmentReceipt, key: string,
  acceptedDegradations: string[] = []) {
  const { sourceId, instanceId, nativeSessionId } = fixture.selected;
  return { type: "submission_submit", clientSubmissionId: key, inputType: "prompt", sourceId, instanceId,
    nativeSessionId, preparationId: receipt.preparationId, message: "ordinary @missing-path prose",
    preparationConsent: consent(receipt, acceptedDegradations) };
}

function preparedImage(receipt: AttachmentReceipt) {
  const item = receipt.items.find(item => item.originalId === "image");
  if (!item || item.status !== "ready" || item.representation.kind !== "image") {
    throw Error("ATTACHMENT_PUBLIC_READY_IMAGE_MISSING");
  }
  return item.representation;
}

async function refuseUnaccepted(fixture: Awaited<ReturnType<typeof openWorker>>, receipt: AttachmentReceipt) {
  const { worker } = fixture, before = await entries(worker), effects = await fixture.effects();
  expect(await worker.request(submission(fixture, receipt, "mixed-success")))
    .toMatchObject({ success: false, code: "ATTACHMENT_DEGRADATION_CONSENT_REQUIRED",
      error: "ATTACHMENT_DEGRADATION_CONSENT_REQUIRED" });
  const missing = decodeSubmission(await worker.request({ type: "submission_query",
    clientSubmissionId: "mixed-success" }));
  expect(missing).toMatchObject({ found: false, reservation: "absent", admission: "absent", terminal: false,
    inputOutcome: "unresolved", persistence: "unresolved", relations: [] });
  expect(await entries(worker)).toEqual(before); expect(await fixture.effects()).toEqual(effects);
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
  const prepared = preparedImage(receipt);
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
  expect(part).toEqual({ type: "image", data: prepared.data, mimeType: prepared.mimeType });
  expect(Bun.SHA256.hash(Buffer.from(part.data, "base64"), "hex"))
    .toBe(Bun.SHA256.hash(Buffer.from(prepared.data, "base64"), "hex"));
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
        representation: { kind: "image", mimeType: "image/png", width: 200, height: 200 },
        degradations: ["image_transformed"], facts: { originalBytes: 68, preparedBytes: 590,
          sourceWidth: 1, sourceHeight: 1 } },
      { status: "ready", originalId: "document", originalSha256: textSha256, preparedSha256: preparedTextSha256,
        representation: { kind: "text", text }, degradations: [] },
    ] });
    const prepared = preparedImage(receipt), preparedBytes = Buffer.from(prepared.data, "base64");
    expect(preparedBytes.byteLength).toBe(590);
    expect(Bun.SHA256.hash(preparedBytes, "hex")).not.toBe(pngSha256);
    expect(await entries(worker)).toEqual(before); expect(await fixture.effects()).toEqual(effects);
    await refuseUnaccepted(fixture, receipt);
    expect(await worker.request(submission(fixture, receipt, "mixed-success", ["image_transformed"])))
      .toMatchObject({ success: true });
    const result = await terminalSubmission(worker, "mixed-success");
    const { sourceId, instanceId, nativeSessionId } = fixture.selected;
    expect(result).toMatchObject({ terminal: true, operationOutcome: "succeeded", inputOutcome: "generated",
      persistence: "committed", reservation: "committed", target: { sourceId, instanceId, nativeSessionId },
      origin: { sourceId, instanceId, nativeSessionId, clientSubmissionId: "mixed-success" },
      preparation: consent(receipt, ["image_transformed"]) });
    await verifySavedParts(worker, receipt, result);
    expect(await fixture.effects()).toMatchObject({ inputCalls: effects.inputCalls + 1,
      modelAttempts: effects.modelAttempts + 1, modelDispatches: effects.modelDispatches + 1,
      toolCalls: effects.toolCalls, blockedPayloads: effects.blockedPayloads });
    const request = (await fixture.effects()).requests.at(-1);
    expect(request?.images).toEqual([{ mimeType: prepared.mimeType, bytes: preparedBytes.byteLength,
      sha256: Bun.SHA256.hash(preparedBytes, "hex") }]);
    expect(request?.attachmentText).toEqual([{ role: "developer", sha256: textSha256, bytes: 28, occurrences: 1 }]);
  });
}, 45_000);

async function verifyJpegSavedPart(worker: Worker, receipt: AttachmentReceipt, result: SubmissionResult,
  originalData: string): Promise<void> {
  const image = savedLink(result, "image", "input");
  expect(image.link).toMatchObject(expectedLink(receipt, "image", "image"));
  expect(image.locator.kind).toBe("content");
  const saved = await entries(worker), matches = saved.entries.filter(entry => entry.id === image.entryId);
  expect(matches).toHaveLength(1);
  const input = z.object({ role: z.literal("user"), content: z.array(z.unknown()) }).parse(matches[0]?.message);
  const part = z.object({ type: z.literal("image"), data: z.string(), mimeType: z.string() })
    .parse(input.content[image.locator.index]);
  expect(part).toEqual({ type: "image", data: originalData, mimeType: "image/jpeg" });
  const history = await submissionHistory(worker), rows = history.filter(row => row.entryId === image.entryId);
  expect(rows.length).toBeGreaterThan(0);
  for (const row of rows) {
    expect(row.submission?.origin).toEqual(result.origin);
    expect(row.submission?.attachments).toContainEqual(image.link);
  }
}

test("actual public JPEG preserves prepared bytes through indexed saved image and provider delivery", async () => {
  // Independent Python/Pillow fixture and hashlib pins; no expected bytes are taken from a Native result.
  const original = await fs.readFile(new URL("./fixtures/opaque-200.jpeg", import.meta.url));
  const originalSha256 = "7622bbfcb0ab173d3dd13c0282fc0c8902de814f9283a58bce0b8e43e10654d5";
  const representationSha256 = "2de4100d163176cc222bb318f972dc371d7b5e61a5a12a23280ee4eb078f3285";
  expect(original.byteLength).toBe(1723); expect(Bun.SHA256.hash(original, "hex")).toBe(originalSha256);
  await withWorker(async fixture => {
    const { worker, client } = fixture, before = await entries(worker), effects = await fixture.effects();
    const receipt = await client.prepare({ preparationId: "prepared-jpeg", draftId: "draft-jpeg", draftRevision: "1",
      authorityGeneration: "grant", message: "ordinary @missing-path prose", objects: [
        { originalId: "image", format: "jpeg", sha256: originalSha256, data: original.toBase64() },
      ] });
    expect(receipt).toMatchObject({ status: "ready", preparationId: "prepared-jpeg", draftId: "draft-jpeg",
      draftRevision: "1", authorityGeneration: "grant", binding: { sourceId: fixture.selected.sourceId,
        instanceId: fixture.selected.instanceId, nativeSessionId: fixture.selected.nativeSessionId } });
    expect(receipt.items).toHaveLength(1);
    expect(receipt.items[0]).toMatchObject({ status: "ready", originalId: "image", originalSha256,
      preparedSha256: representationSha256, degradations: [], facts: { originalBytes: 1723, preparedBytes: 1723,
        sourceWidth: 200, sourceHeight: 200, frames: 1, decodedBytes: 160_000 } });
    expect(preparedImage(receipt)).toEqual({ kind: "image", mimeType: "image/jpeg", data: original.toBase64(),
      width: 200, height: 200 });
    expect(await entries(worker)).toEqual(before); expect(await fixture.effects()).toEqual(effects);
    expect(await worker.request(submission(fixture, receipt, "jpeg-success", []))).toMatchObject({ success: true });
    const result = await terminalSubmission(worker, "jpeg-success");
    const { sourceId, instanceId, nativeSessionId } = fixture.selected;
    expect(result).toMatchObject({ found: true, terminal: true, operationOutcome: "succeeded", inputOutcome: "generated",
      persistence: "committed", reservation: "committed", target: { sourceId, instanceId, nativeSessionId },
      origin: { sourceId, instanceId, nativeSessionId, clientSubmissionId: "jpeg-success" }, preparation: consent(receipt, []) });
    await verifyJpegSavedPart(worker, receipt, result, original.toBase64());
    const after = await fixture.effects();
    expect(after).toMatchObject({ inputCalls: effects.inputCalls + 1, modelAttempts: effects.modelAttempts + 1,
      modelDispatches: effects.modelDispatches + 1, toolCalls: effects.toolCalls, blockedPayloads: effects.blockedPayloads });
    expect(after.requests).toHaveLength(effects.requests.length + 1);
    expect(after.requests.at(-1)?.images).toEqual([{ mimeType: "image/jpeg", bytes: 1723, sha256: originalSha256 }]);
    expect(after.requests.at(-1)?.attachmentText).toEqual([]);
    expect(decodeSubmission(await worker.request({ type: "submission_query", clientSubmissionId: "jpeg-success" })))
      .toEqual(result);
    expect(await fixture.effects()).toEqual(after);
  });
}, 45_000);

async function prepareDocx(fixture: Awaited<ReturnType<typeof openWorker>>): Promise<AttachmentReceipt> {
  // Independent fixed ZIP/XML fixture and Python hashlib pins; Native conversion has not supplied expectations.
  const original = await fs.readFile(new URL("./fixtures/minimal-text.docx", import.meta.url));
  const originalSha256 = "76e2ed8160cbd314a8527cd57f07eb8d422c5e1ea7dc4769dc946e5a1f0554a0";
  const representationSha256 = "fbe65ce22456deb2f5d5dc0fb22632c772adb897e934a6f01bdba31e12298cc9";
  expect(original.byteLength).toBe(1259); expect(Bun.SHA256.hash(original, "hex")).toBe(originalSha256);
  const receipt = await fixture.client.prepare({ preparationId: "prepared-docx", draftId: "draft-docx",
    draftRevision: "1", authorityGeneration: "grant", message: "ordinary @missing-path prose", objects: [
      { originalId: "docx", format: "docx", sha256: originalSha256, data: original.toBase64() },
    ] });
  expect(receipt).toMatchObject({ status: "ready", preparationId: "prepared-docx", draftId: "draft-docx",
    draftRevision: "1", authorityGeneration: "grant", binding: { sourceId: fixture.selected.sourceId,
      instanceId: fixture.selected.instanceId, nativeSessionId: fixture.selected.nativeSessionId } });
  expect(receipt.items).toHaveLength(1);
  const item = receipt.items[0];
  if (!item || item.status !== "ready") throw Error("ATTACHMENT_PUBLIC_DOCX_NOT_READY");
  expect(item).toMatchObject({ originalId: "docx", originalSha256, preparedSha256: representationSha256 });
  expect(item.representation).toEqual({ kind: "text", text: "Controlled DOCX text witness" });
  expect(item.degradations).toEqual(["document_structure_changed"]);
  expect(item.facts).toEqual({ originalBytes: 1259, convertedBytes: 28, omittedImages: 0 });
  expect(item.preparedSha256).not.toBe(originalSha256);
  expect(original.equals(Buffer.from("Controlled DOCX text witness"))).toBe(false);
  return receipt;
}

async function refuseDocxWithoutConsent(fixture: Awaited<ReturnType<typeof openWorker>>, receipt: AttachmentReceipt) {
  const before = await entries(fixture.worker), effects = await fixture.effects();
  expect(await fixture.worker.request(submission(fixture, receipt, "docx-success", [])))
    .toMatchObject({ success: false, code: "ATTACHMENT_DEGRADATION_CONSENT_REQUIRED",
      error: "ATTACHMENT_DEGRADATION_CONSENT_REQUIRED" });
  const missing = decodeSubmission(await fixture.worker.request({ type: "submission_query",
    clientSubmissionId: "docx-success" }));
  expect(missing).toMatchObject({ found: false, reservation: "absent", admission: "absent", terminal: false,
    operationOutcome: "unknown", inputOutcome: "unresolved", persistence: "unresolved", relations: [],
    nextOffset: null });
  expect(await entries(fixture.worker)).toEqual(before); expect(await fixture.effects()).toEqual(effects);
}

async function verifyDocxSavedPart(worker: Worker, receipt: AttachmentReceipt, result: SubmissionResult): Promise<void> {
  const document = savedLink(result, "docx", "prepared");
  expect(document.link).toMatchObject(expectedLink(receipt, "docx", "text"));
  expect(document.locator.kind).toBe("files");
  const saved = await entries(worker), matches = saved.entries.filter(entry => entry.id === document.entryId);
  expect(matches).toHaveLength(1);
  const companion = z.object({ role: z.literal("fileMention"), files: z.array(z.unknown()) }).parse(matches[0]?.message);
  const part = z.object({ path: z.string(), content: z.string(), byteSize: z.number() })
    .parse(companion.files[document.locator.index]);
  expect(part).toEqual({ path: `attachment-prepared://${document.link.preparedId}`,
    content: "Controlled DOCX text witness", byteSize: 28 });
  expect(Bun.SHA256.hash(part.content, "hex"))
    .toBe("d771072c331e616e4702b39e480f6f8c69e7abebfb09f039d26e3013f7970eea");
  // Causality uses only the returned relation.entryId and actual indexed saved part, never content or hashes.
  const history = await submissionHistory(worker), rows = history.filter(row => row.entryId === document.entryId);
  expect(rows.length).toBeGreaterThan(0);
  for (const row of rows) {
    expect(row.submission?.origin).toEqual(result.origin); expect(row.submission?.role).toBe("prepared");
    expect(row.submission?.attachments).toContainEqual(document.link);
  }
}

test("actual public DOCX requires exact degradation consent before indexed saved text and provider delivery", async () => {
  await withWorker(async fixture => {
    const { worker } = fixture, before = await entries(worker), effects = await fixture.effects();
    const receipt = await prepareDocx(fixture);
    expect(await entries(worker)).toEqual(before); expect(await fixture.effects()).toEqual(effects);
    await refuseDocxWithoutConsent(fixture, receipt);
    expect(await worker.request(submission(fixture, receipt, "docx-success", ["document_structure_changed"])))
      .toMatchObject({ success: true });
    const result = await terminalSubmission(worker, "docx-success");
    const { sourceId, instanceId, nativeSessionId } = fixture.selected;
    expect(result).toMatchObject({ found: true, terminal: true, operationOutcome: "succeeded", inputOutcome: "generated",
      persistence: "committed", reservation: "committed", target: { sourceId, instanceId, nativeSessionId },
      origin: { sourceId, instanceId, nativeSessionId, clientSubmissionId: "docx-success" },
      preparation: consent(receipt, ["document_structure_changed"]) });
    await verifyDocxSavedPart(worker, receipt, result);
    const after = await fixture.effects();
    expect(after).toMatchObject({ inputCalls: effects.inputCalls + 1, modelAttempts: effects.modelAttempts + 1,
      modelDispatches: effects.modelDispatches + 1, toolCalls: effects.toolCalls, blockedPayloads: effects.blockedPayloads });
    expect(after.requests).toHaveLength(effects.requests.length + 1);
    expect(after.requests.at(-1)?.images).toEqual([]);
    expect(after.requests.at(-1)?.attachmentText).toEqual([{ role: "developer", bytes: 28, occurrences: 1,
      sha256: "d771072c331e616e4702b39e480f6f8c69e7abebfb09f039d26e3013f7970eea" }]);
    expect(decodeSubmission(await worker.request({ type: "submission_query", clientSubmissionId: "docx-success" })))
      .toEqual(result);
    expect(await fixture.effects()).toEqual(after);
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

async function prepareWebp(fixture: Awaited<ReturnType<typeof openWorker>>): Promise<AttachmentReceipt> {
  // Pillow/hashlib authored the original and its carrier hash; no Native encoder supplied expectations.
  const original = await fs.readFile(new URL("./fixtures/opaque-200.webp", import.meta.url));
  const originalSha256 = "0dd383c62fb5fd7b38a18c4f0cca4ec8670828cf2a63f39bbd96d45102729133";
  const originalCarrierSha256 = "82e0ddb7abb78e7d758d9622e43c973fb68e042f3edf7c42ebe39b53f2c49328";
  expect(original.byteLength).toBe(38); expect(Bun.SHA256.hash(original, "hex")).toBe(originalSha256);
  const carrier = { kind: "image", mimeType: "image/webp", data: original.toBase64(), width: 200, height: 200 };
  expect(Bun.SHA256.hash(JSON.stringify(carrier), "hex")).toBe(originalCarrierSha256);
  const receipt = await fixture.client.prepare({ preparationId: "prepared-webp", draftId: "draft-webp",
    draftRevision: "1", authorityGeneration: "grant", message: "ordinary @missing-path prose", objects: [
      { originalId: "image", format: "webp", sha256: originalSha256, data: original.toBase64() },
    ] });
  expect(receipt).toMatchObject({ status: "ready", preparationId: "prepared-webp", draftId: "draft-webp",
    draftRevision: "1", authorityGeneration: "grant", binding: { sourceId: fixture.selected.sourceId,
      instanceId: fixture.selected.instanceId, nativeSessionId: fixture.selected.nativeSessionId } });
  expect(receipt.items).toHaveLength(1);
  const item = receipt.items[0], prepared = preparedImage(receipt);
  if (!item || item.status !== "ready") throw Error("ATTACHMENT_PUBLIC_WEBP_NOT_READY");
  expect(item.originalSha256).toBe(originalSha256);
  expect(item.degradations).toEqual(["image_transformed"]);
  expect(["image/png", "image/jpeg"]).toContain(prepared.mimeType);
  expect({ width: prepared.width, height: prepared.height }).toEqual({ width: 200, height: 200 });
  const preparedBytes = Buffer.from(prepared.data, "base64");
  expect(preparedBytes.byteLength).toBeGreaterThan(0);
  expect(preparedBytes.byteLength).toBeLessThanOrEqual(500 * 1024);
  expect(Bun.SHA256.hash(preparedBytes, "hex")).not.toBe(originalSha256);
  // Contract consistency only: converter-specific output bytes/hash are deliberately not predicted.
  const representation = { kind: "image", mimeType: prepared.mimeType, data: prepared.data,
    width: prepared.width, height: prepared.height };
  expect(item.preparedSha256).toBe(Bun.SHA256.hash(JSON.stringify(representation), "hex"));
  expect(item.preparedSha256).not.toBe(originalCarrierSha256);
  expect(item.facts).toEqual({ originalBytes: 38, preparedBytes: preparedBytes.byteLength,
    sourceWidth: 200, sourceHeight: 200, frames: 1, decodedBytes: 160000 });
  return receipt;
}

async function refuseWebpWithoutConsent(fixture: Awaited<ReturnType<typeof openWorker>>, receipt: AttachmentReceipt) {
  const before = await entries(fixture.worker), effects = await fixture.effects();
  expect(await fixture.worker.request(submission(fixture, receipt, "webp-success", [])))
    .toMatchObject({ success: false, code: "ATTACHMENT_DEGRADATION_CONSENT_REQUIRED",
      error: "ATTACHMENT_DEGRADATION_CONSENT_REQUIRED" });
  const missing = decodeSubmission(await fixture.worker.request({ type: "submission_query",
    clientSubmissionId: "webp-success" }));
  expect(missing).toMatchObject({ found: false, reservation: "absent", admission: "absent", terminal: false,
    operationOutcome: "unknown", inputOutcome: "unresolved", persistence: "unresolved", relations: [],
    nextOffset: null });
  expect(await entries(fixture.worker)).toEqual(before); expect(await fixture.effects()).toEqual(effects);
}

async function verifyWebpSavedPart(worker: Worker, receipt: AttachmentReceipt, result: SubmissionResult): Promise<void> {
  const image = savedLink(result, "image", "input"), prepared = preparedImage(receipt);
  expect(image.link).toMatchObject(expectedLink(receipt, "image", "image"));
  expect(image.locator.kind).toBe("content");
  const saved = await entries(worker), matches = saved.entries.filter(entry => entry.id === image.entryId);
  expect(matches).toHaveLength(1);
  const input = z.object({ role: z.literal("user"), content: z.array(z.unknown()) }).parse(matches[0]?.message);
  const part = z.object({ type: z.literal("image"), data: z.string(), mimeType: z.string() })
    .parse(input.content[image.locator.index]);
  expect(part).toEqual({ type: "image", data: prepared.data, mimeType: prepared.mimeType });
  // Only the public relation entryId and actual part index supply causality; hashes witness bytes only.
  const history = await submissionHistory(worker), rows = history.filter(row => row.entryId === image.entryId);
  expect(rows.length).toBeGreaterThan(0);
  for (const row of rows) {
    expect(row.submission?.origin).toEqual(result.origin); expect(row.submission?.role).toBe("input");
    expect(row.submission?.attachments).toContainEqual(image.link);
  }
}

test("actual public WebP requires transformation consent before indexed saved image and provider delivery", async () => {
  await withWorker(async fixture => {
    const { worker } = fixture, before = await entries(worker), effects = await fixture.effects();
    const receipt = await prepareWebp(fixture), prepared = preparedImage(receipt);
    expect(await entries(worker)).toEqual(before); expect(await fixture.effects()).toEqual(effects);
    await refuseWebpWithoutConsent(fixture, receipt);
    expect(await worker.request(submission(fixture, receipt, "webp-success", ["image_transformed"])))
      .toMatchObject({ success: true });
    const result = await terminalSubmission(worker, "webp-success");
    const { sourceId, instanceId, nativeSessionId } = fixture.selected;
    expect(result).toMatchObject({ found: true, terminal: true, operationOutcome: "succeeded", inputOutcome: "generated",
      persistence: "committed", reservation: "committed", target: { sourceId, instanceId, nativeSessionId },
      origin: { sourceId, instanceId, nativeSessionId, clientSubmissionId: "webp-success" },
      preparation: consent(receipt, ["image_transformed"]) });
    await verifyWebpSavedPart(worker, receipt, result);
    const after = await fixture.effects();
    expect(after).toMatchObject({ inputCalls: effects.inputCalls + 1, modelAttempts: effects.modelAttempts + 1,
      modelDispatches: effects.modelDispatches + 1, toolCalls: effects.toolCalls, blockedPayloads: effects.blockedPayloads });
    expect(after.requests).toHaveLength(effects.requests.length + 1);
    expect(after.requests.at(-1)?.images).toEqual([{ mimeType: prepared.mimeType,
      bytes: Buffer.byteLength(prepared.data, "base64"), sha256: Bun.SHA256.hash(Buffer.from(prepared.data, "base64"), "hex") }]);
    expect(after.requests.at(-1)?.attachmentText).toEqual([]);
    expect(decodeSubmission(await worker.request({ type: "submission_query", clientSubmissionId: "webp-success" })))
      .toEqual(result);
    expect(await fixture.effects()).toEqual(after);
  });
}, 45_000);
