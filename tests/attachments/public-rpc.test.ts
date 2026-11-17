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
import type { FixtureCandidate } from "../continuation/worker.ts";
import { inspectAttachmentCandidate } from "./image-original-budget-cohort.ts";

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

async function withWorker(run: (fixture: Awaited<ReturnType<typeof openWorker>>) => Promise<void>,
  candidate: FixtureCandidate = "baseline"): Promise<void> {
  if (!Reflect.get(globalThis, Symbol.for("omp.s0.network-guard")) || os.tmpdir() !== "/tmp") {
    throw Error("ATTACHMENT_PUBLIC_FIXTURE_PREIMPORT_GUARD_AND_TOP_TMP_REQUIRED");
  }
  const home = await fs.mkdtemp("/tmp/attachment-public-");
  let fixture: Awaited<ReturnType<typeof openWorker>> | undefined;
  try {
    await inspectAttachmentCandidate(home, candidate);
    fixture = await openWorker(home, candidate); await run(fixture);
  }
  finally {
    try {
      if (fixture) {
        try { expect((await fixture.worker.close()).code).toBe(0); }
        finally { fixture.worker.child.kill(); await fixture.worker.child.exited; }
      }
    } finally { await fs.rm(home, { recursive: true, force: true }); }
  }
}

async function openWorker(home: string, candidate: FixtureCandidate) {
  await nativeFixture(home);
  const selected = await selectedDescriptor(home, undefined, candidate), cwd = path.join(home, "project");
  const worker = strictWorker(home, cwd, runtime, undefined, undefined, undefined, undefined, 10_000, candidate);
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

test("actual public malformed base64 with valid UTF8 refuses all input before reservation or effects", async () => {
  await withWorker(async fixture => {
    const { worker } = fixture, before = await entries(worker), effects = await fixture.effects();
    // This is only a schema-valid declaration: invalid base64 has no decoded original or decoded-byte hash.
    const declaredSha256 = "0000000000000000000000000000000000000000000000000000000000000000";
    const draft = { preparationId: "prepared-base64-failed", draftId: "draft-base64-failed", draftRevision: "1",
      authorityGeneration: "grant", message: "ordinary @missing-path prose", objects: [
        { originalId: "document", format: "utf8" as const, sha256: textSha256, data: Buffer.from(text).toBase64() },
        { originalId: "invalid", format: "utf8" as const, sha256: declaredSha256, data: "%%%%" },
      ] };
    const unchangedDraft = structuredClone(draft);
    // Raw public RPC bypasses AttachmentClient's original-byte validation and reaches the Native command seam.
    const response = await worker.request({ type: "attachment_prepare", ...draft });
    expect(response.success).toBe(true);
    if (!isAttachmentReceipt(response.data)) throw Error("ATTACHMENT_PUBLIC_BASE64_RECEIPT_SCHEMA");
    const receipt = response.data;
    expect(receipt).toMatchObject({ status: "failed", preparationId: draft.preparationId, draftId: draft.draftId,
      draftRevision: draft.draftRevision, authorityGeneration: draft.authorityGeneration,
      binding: { sourceId: fixture.selected.sourceId, instanceId: fixture.selected.instanceId,
        nativeSessionId: fixture.selected.nativeSessionId } });
    expect(receipt.items).toHaveLength(2);
    expect(receipt.items).toMatchObject([
      { status: "ready", originalId: "document", originalSha256: textSha256, preparedSha256: preparedTextSha256,
        representation: { kind: "text", text }, degradations: [] },
      { status: "failed", originalId: "invalid", originalSha256: declaredSha256, preparedSha256: "",
        code: "attachment_invalid_base64" },
    ]);
    expect(await entries(worker)).toEqual(before); expect(await fixture.effects()).toEqual(effects);
    expect(await worker.request(submission(fixture, receipt, "base64-refused")))
      .toMatchObject({ success: false, code: "ATTACHMENT_NOT_READY", error: "ATTACHMENT_NOT_READY" });
    const missing = decodeSubmission(await worker.request({ type: "submission_query",
      clientSubmissionId: "base64-refused" }));
    expect(missing).toMatchObject({ found: false, admission: "absent", reservation: "absent", terminal: false,
      inputOutcome: "unresolved", operationOutcome: "unknown", persistence: "unresolved", relations: [],
      nextOffset: null });
    expect(await entries(worker)).toEqual(before); expect(await fixture.effects()).toEqual(effects);
    expect(draft).toEqual(unchangedDraft);
    expect(Bun.SHA256.hash(Buffer.from(draft.objects[0]!.data, "base64"), "hex")).toBe(textSha256);
    // Exact caller draft retention includes the malformed raw string and declaration; no browser persistence claim.
  }, "image-original-budget-v2");
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

async function prepareGif(fixture: Awaited<ReturnType<typeof openWorker>>): Promise<AttachmentReceipt> {
  // Independent Pillow/hashlib pins describe BOTH original frames, never a predicted Native encoder output.
  const original = await fs.readFile(new URL("./fixtures/animated-200.gif", import.meta.url));
  const originalSha256 = "9fc83392f6ac16f708340fc43181bdb9469390402bf7054c8e2d46f26289051b";
  const originalCarrierSha256 = "7f011bc0cc9aae1cdea6ce39accaaf28164362331282f3c4ded6f137f6e87df5";
  expect(original.byteLength).toBe(2263); expect(Bun.SHA256.hash(original, "hex")).toBe(originalSha256);
  const carrier = { kind: "image", mimeType: "image/gif", data: original.toBase64(), width: 200, height: 200 };
  expect(Bun.SHA256.hash(JSON.stringify(carrier), "hex")).toBe(originalCarrierSha256);
  const receipt = await fixture.client.prepare({ preparationId: "prepared-gif", draftId: "draft-gif",
    draftRevision: "1", authorityGeneration: "grant", message: "ordinary @missing-path prose", objects: [
      { originalId: "image", format: "gif", sha256: originalSha256, data: original.toBase64() },
    ] });
  expect(receipt).toMatchObject({ status: "ready", preparationId: "prepared-gif", draftId: "draft-gif",
    draftRevision: "1", authorityGeneration: "grant", binding: { sourceId: fixture.selected.sourceId,
      instanceId: fixture.selected.instanceId, nativeSessionId: fixture.selected.nativeSessionId, imageCapable: true } });
  expect(receipt.items).toHaveLength(1);
  const item = receipt.items[0], prepared = preparedImage(receipt);
  if (!item || item.status !== "ready") throw Error("ATTACHMENT_PUBLIC_GIF_NOT_READY");
  expect(item.originalSha256).toBe(originalSha256);
  expect(item.degradations).toEqual(["image_transformed", "animation_first_frame_only"]);
  expect(["image/png", "image/jpeg"]).toContain(prepared.mimeType);
  expect({ width: prepared.width, height: prepared.height }).toEqual({ width: 200, height: 200 });
  const preparedBytes = Buffer.from(prepared.data, "base64");
  expect(preparedBytes.byteLength).toBeGreaterThan(0);
  expect(preparedBytes.byteLength).toBeLessThanOrEqual(500 * 1024);
  expect(Bun.SHA256.hash(preparedBytes, "hex")).not.toBe(originalSha256);
  // Consistency only: neither prepared pixels/first-frame fidelity nor exact encoder bytes/hash are predicted.
  const representation = { kind: "image", mimeType: prepared.mimeType, data: prepared.data,
    width: prepared.width, height: prepared.height };
  expect(item.preparedSha256).toBe(Bun.SHA256.hash(JSON.stringify(representation), "hex"));
  expect(item.preparedSha256).not.toBe(originalCarrierSha256);
  expect(item.facts).toEqual({ originalBytes: 2263, preparedBytes: preparedBytes.byteLength,
    sourceWidth: 200, sourceHeight: 200, frames: 2, decodedBytes: 320000 });
  return receipt;
}

async function refuseGifWithoutExactConsent(fixture: Awaited<ReturnType<typeof openWorker>>,
  receipt: AttachmentReceipt, acceptedDegradations: string[]) {
  const before = await entries(fixture.worker), effects = await fixture.effects();
  expect(await fixture.worker.request(submission(fixture, receipt, "gif-success", acceptedDegradations)))
    .toMatchObject({ success: false, code: "ATTACHMENT_DEGRADATION_CONSENT_REQUIRED",
      error: "ATTACHMENT_DEGRADATION_CONSENT_REQUIRED" });
  const missing = decodeSubmission(await fixture.worker.request({ type: "submission_query",
    clientSubmissionId: "gif-success" }));
  expect(missing).toMatchObject({ found: false, reservation: "absent", admission: "absent", terminal: false,
    operationOutcome: "unknown", inputOutcome: "unresolved", persistence: "unresolved", relations: [],
    nextOffset: null });
  expect(await entries(fixture.worker)).toEqual(before); expect(await fixture.effects()).toEqual(effects);
}

async function verifyGifSavedPart(worker: Worker, receipt: AttachmentReceipt, result: SubmissionResult): Promise<void> {
  const image = savedLink(result, "image", "input"), prepared = preparedImage(receipt);
  expect(image.link).toMatchObject(expectedLink(receipt, "image", "image"));
  expect(image.locator.kind).toBe("content");
  const saved = await entries(worker), matches = saved.entries.filter(entry => entry.id === image.entryId);
  expect(matches).toHaveLength(1);
  const input = z.object({ role: z.literal("user"), content: z.array(z.unknown()) }).parse(matches[0]?.message);
  const part = z.object({ type: z.literal("image"), data: z.string(), mimeType: z.string() })
    .parse(input.content[image.locator.index]);
  expect(part).toEqual({ type: "image", data: prepared.data, mimeType: prepared.mimeType });
  // Causal joins use only public relation.entryId and actual indexed body, never text/hash/order matching.
  const history = await submissionHistory(worker), rows = history.filter(row => row.entryId === image.entryId);
  expect(rows.length).toBeGreaterThan(0);
  for (const row of rows) {
    expect(row.submission?.origin).toEqual(result.origin); expect(row.submission?.role).toBe("input");
    expect(row.submission?.attachments).toContainEqual(image.link);
  }
}

test("actual public animated GIF requires exact loss consent before indexed saved image and provider delivery", async () => {
  await withWorker(async fixture => {
    const { worker } = fixture, before = await entries(worker), effects = await fixture.effects();
    const receipt = await prepareGif(fixture), prepared = preparedImage(receipt);
    expect(await entries(worker)).toEqual(before); expect(await fixture.effects()).toEqual(effects);
    await refuseGifWithoutExactConsent(fixture, receipt, []);
    await refuseGifWithoutExactConsent(fixture, receipt, ["image_transformed"]);
    const accepted = ["image_transformed", "animation_first_frame_only"];
    expect(await worker.request(submission(fixture, receipt, "gif-success", accepted)))
      .toMatchObject({ success: true });
    const result = await terminalSubmission(worker, "gif-success");
    const { sourceId, instanceId, nativeSessionId } = fixture.selected;
    expect(result).toMatchObject({ found: true, terminal: true, operationOutcome: "succeeded", inputOutcome: "generated",
      persistence: "committed", reservation: "committed", target: { sourceId, instanceId, nativeSessionId },
      origin: { sourceId, instanceId, nativeSessionId, clientSubmissionId: "gif-success" },
      preparation: consent(receipt, accepted) });
    await verifyGifSavedPart(worker, receipt, result);
    const after = await fixture.effects();
    expect(after).toMatchObject({ inputCalls: effects.inputCalls + 1, modelAttempts: effects.modelAttempts + 1,
      modelDispatches: effects.modelDispatches + 1, toolCalls: effects.toolCalls, blockedPayloads: effects.blockedPayloads });
    expect(after.requests).toHaveLength(effects.requests.length + 1);
    expect(after.requests.at(-1)?.images).toEqual([{ mimeType: prepared.mimeType,
      bytes: Buffer.byteLength(prepared.data, "base64"), sha256: Bun.SHA256.hash(Buffer.from(prepared.data, "base64"), "hex") }]);
    expect(after.requests.at(-1)?.attachmentText).toEqual([]);
    expect(decodeSubmission(await worker.request({ type: "submission_query", clientSubmissionId: "gif-success" })))
      .toEqual(result);
    expect(await fixture.effects()).toEqual(after);
  });
}, 45_000);

function pdfText(receipt: AttachmentReceipt): string {
  const item = receipt.items.find(item => item.originalId === "pdf");
  if (!item || item.status !== "ready" || item.representation.kind !== "text") {
    throw Error("ATTACHMENT_PUBLIC_PDF_READY_TEXT_MISSING");
  }
  return item.representation.text;
}

async function preparePdf(fixture: Awaited<ReturnType<typeof openWorker>>): Promise<AttachmentReceipt> {
  // Independent standard PDF objects/xref/ASCII Tj literals; no Native extraction supplied these known facts.
  const original = await fs.readFile(new URL("./fixtures/minimal-text.pdf", import.meta.url));
  const originalSha256 = "e30ca8235d4595eb5a7d5f99b41f12e32c10375a8a78b199577737f15d48dff3";
  expect(original.byteLength).toBe(706); expect(Bun.SHA256.hash(original, "hex")).toBe(originalSha256);
  const receipt = await fixture.client.prepare({ preparationId: "prepared-pdf", draftId: "draft-pdf",
    draftRevision: "1", authorityGeneration: "grant", message: "ordinary @missing-path prose", objects: [
      { originalId: "pdf", format: "pdf", sha256: originalSha256, data: original.toBase64() },
    ] });
  expect(receipt).toMatchObject({ status: "ready", preparationId: "prepared-pdf", draftId: "draft-pdf",
    draftRevision: "1", authorityGeneration: "grant", binding: { sourceId: fixture.selected.sourceId,
      instanceId: fixture.selected.instanceId, nativeSessionId: fixture.selected.nativeSessionId } });
  expect(receipt.items).toHaveLength(1);
  const item = receipt.items[0], prepared = pdfText(receipt);
  if (!item || item.status !== "ready") throw Error("ATTACHMENT_PUBLIC_PDF_NOT_READY");
  expect(item.originalSha256).toBe(originalSha256);
  expect(item.degradations).toEqual(["document_structure_changed"]);
  for (const literal of ["Controlled prepared document", "Independent PDF line two.", "End of one PDF page."]) {
    expect(prepared.split(literal)).toHaveLength(2);
  }
  expect(prepared.match(/<!-- Page \d+ -->/g)).toEqual(["<!-- Page 1 -->"]);
  const bytes = Buffer.byteLength(prepared);
  expect(bytes).toBeGreaterThan(28); expect(bytes).toBeLessThanOrEqual(50 * 1024);
  // Full Markdown formatting/hash is deliberately unpredicted; this checks public digest consistency only.
  expect(item.preparedSha256).toBe(Bun.SHA256.hash(JSON.stringify({ kind: "text", text: prepared }), "hex"));
  expect(item.preparedSha256).not.toBe(originalSha256);
  expect(item.facts).toEqual({ originalBytes: 706, convertedBytes: bytes,
    pagesNeedingOcr: [], hasEncodingIssues: false, emptyText: false });
  return receipt;
}

async function refusePdfWithoutConsent(fixture: Awaited<ReturnType<typeof openWorker>>, receipt: AttachmentReceipt) {
  const before = await entries(fixture.worker), effects = await fixture.effects();
  expect(await fixture.worker.request(submission(fixture, receipt, "pdf-success", [])))
    .toMatchObject({ success: false, code: "ATTACHMENT_DEGRADATION_CONSENT_REQUIRED",
      error: "ATTACHMENT_DEGRADATION_CONSENT_REQUIRED" });
  const missing = decodeSubmission(await fixture.worker.request({ type: "submission_query",
    clientSubmissionId: "pdf-success" }));
  expect(missing).toMatchObject({ found: false, reservation: "absent", admission: "absent", terminal: false,
    operationOutcome: "unknown", inputOutcome: "unresolved", persistence: "unresolved", relations: [],
    nextOffset: null });
  expect(await entries(fixture.worker)).toEqual(before); expect(await fixture.effects()).toEqual(effects);
}

async function verifyPdfSavedPart(worker: Worker, receipt: AttachmentReceipt, result: SubmissionResult): Promise<void> {
  const document = savedLink(result, "pdf", "prepared"), prepared = pdfText(receipt);
  expect(document.link).toMatchObject(expectedLink(receipt, "pdf", "text"));
  expect(document.locator.kind).toBe("files");
  const saved = await entries(worker), matches = saved.entries.filter(entry => entry.id === document.entryId);
  expect(matches).toHaveLength(1);
  const companion = z.object({ role: z.literal("fileMention"), files: z.array(z.unknown()) }).parse(matches[0]?.message);
  const part = z.object({ path: z.string(), content: z.string(), byteSize: z.number() })
    .parse(companion.files[document.locator.index]);
  expect(part).toEqual({ path: `attachment-prepared://${document.link.preparedId}`,
    content: prepared, byteSize: Buffer.byteLength(prepared) });
  // Only returned public entryId and actual indexed body establish causality, never text/hash/order joins.
  const history = await submissionHistory(worker), rows = history.filter(row => row.entryId === document.entryId);
  expect(rows.length).toBeGreaterThan(0);
  for (const row of rows) {
    expect(row.submission?.origin).toEqual(result.origin); expect(row.submission?.role).toBe("prepared");
    expect(row.submission?.attachments).toContainEqual(document.link);
  }
}

test("actual public PDF requires structure consent before indexed saved text and provider witness", async () => {
  await withWorker(async fixture => {
    const { worker } = fixture, before = await entries(worker), effects = await fixture.effects();
    const receipt = await preparePdf(fixture);
    expect(await entries(worker)).toEqual(before); expect(await fixture.effects()).toEqual(effects);
    await refusePdfWithoutConsent(fixture, receipt);
    expect(await worker.request(submission(fixture, receipt, "pdf-success", ["document_structure_changed"])))
      .toMatchObject({ success: true });
    const result = await terminalSubmission(worker, "pdf-success");
    const { sourceId, instanceId, nativeSessionId } = fixture.selected;
    expect(result).toMatchObject({ found: true, terminal: true, operationOutcome: "succeeded", inputOutcome: "generated",
      persistence: "committed", reservation: "committed", target: { sourceId, instanceId, nativeSessionId },
      origin: { sourceId, instanceId, nativeSessionId, clientSubmissionId: "pdf-success" },
      preparation: consent(receipt, ["document_structure_changed"]) });
    await verifyPdfSavedPart(worker, receipt, result);
    const after = await fixture.effects();
    expect(after).toMatchObject({ inputCalls: effects.inputCalls + 1, modelAttempts: effects.modelAttempts + 1,
      modelDispatches: effects.modelDispatches + 1, toolCalls: effects.toolCalls, blockedPayloads: effects.blockedPayloads });
    expect(after.requests).toHaveLength(effects.requests.length + 1);
    expect(after.requests.at(-1)?.images).toEqual([]);
    // Unchanged provider witnesses these independent28B, not the full generated Markdown/wrapper formatting.
    expect(after.requests.at(-1)?.attachmentText).toEqual([{ role: "developer", bytes: 28, occurrences: 1,
      sha256: "fd4d618665fd8dbb429346ec93e6996c7f60ce30e0cf40de732e5a1ac9ef8419" }]);
    expect(decodeSubmission(await worker.request({ type: "submission_query", clientSubmissionId: "pdf-success" })))
      .toEqual(result);
    expect(await fixture.effects()).toEqual(after);
  });
}, 45_000);

async function preparePptx(fixture: Awaited<ReturnType<typeof openWorker>>): Promise<AttachmentReceipt> {
  // Independent ZIP/XML authoring and worked literal output from the explicit one-shape Native source contract.
  const original = await fs.readFile(new URL("./fixtures/minimal-slide.pptx", import.meta.url));
  const originalSha256 = "5fb6e0a206ed3c2e7f433208c1390fd607d420a212a4d125d3f20cc668ee4047";
  expect(original.byteLength).toBe(9155); expect(Bun.SHA256.hash(original, "hex")).toBe(originalSha256);
  const receipt = await fixture.client.prepare({ preparationId: "prepared-pptx", draftId: "draft-pptx",
    draftRevision: "1", authorityGeneration: "grant", message: "ordinary @missing-path prose", objects: [
      { originalId: "pptx", format: "pptx", sha256: originalSha256, data: original.toBase64() },
    ] });
  expect(receipt).toMatchObject({ status: "ready", preparationId: "prepared-pptx", draftId: "draft-pptx",
    draftRevision: "1", authorityGeneration: "grant", binding: { sourceId: fixture.selected.sourceId,
      instanceId: fixture.selected.instanceId, nativeSessionId: fixture.selected.nativeSessionId } });
  expect(receipt.items).toHaveLength(1);
  const item = receipt.items[0];
  if (!item || item.status !== "ready") throw Error("ATTACHMENT_PUBLIC_PPTX_NOT_READY");
  expect(item.originalSha256).toBe(originalSha256);
  expect(item.representation).toEqual({ kind: "text", text: "<!-- Slide 1 -->\n# Controlled prepared document" });
  expect(item.preparedSha256).toBe("b5d42976db4cbd29109b98f52b018142342ecff02046bb437bc447f879a5e642");
  expect(item.degradations).toEqual(["document_structure_changed"]);
  expect(item.facts).toEqual({ originalBytes: 9155, convertedBytes: 47, omittedImages: 0 });
  expect(item.preparedSha256).not.toBe(originalSha256);
  return receipt;
}

async function refusePptxWithoutConsent(fixture: Awaited<ReturnType<typeof openWorker>>, receipt: AttachmentReceipt) {
  const before = await entries(fixture.worker), effects = await fixture.effects();
  expect(await fixture.worker.request(submission(fixture, receipt, "pptx-success", [])))
    .toMatchObject({ success: false, code: "ATTACHMENT_DEGRADATION_CONSENT_REQUIRED",
      error: "ATTACHMENT_DEGRADATION_CONSENT_REQUIRED" });
  const missing = decodeSubmission(await fixture.worker.request({ type: "submission_query",
    clientSubmissionId: "pptx-success" }));
  expect(missing).toMatchObject({ found: false, reservation: "absent", admission: "absent", terminal: false,
    operationOutcome: "unknown", inputOutcome: "unresolved", persistence: "unresolved", relations: [],
    nextOffset: null });
  expect(await entries(fixture.worker)).toEqual(before); expect(await fixture.effects()).toEqual(effects);
}

async function verifyPptxSavedPart(worker: Worker, receipt: AttachmentReceipt, result: SubmissionResult): Promise<void> {
  const document = savedLink(result, "pptx", "prepared");
  expect(document.link).toMatchObject(expectedLink(receipt, "pptx", "text"));
  expect(document.locator.kind).toBe("files");
  const saved = await entries(worker), matches = saved.entries.filter(entry => entry.id === document.entryId);
  expect(matches).toHaveLength(1);
  const companion = z.object({ role: z.literal("fileMention"), files: z.array(z.unknown()) }).parse(matches[0]?.message);
  const part = z.object({ path: z.string(), content: z.string(), byteSize: z.number() })
    .parse(companion.files[document.locator.index]);
  expect(part).toEqual({ path: `attachment-prepared://${document.link.preparedId}`,
    content: "<!-- Slide 1 -->\n# Controlled prepared document", byteSize: 47 });
  expect(Bun.SHA256.hash(part.content, "hex"))
    .toBe("ab7960c2ef2749964d702874060d3adaeea90bce603cf89b84c3bdb473bae489");
  // Causality uses only returned public entryId and actual indexed body, never text/hash/order matching.
  const history = await submissionHistory(worker), rows = history.filter(row => row.entryId === document.entryId);
  expect(rows.length).toBeGreaterThan(0);
  for (const row of rows) {
    expect(row.submission?.origin).toEqual(result.origin); expect(row.submission?.role).toBe("prepared");
    expect(row.submission?.attachments).toContainEqual(document.link);
  }
}

test("actual public PPTX requires structure consent before indexed saved text and provider witness", async () => {
  await withWorker(async fixture => {
    const { worker } = fixture, before = await entries(worker), effects = await fixture.effects();
    const receipt = await preparePptx(fixture);
    expect(await entries(worker)).toEqual(before); expect(await fixture.effects()).toEqual(effects);
    await refusePptxWithoutConsent(fixture, receipt);
    expect(await worker.request(submission(fixture, receipt, "pptx-success", ["document_structure_changed"])))
      .toMatchObject({ success: true });
    const result = await terminalSubmission(worker, "pptx-success");
    const { sourceId, instanceId, nativeSessionId } = fixture.selected;
    expect(result).toMatchObject({ found: true, terminal: true, operationOutcome: "succeeded", inputOutcome: "generated",
      persistence: "committed", reservation: "committed", target: { sourceId, instanceId, nativeSessionId },
      origin: { sourceId, instanceId, nativeSessionId, clientSubmissionId: "pptx-success" },
      preparation: consent(receipt, ["document_structure_changed"]) });
    await verifyPptxSavedPart(worker, receipt, result);
    const after = await fixture.effects();
    expect(after).toMatchObject({ inputCalls: effects.inputCalls + 1, modelAttempts: effects.modelAttempts + 1,
      modelDispatches: effects.modelDispatches + 1, toolCalls: effects.toolCalls, blockedPayloads: effects.blockedPayloads });
    expect(after.requests).toHaveLength(effects.requests.length + 1);
    expect(after.requests.at(-1)?.images).toEqual([]);
    // Existing provider witnesses independently authored28B only, not the complete47B Markdown/wrapper delivery.
    expect(after.requests.at(-1)?.attachmentText).toEqual([{ role: "developer", bytes: 28, occurrences: 1,
      sha256: "fd4d618665fd8dbb429346ec93e6996c7f60ce30e0cf40de732e5a1ac9ef8419" }]);
    expect(decodeSubmission(await worker.request({ type: "submission_query", clientSubmissionId: "pptx-success" })))
      .toEqual(result);
    expect(await fixture.effects()).toEqual(after);
  });
}, 45_000);

async function prepareXlsx(fixture: Awaited<ReturnType<typeof openWorker>>): Promise<AttachmentReceipt> {
  // Independent ZIP/XML authoring and worked literal output from the explicit inline-cell Native source contract.
  const original = await fs.readFile(new URL("./fixtures/minimal-workbook.xlsx", import.meta.url));
  const originalSha256 = "94807b10285705fa5ea6c6c2a145f5cc81e0add726970438691279d7f6ef5617";
  expect(original.byteLength).toBe(2372); expect(Bun.SHA256.hash(original, "hex")).toBe(originalSha256);
  const receipt = await fixture.client.prepare({ preparationId: "prepared-xlsx", draftId: "draft-xlsx",
    draftRevision: "1", authorityGeneration: "grant", message: "ordinary @missing-path prose", objects: [
      { originalId: "xlsx", format: "xlsx", sha256: originalSha256, data: original.toBase64() },
    ] });
  expect(receipt).toMatchObject({ status: "ready", preparationId: "prepared-xlsx", draftId: "draft-xlsx",
    draftRevision: "1", authorityGeneration: "grant", binding: { sourceId: fixture.selected.sourceId,
      instanceId: fixture.selected.instanceId, nativeSessionId: fixture.selected.nativeSessionId } });
  expect(receipt.items).toHaveLength(1);
  const item = receipt.items[0];
  if (!item || item.status !== "ready") throw Error("ATTACHMENT_PUBLIC_XLSX_NOT_READY");
  expect(item.originalSha256).toBe(originalSha256);
  expect(item.representation).toEqual({ kind: "text",
    text: "## Evidence\n\n| Source |\n| --- |\n| Controlled prepared document |" });
  expect(item.preparedSha256).toBe("cae9f008d29403adfdba540bf8bb3e2e8771de2cff76e081b910c0ef11d6c91f");
  expect(item.degradations).toEqual(["document_structure_changed"]);
  expect(item.facts).toEqual({ originalBytes: 2372, convertedBytes: 64, omittedImages: 0 });
  expect(item.preparedSha256).not.toBe(originalSha256);
  return receipt;
}

async function refuseXlsxWithoutConsent(fixture: Awaited<ReturnType<typeof openWorker>>, receipt: AttachmentReceipt) {
  const before = await entries(fixture.worker), effects = await fixture.effects();
  expect(await fixture.worker.request(submission(fixture, receipt, "xlsx-success", [])))
    .toMatchObject({ success: false, code: "ATTACHMENT_DEGRADATION_CONSENT_REQUIRED",
      error: "ATTACHMENT_DEGRADATION_CONSENT_REQUIRED" });
  const missing = decodeSubmission(await fixture.worker.request({ type: "submission_query",
    clientSubmissionId: "xlsx-success" }));
  expect(missing).toMatchObject({ found: false, reservation: "absent", admission: "absent", terminal: false,
    operationOutcome: "unknown", inputOutcome: "unresolved", persistence: "unresolved", relations: [],
    nextOffset: null });
  expect(await entries(fixture.worker)).toEqual(before); expect(await fixture.effects()).toEqual(effects);
}

async function verifyXlsxSavedPart(worker: Worker, receipt: AttachmentReceipt, result: SubmissionResult): Promise<void> {
  const document = savedLink(result, "xlsx", "prepared");
  expect(document.link).toMatchObject(expectedLink(receipt, "xlsx", "text"));
  expect(document.locator.kind).toBe("files");
  const saved = await entries(worker), matches = saved.entries.filter(entry => entry.id === document.entryId);
  expect(matches).toHaveLength(1);
  const companion = z.object({ role: z.literal("fileMention"), files: z.array(z.unknown()) }).parse(matches[0]?.message);
  const part = z.object({ path: z.string(), content: z.string(), byteSize: z.number() })
    .parse(companion.files[document.locator.index]);
  expect(part).toEqual({ path: `attachment-prepared://${document.link.preparedId}`,
    content: "## Evidence\n\n| Source |\n| --- |\n| Controlled prepared document |", byteSize: 64 });
  expect(Bun.SHA256.hash(part.content, "hex"))
    .toBe("06f69c982c70cdbea1d395c14a7564fd6683e2c53437e6d488032e86f015ce6e");
  // Causality uses only returned public entryId and actual indexed body, never text/hash/order matching.
  const history = await submissionHistory(worker), rows = history.filter(row => row.entryId === document.entryId);
  expect(rows.length).toBeGreaterThan(0);
  for (const row of rows) {
    expect(row.submission?.origin).toEqual(result.origin); expect(row.submission?.role).toBe("prepared");
    expect(row.submission?.attachments).toContainEqual(document.link);
  }
}

test("actual public XLSX requires structure consent before indexed saved text and provider witness", async () => {
  await withWorker(async fixture => {
    const { worker } = fixture, before = await entries(worker), effects = await fixture.effects();
    const receipt = await prepareXlsx(fixture);
    expect(await entries(worker)).toEqual(before); expect(await fixture.effects()).toEqual(effects);
    await refuseXlsxWithoutConsent(fixture, receipt);
    expect(await worker.request(submission(fixture, receipt, "xlsx-success", ["document_structure_changed"])))
      .toMatchObject({ success: true });
    const result = await terminalSubmission(worker, "xlsx-success");
    const { sourceId, instanceId, nativeSessionId } = fixture.selected;
    expect(result).toMatchObject({ found: true, terminal: true, operationOutcome: "succeeded", inputOutcome: "generated",
      persistence: "committed", reservation: "committed", target: { sourceId, instanceId, nativeSessionId },
      origin: { sourceId, instanceId, nativeSessionId, clientSubmissionId: "xlsx-success" },
      preparation: consent(receipt, ["document_structure_changed"]) });
    await verifyXlsxSavedPart(worker, receipt, result);
    const after = await fixture.effects();
    expect(after).toMatchObject({ inputCalls: effects.inputCalls + 1, modelAttempts: effects.modelAttempts + 1,
      modelDispatches: effects.modelDispatches + 1, toolCalls: effects.toolCalls, blockedPayloads: effects.blockedPayloads });
    expect(after.requests).toHaveLength(effects.requests.length + 1);
    expect(after.requests.at(-1)?.images).toEqual([]);
    // Existing provider witnesses independently authored28B only, not the complete64B Markdown/wrapper delivery.
    expect(after.requests.at(-1)?.attachmentText).toEqual([{ role: "developer", bytes: 28, occurrences: 1,
      sha256: "fd4d618665fd8dbb429346ec93e6996c7f60ce30e0cf40de732e5a1ac9ef8419" }]);
    expect(decodeSubmission(await worker.request({ type: "submission_query", clientSubmissionId: "xlsx-success" })))
      .toEqual(result);
    expect(await fixture.effects()).toEqual(after);
  });
}, 45_000);

async function prepareEpub(fixture: Awaited<ReturnType<typeof openWorker>>): Promise<AttachmentReceipt> {
  // Independent ZIP/XML authoring and worked literal output from the inspected EPUB/local HTML source chain.
  const original = await fs.readFile(new URL("./fixtures/minimal-chapter.epub", import.meta.url));
  const originalSha256 = "34985b766db4cddb6ecea12aac1a26690a3bd9aa631f6a402977c6d01f98bbd8";
  expect(original.byteLength).toBe(1893); expect(Bun.SHA256.hash(original, "hex")).toBe(originalSha256);
  const receipt = await fixture.client.prepare({ preparationId: "prepared-epub", draftId: "draft-epub",
    draftRevision: "1", authorityGeneration: "grant", message: "ordinary @missing-path prose", objects: [
      { originalId: "epub", format: "epub", sha256: originalSha256, data: original.toBase64() },
    ] });
  expect(receipt).toMatchObject({ status: "ready", preparationId: "prepared-epub", draftId: "draft-epub",
    draftRevision: "1", authorityGeneration: "grant", binding: { sourceId: fixture.selected.sourceId,
      instanceId: fixture.selected.instanceId, nativeSessionId: fixture.selected.nativeSessionId } });
  expect(receipt.items).toHaveLength(1);
  const item = receipt.items[0];
  if (!item || item.status !== "ready") throw Error("ATTACHMENT_PUBLIC_EPUB_NOT_READY");
  expect(item.originalSha256).toBe(originalSha256);
  expect(item.representation).toEqual({ kind: "text",
    text: "**Title:** EPUB witness\n**Language:** en\n\nChapter\n\nControlled prepared document" });
  expect(item.preparedSha256).toBe("b04d22a6b470a322cd10704bd1cc40fadd3d3ae1a970399dc65fa2c860f7dc28");
  expect(item.degradations).toEqual(["document_structure_changed"]);
  expect(item.facts).toEqual({ originalBytes: 1893, convertedBytes: 79, omittedImages: 0 });
  expect(item.preparedSha256).not.toBe(originalSha256);
  return receipt;
}

async function refuseEpubWithoutConsent(fixture: Awaited<ReturnType<typeof openWorker>>, receipt: AttachmentReceipt) {
  const before = await entries(fixture.worker), effects = await fixture.effects();
  expect(await fixture.worker.request(submission(fixture, receipt, "epub-success", [])))
    .toMatchObject({ success: false, code: "ATTACHMENT_DEGRADATION_CONSENT_REQUIRED",
      error: "ATTACHMENT_DEGRADATION_CONSENT_REQUIRED" });
  const missing = decodeSubmission(await fixture.worker.request({ type: "submission_query",
    clientSubmissionId: "epub-success" }));
  expect(missing).toMatchObject({ found: false, reservation: "absent", admission: "absent", terminal: false,
    operationOutcome: "unknown", inputOutcome: "unresolved", persistence: "unresolved", relations: [],
    nextOffset: null });
  expect(await entries(fixture.worker)).toEqual(before); expect(await fixture.effects()).toEqual(effects);
}

async function verifyEpubSavedPart(worker: Worker, receipt: AttachmentReceipt, result: SubmissionResult): Promise<void> {
  const document = savedLink(result, "epub", "prepared");
  expect(document.link).toMatchObject(expectedLink(receipt, "epub", "text"));
  expect(document.locator.kind).toBe("files");
  const saved = await entries(worker), matches = saved.entries.filter(entry => entry.id === document.entryId);
  expect(matches).toHaveLength(1);
  const companion = z.object({ role: z.literal("fileMention"), files: z.array(z.unknown()) }).parse(matches[0]?.message);
  const part = z.object({ path: z.string(), content: z.string(), byteSize: z.number() })
    .parse(companion.files[document.locator.index]);
  expect(part).toEqual({ path: `attachment-prepared://${document.link.preparedId}`,
    content: "**Title:** EPUB witness\n**Language:** en\n\nChapter\n\nControlled prepared document", byteSize: 79 });
  expect(Bun.SHA256.hash(part.content, "hex"))
    .toBe("417f798e8bf98981a2f92d2dcab954563f2b79e7ce6486e7be4c0b14b0d4ccea");
  // Causality uses only returned public entryId and actual indexed body, never text/hash/order matching.
  const history = await submissionHistory(worker), rows = history.filter(row => row.entryId === document.entryId);
  expect(rows.length).toBeGreaterThan(0);
  for (const row of rows) {
    expect(row.submission?.origin).toEqual(result.origin); expect(row.submission?.role).toBe("prepared");
    expect(row.submission?.attachments).toContainEqual(document.link);
  }
}

test("actual public EPUB requires structure consent before indexed saved text and provider witness", async () => {
  await withWorker(async fixture => {
    const { worker } = fixture, before = await entries(worker), effects = await fixture.effects();
    const receipt = await prepareEpub(fixture);
    expect(await entries(worker)).toEqual(before); expect(await fixture.effects()).toEqual(effects);
    await refuseEpubWithoutConsent(fixture, receipt);
    expect(await worker.request(submission(fixture, receipt, "epub-success", ["document_structure_changed"])))
      .toMatchObject({ success: true });
    const result = await terminalSubmission(worker, "epub-success");
    const { sourceId, instanceId, nativeSessionId } = fixture.selected;
    expect(result).toMatchObject({ found: true, terminal: true, operationOutcome: "succeeded", inputOutcome: "generated",
      persistence: "committed", reservation: "committed", target: { sourceId, instanceId, nativeSessionId },
      origin: { sourceId, instanceId, nativeSessionId, clientSubmissionId: "epub-success" },
      preparation: consent(receipt, ["document_structure_changed"]) });
    await verifyEpubSavedPart(worker, receipt, result);
    const after = await fixture.effects();
    expect(after).toMatchObject({ inputCalls: effects.inputCalls + 1, modelAttempts: effects.modelAttempts + 1,
      modelDispatches: effects.modelDispatches + 1, toolCalls: effects.toolCalls, blockedPayloads: effects.blockedPayloads });
    expect(after.requests).toHaveLength(effects.requests.length + 1);
    expect(after.requests.at(-1)?.images).toEqual([]);
    // Existing provider witnesses independently authored28B only, not the complete79B Markdown/wrapper delivery.
    expect(after.requests.at(-1)?.attachmentText).toEqual([{ role: "developer", bytes: 28, occurrences: 1,
      sha256: "fd4d618665fd8dbb429346ec93e6996c7f60ce30e0cf40de732e5a1ac9ef8419" }]);
    expect(decodeSubmission(await worker.request({ type: "submission_query", clientSubmissionId: "epub-success" })))
      .toEqual(result);
    expect(await fixture.effects()).toEqual(after);
  });
}, 45_000);

async function prepareTextAtRawLimit(fixture: Awaited<ReturnType<typeof openWorker>>): Promise<AttachmentReceipt> {
  // Independent Python streaming literal pins; no Native result supplies expected bytes or hashes.
  const original = Buffer.from("Controlled prepared document" + "界".repeat(1_747_617) + "!", "utf8");
  const originalSha256 = "ba9da0ac80bbde2e2c0475b51f543ddfb61532a433af8792135dae85813a9bec";
  expect(original.byteLength).toBe(5_242_880); expect(Bun.SHA256.hash(original, "hex")).toBe(originalSha256);
  const receipt = await fixture.client.prepare({ preparationId: "prepared-text-limit", draftId: "draft-text-limit",
    draftRevision: "1", authorityGeneration: "grant", message: "ordinary @missing-path prose", objects: [
      { originalId: "text-limit", format: "utf8", sha256: originalSha256, data: original.toBase64() },
    ] });
  expect(receipt).toMatchObject({ status: "ready", preparationId: "prepared-text-limit", draftId: "draft-text-limit",
    draftRevision: "1", authorityGeneration: "grant", binding: { sourceId: fixture.selected.sourceId,
      instanceId: fixture.selected.instanceId, nativeSessionId: fixture.selected.nativeSessionId } });
  expect(receipt.items).toHaveLength(1);
  const item = receipt.items[0];
  if (!item || item.status !== "ready") throw Error("ATTACHMENT_PUBLIC_TEXT_LIMIT_NOT_READY");
  expect(item.originalSha256).toBe(originalSha256);
  expect(item.representation).toEqual({ kind: "text", text: "Controlled prepared document" + "界".repeat(17_057) });
  expect(item.preparedSha256).toBe("9bf7e907f0e0985e7f55064ee2fe5de719076439385805d545815b9930ebe2c3");
  expect(item.degradations).toEqual(["text_truncated"]);
  expect(item.preparedSha256).not.toBe(originalSha256);
  // UTF8 currently exposes the degradation itself, without optional byte-count AttachmentFacts.
  return receipt;
}

async function refuseTextWithoutConsent(fixture: Awaited<ReturnType<typeof openWorker>>, receipt: AttachmentReceipt) {
  const before = await entries(fixture.worker), effects = await fixture.effects();
  expect(await fixture.worker.request(submission(fixture, receipt, "text-limit-success", [])))
    .toMatchObject({ success: false, code: "ATTACHMENT_DEGRADATION_CONSENT_REQUIRED",
      error: "ATTACHMENT_DEGRADATION_CONSENT_REQUIRED" });
  const missing = decodeSubmission(await fixture.worker.request({ type: "submission_query",
    clientSubmissionId: "text-limit-success" }));
  expect(missing).toMatchObject({ found: false, reservation: "absent", admission: "absent", terminal: false,
    operationOutcome: "unknown", inputOutcome: "unresolved", persistence: "unresolved", relations: [], nextOffset: null });
  expect(await entries(fixture.worker)).toEqual(before); expect(await fixture.effects()).toEqual(effects);
}

async function verifyTextLimitSavedPart(worker: Worker, receipt: AttachmentReceipt, result: SubmissionResult) {
  const document = savedLink(result, "text-limit", "prepared");
  expect(document.link).toMatchObject(expectedLink(receipt, "text-limit", "text"));
  expect(document.locator.kind).toBe("files");
  const saved = await entries(worker), matches = saved.entries.filter(entry => entry.id === document.entryId);
  expect(matches).toHaveLength(1);
  const companion = z.object({ role: z.literal("fileMention"), files: z.array(z.unknown()) }).parse(matches[0]?.message);
  const part = z.object({ path: z.string(), content: z.string(), byteSize: z.number() })
    .parse(companion.files[document.locator.index]);
  expect(part).toEqual({ path: `attachment-prepared://${document.link.preparedId}`,
    content: "Controlled prepared document" + "界".repeat(17_057), byteSize: 51_199 });
  expect(Buffer.byteLength(part.content, "utf8")).toBe(51_199);
  expect(Bun.SHA256.hash(part.content, "hex"))
    .toBe("5a567064a39ff504a906cd425e64e15d14a8ba1c865ba20a374242e1cb2b950f");
  // Causality uses only returned public entryId and actual indexed body, never text/hash/order matching.
  const history = await submissionHistory(worker), rows = history.filter(row => row.entryId === document.entryId);
  expect(rows.length).toBeGreaterThan(0);
  for (const row of rows) {
    expect(row.submission?.origin).toEqual(result.origin); expect(row.submission?.role).toBe("prepared");
    expect(row.submission?.attachments).toContainEqual(document.link);
  }
}

async function refuseTextOneByteOver(fixture: Awaited<ReturnType<typeof openWorker>>) {
  const before = await entries(fixture.worker), effects = await fixture.effects();
  const original = Buffer.from("Controlled prepared document" + "界".repeat(1_747_617) + "!!", "utf8");
  const originalSha256 = "b531fde1cecce82394955e183dd34efaf72d85e9abb4707c1e2f102d76d3c350";
  expect(original.byteLength).toBe(5_242_881); expect(Bun.SHA256.hash(original, "hex")).toBe(originalSha256);
  const draft = { preparationId: "prepared-text-over", draftId: "draft-text-over", draftRevision: "1",
    authorityGeneration: "grant", message: "ordinary @missing-path prose", objects: [
      { originalId: "text-over", format: "utf8" as const, sha256: originalSha256, data: original.toBase64() },
    ] };
  const unchangedDraft = structuredClone(draft);
  const receipt = await fixture.client.prepare(draft);
  expect(receipt).toMatchObject({ status: "failed", preparationId: draft.preparationId, draftId: draft.draftId,
    draftRevision: draft.draftRevision, authorityGeneration: draft.authorityGeneration,
    binding: { sourceId: fixture.selected.sourceId, instanceId: fixture.selected.instanceId,
      nativeSessionId: fixture.selected.nativeSessionId } });
  expect(receipt.items).toHaveLength(1);
  expect(receipt.items[0]).toMatchObject({ status: "failed", originalId: "text-over", originalSha256,
    preparedSha256: "", code: "attachment_original_budget" });
  expect(await entries(fixture.worker)).toEqual(before); expect(await fixture.effects()).toEqual(effects);
  expect(await fixture.worker.request(submission(fixture, receipt, "text-over-refused", [])))
    .toMatchObject({ success: false, code: "ATTACHMENT_NOT_READY", error: "ATTACHMENT_NOT_READY" });
  const missing = decodeSubmission(await fixture.worker.request({ type: "submission_query",
    clientSubmissionId: "text-over-refused" }));
  expect(missing).toMatchObject({ found: false, reservation: "absent", admission: "absent", terminal: false,
    operationOutcome: "unknown", inputOutcome: "unresolved", persistence: "unresolved", relations: [], nextOffset: null });
  expect(await entries(fixture.worker)).toEqual(before); expect(await fixture.effects()).toEqual(effects);
  expect(draft).toEqual(unchangedDraft);
  expect(Bun.SHA256.hash(Buffer.from(draft.objects[0]!.data, "base64"), "hex")).toBe(originalSha256);
  // This checks the caller's complete retained draft, not untested browser persistence or editor state.
}

test("actual public 5MiB UTF8 requires truncation consent and refuses one byte over before effects", async () => {
  await withWorker(async fixture => {
    const { worker } = fixture, before = await entries(worker), effects = await fixture.effects();
    const receipt = await prepareTextAtRawLimit(fixture);
    expect(await entries(worker)).toEqual(before); expect(await fixture.effects()).toEqual(effects);
    await refuseTextWithoutConsent(fixture, receipt);
    expect(await worker.request(submission(fixture, receipt, "text-limit-success", ["text_truncated"])))
      .toMatchObject({ success: true });
    const result = await terminalSubmission(worker, "text-limit-success");
    const { sourceId, instanceId, nativeSessionId } = fixture.selected;
    expect(result).toMatchObject({ found: true, terminal: true, operationOutcome: "succeeded", inputOutcome: "generated",
      persistence: "committed", reservation: "committed", target: { sourceId, instanceId, nativeSessionId },
      origin: { sourceId, instanceId, nativeSessionId, clientSubmissionId: "text-limit-success" },
      preparation: consent(receipt, ["text_truncated"]) });
    await verifyTextLimitSavedPart(worker, receipt, result);
    const after = await fixture.effects();
    expect(after).toMatchObject({ inputCalls: effects.inputCalls + 1, modelAttempts: effects.modelAttempts + 1,
      modelDispatches: effects.modelDispatches + 1, toolCalls: effects.toolCalls, blockedPayloads: effects.blockedPayloads });
    expect(after.requests).toHaveLength(effects.requests.length + 1);
    expect(after.requests.at(-1)?.images).toEqual([]);
    // Unchanged provider witnesses known28B once; full51199B/provider wrapper delivery remains unclaimed.
    expect(after.requests.at(-1)?.attachmentText).toEqual([{ role: "developer", bytes: 28, occurrences: 1,
      sha256: "fd4d618665fd8dbb429346ec93e6996c7f60ce30e0cf40de732e5a1ac9ef8419" }]);
    expect(decodeSubmission(await worker.request({ type: "submission_query", clientSubmissionId: "text-limit-success" })))
      .toEqual(result);
    expect(await fixture.effects()).toEqual(after);
    await refuseTextOneByteOver(fixture);
    expect(await fixture.effects()).toEqual(after);
  });
}, 45_000);

type BudgetDraft = Parameters<AttachmentClient["prepare"]>[0];
type BudgetCommand = BudgetDraft & { type: "attachment_prepare"; id?: string };

function countTotalDraft(): BudgetDraft {
  // Spec29/Q6 literals and independent Python streaming pins; no Native limits/result imports.
  const original = Buffer.from("Controlled prepared document" + "x".repeat(4_194_276), "utf8");
  const sha256 = "92b6fae8c43b91f2d2112427ee14947565814730c56e11eb176c0fc73fe23b32";
  expect(original.byteLength).toBe(4_194_304); expect(Bun.SHA256.hash(original, "hex")).toBe(sha256);
  const data = original.toBase64();
  const objects = Array.from({ length: 8 }, (_, index) => ({ originalId: `text-${index + 1}`,
    format: "utf8" as const, sha256, data }));
  expect(objects.reduce((bytes, object) => bytes + Buffer.byteLength(object.data, "base64"), 0)).toBe(33_554_432);
  return { preparationId: "prepared-count-total", draftId: "draft-count-total", draftRevision: "1",
    authorityGeneration: "grant", message: "ordinary @missing-path prose", objects };
}

async function sendBudgetFrame(worker: Worker, command: BudgetCommand, expectedWireBytes: number) {
  if (!command.id) throw Error("ATTACHMENT_PUBLIC_BUDGET_CORRELATION_REQUIRED");
  // This exact command goes to send(), whose public fixture writes JSON.stringify(command) + newline.
  // Unlike request(), send() preserves this id, so the measured envelope is the actual stdin frame.
  const wireBytes = Buffer.byteLength(JSON.stringify(command) + "\n", "utf8");
  expect(wireBytes).toBe(expectedWireBytes); expect(wireBytes).toBeLessThan(50_331_648);
  worker.send(command);
  return worker.wait(frame => frame.type === "response" && frame.id === command.id);
}

async function prepareCountTotal(fixture: Awaited<ReturnType<typeof openWorker>>, draft: BudgetDraft) {
  const client = new AttachmentClient(async command => {
    if (command.type !== "attachment_prepare") throw Error("ATTACHMENT_PUBLIC_BUDGET_PREPARE_ONLY");
    expect(command.id).toHaveLength(36);
    const response = await sendBudgetFrame(fixture.worker, command, 44_740_518);
    if (!response.success) throw Error(`ATTACHMENT_PUBLIC_PREPARE_${String(response.code)}`);
    return response.data;
  }, isAttachmentReceipt);
  const receipt = await client.prepare(draft);
  expect(receipt).toMatchObject({ status: "ready", preparationId: draft.preparationId, draftId: draft.draftId,
    draftRevision: "1", authorityGeneration: "grant", binding: { sourceId: fixture.selected.sourceId,
      instanceId: fixture.selected.instanceId, nativeSessionId: fixture.selected.nativeSessionId } });
  expect(receipt.items.map(item => item.originalId)).toEqual(draft.objects.map(object => object.originalId));
  expect(receipt.items).toHaveLength(8);
  expect(new Set(receipt.items.map(item => item.preparedId)).size).toBe(8);
  for (const item of receipt.items) {
    if (item.status !== "ready") throw Error("ATTACHMENT_PUBLIC_COUNT_TOTAL_NOT_READY");
    expect(item.originalSha256).toBe("92b6fae8c43b91f2d2112427ee14947565814730c56e11eb176c0fc73fe23b32");
    expect(item.representation).toEqual({ kind: "text", text: "Controlled prepared document" + "x".repeat(51_172) });
    expect(item.preparedSha256).toBe("b5b175df454069cef4a11b866e34146af6785b651c85efaa02069c365486e9f4");
    expect(item.degradations).toEqual(["text_truncated"]);
    expect(item.preparedSha256).not.toBe(item.originalSha256);
  }
  return receipt;
}

async function expectBudgetQueryAbsent(worker: Worker, key: string) {
  expect(decodeSubmission(await worker.request({ type: "submission_query", clientSubmissionId: key })))
    .toMatchObject({ found: false, reservation: "absent", admission: "absent", terminal: false,
      operationOutcome: "unknown", inputOutcome: "unresolved", persistence: "unresolved", relations: [], nextOffset: null });
}

async function verifyCountTotalSavedParts(worker: Worker, receipt: AttachmentReceipt, result: SubmissionResult) {
  const saved = await entries(worker), history = await submissionHistory(worker);
  const links = result.relations.flatMap(relation => relation.attachments ?? []);
  expect(links).toHaveLength(8);
  expect(new Set(links.map(link => link.originalId)).size).toBe(8);
  const locators = new Set<string>();
  for (const item of receipt.items) {
    const document = savedLink(result, item.originalId, "prepared");
    expect(document.link).toMatchObject(expectedLink(receipt, item.originalId, "text"));
    expect(document.locator.kind).toBe("files");
    locators.add(`${document.entryId}:${document.locator.kind}:${document.locator.index}`);
    const matches = saved.entries.filter(entry => entry.id === document.entryId);
    expect(matches).toHaveLength(1);
    const companion = z.object({ role: z.literal("fileMention"), files: z.array(z.unknown()) }).parse(matches[0]?.message);
    const part = z.object({ path: z.string(), content: z.string(), byteSize: z.number() })
      .parse(companion.files[document.locator.index]);
    expect(part).toEqual({ path: `attachment-prepared://${document.link.preparedId}`,
      content: "Controlled prepared document" + "x".repeat(51_172), byteSize: 51_200 });
    expect(Bun.SHA256.hash(part.content, "hex"))
      .toBe("87a381e538d26bc4c3ee9ad4edb5f915b4da222bb55481af59e5ffe58c4ed4c5");
    const rows = history.filter(row => row.entryId === document.entryId);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.submission?.origin).toEqual(result.origin); expect(row.submission?.role).toBe("prepared");
      expect(row.submission?.attachments).toContainEqual(document.link);
    }
  }
  // Equal bytes/hashes do not merge eight distinct logical objects or their actual saved locations.
  expect(locators.size).toBe(8);
}

async function refuseBudgetDraft(fixture: Awaited<ReturnType<typeof openWorker>>, draft: BudgetDraft,
  wireBytes: number, queryKey: string) {
  const before = await entries(fixture.worker), effects = await fixture.effects();
  // Strings are immutable; copy every object without duplicating the 44MiB base64 strings.
  const unchangedDraft = { ...draft, objects: draft.objects.map(object => ({ ...object })) };
  const response = await sendBudgetFrame(fixture.worker,
    { ...draft, id: queryKey.padEnd(36, "0"), type: "attachment_prepare" }, wireBytes);
  expect(response).toMatchObject({ success: false, code: "ATTACHMENT_INPUT_BUDGET", error: "ATTACHMENT_INPUT_BUDGET" });
  expect(response.data).toBeUndefined();
  await expectBudgetQueryAbsent(fixture.worker, queryKey);
  expect(await entries(fixture.worker)).toEqual(before); expect(await fixture.effects()).toEqual(effects);
  expect(draft).toEqual(unchangedDraft);
  for (const object of draft.objects) {
    expect(Bun.SHA256.hash(Buffer.from(object.data, "base64"), "hex")).toBe(object.sha256);
  }
  // Public prepare rejects the whole command without a consumable receipt; no browser persistence claim.
}

async function refuseCountAndTotal(fixture: Awaited<ReturnType<typeof openWorker>>, accepted: BudgetDraft) {
  const tiny = { format: "utf8" as const, sha256: "bb7208bc9b5d7c04f1236a82a0093a5e33f40423d5ba8d4266f7092c3ba43b62",
    data: "IQ==" };
  const countDraft = { ...accepted, preparationId: "prepared-count-over", draftId: "draft-count-over",
    objects: Array.from({ length: 9 }, (_, index) => ({ ...tiny, originalId: `text-${index + 1}` })) };
  expect(countDraft.objects).toHaveLength(9);
  expect(countDraft.objects.reduce((bytes, object) => bytes + Buffer.byteLength(object.data, "base64"), 0)).toBe(9);
  await refuseBudgetDraft(fixture, countDraft, 1_414, "count-over-refused");
  const original = Buffer.from("Controlled prepared document" + "x".repeat(4_194_276) + "!", "utf8");
  expect(original.byteLength).toBe(4_194_305);
  const sha256 = "a2ff6cfe3749e48dc056fff1f4367eca40f85d2a47b0176ed92ac9db70644bb5";
  expect(Bun.SHA256.hash(original, "hex")).toBe(sha256);
  const totalDraft = { ...accepted, preparationId: "prepared-total-over", draftId: "draft-total-over",
    objects: accepted.objects.map((object, index) => index === 0 ? { ...object, sha256, data: original.toBase64() }
      : { ...object }) };
  expect(totalDraft.objects).toHaveLength(8);
  expect(totalDraft.objects.reduce((bytes, object) => bytes + Buffer.byteLength(object.data, "base64"), 0)).toBe(33_554_433);
  await refuseBudgetDraft(fixture, totalDraft, 44_740_516, "total-over-refused");
}

test("actual public eight UTF8 objects at 32MiB require consent and refuse count and total excess before effects", async () => {
  await withWorker(async fixture => {
    const { worker } = fixture, before = await entries(worker), effects = await fixture.effects();
    const draft = countTotalDraft(), receipt = await prepareCountTotal(fixture, draft);
    expect(await entries(worker)).toEqual(before); expect(await fixture.effects()).toEqual(effects);
    expect(await worker.request(submission(fixture, receipt, "count-total-success", [])))
      .toMatchObject({ success: false, code: "ATTACHMENT_DEGRADATION_CONSENT_REQUIRED",
        error: "ATTACHMENT_DEGRADATION_CONSENT_REQUIRED" });
    await expectBudgetQueryAbsent(worker, "count-total-success");
    expect(await entries(worker)).toEqual(before); expect(await fixture.effects()).toEqual(effects);
    expect(await worker.request(submission(fixture, receipt, "count-total-success", ["text_truncated"])))
      .toMatchObject({ success: true });
    const result = await terminalSubmission(worker, "count-total-success");
    const { sourceId, instanceId, nativeSessionId } = fixture.selected;
    expect(result).toMatchObject({ found: true, terminal: true, operationOutcome: "succeeded", inputOutcome: "generated",
      persistence: "committed", reservation: "committed", target: { sourceId, instanceId, nativeSessionId },
      origin: { sourceId, instanceId, nativeSessionId, clientSubmissionId: "count-total-success" },
      preparation: consent(receipt, ["text_truncated"]) });
    await verifyCountTotalSavedParts(worker, receipt, result);
    const after = await fixture.effects();
    expect(after).toMatchObject({ inputCalls: effects.inputCalls + 1, modelAttempts: effects.modelAttempts + 1,
      modelDispatches: effects.modelDispatches + 1, toolCalls: effects.toolCalls, blockedPayloads: effects.blockedPayloads });
    expect(after.requests).toHaveLength(effects.requests.length + 1);
    expect(after.requests.at(-1)?.images).toEqual([]);
    // Unchanged capture caps at two per-message 28B spans. This does not witness eight/full provider bodies.
    expect(after.requests.at(-1)?.attachmentText).toEqual(Array.from({ length: 2 }, () => ({ role: "developer",
      bytes: 28, occurrences: 1, sha256: "fd4d618665fd8dbb429346ec93e6996c7f60ce30e0cf40de732e5a1ac9ef8419" })));
    expect(decodeSubmission(await worker.request({ type: "submission_query", clientSubmissionId: "count-total-success" })))
      .toEqual(result);
    expect(await fixture.effects()).toEqual(after);
    await refuseCountAndTotal(fixture, draft);
    expect(await fixture.effects()).toEqual(after);
  });
}, 90_000);

import { opaqueWhitePngWitness, whitePngAtBytes } from "./png-literal.ts";

function imageLimitDraft(over = false): BudgetDraft {
  // Independent streamed Python SHA/CRC/envelope pins; neither Native limits nor encoder outputs are imported.
  const original = whitePngAtBytes(over ? 10_485_761 : 10_485_760);
  const sha256 = over ? "ba7976fc44daa4f000c1f7dd68d8ea6d14275fa100fc9a543b2391a58967a780"
    : "77924f168b5bef101d0ac293965b1f8a7aecaecfd1b7335bc4cac0ff812db5b1";
  expect(original.byteLength).toBe(over ? 10_485_761 : 10_485_760);
  expect(Bun.SHA256.hash(original, "hex")).toBe(sha256);
  expect(opaqueWhitePngWitness(original, 1, 1))
    .toBe("ad95131bc0b799c0b1af477fb14fcf26a6a9f76079e48bf090acb7e8367bfd0e");
  return { preparationId: over ? "prepared-image-over" : "prepared-image-limit",
    draftId: over ? "draft-image-over" : "draft-image-limit", draftRevision: "1", authorityGeneration: "grant",
    message: "ordinary @missing-path prose", objects: [{ originalId: "image", format: "png", sha256,
      data: original.toBase64() }] };
}

async function prepareImageLimit(fixture: Awaited<ReturnType<typeof openWorker>>, draft: BudgetDraft) {
  const client = new AttachmentClient(async command => {
    if (command.type !== "attachment_prepare") throw Error("ATTACHMENT_PUBLIC_IMAGE_LIMIT_PREPARE_ONLY");
    expect(command.id).toHaveLength(36);
    const response = await sendBudgetFrame(fixture.worker, command, 13_981_386);
    if (!response.success) throw Error(`ATTACHMENT_PUBLIC_PREPARE_${String(response.code)}`);
    return response.data;
  }, isAttachmentReceipt);
  const receipt = await client.prepare(draft);
  expect(receipt).toMatchObject({ status: "ready", preparationId: draft.preparationId, draftId: draft.draftId,
    draftRevision: "1", authorityGeneration: "grant", binding: { sourceId: fixture.selected.sourceId,
      instanceId: fixture.selected.instanceId, nativeSessionId: fixture.selected.nativeSessionId } });
  expect(receipt.items).toHaveLength(1);
  const item = receipt.items[0], prepared = preparedImage(receipt);
  if (!item || item.status !== "ready") throw Error("ATTACHMENT_PUBLIC_IMAGE_LIMIT_NOT_READY");
  expect(item.originalId).toBe("image");
  expect(item.originalSha256).toBe("77924f168b5bef101d0ac293965b1f8a7aecaecfd1b7335bc4cac0ff812db5b1");
  expect(item.degradations).toEqual(["image_transformed"]);
  expect({ kind: prepared.kind, mimeType: prepared.mimeType, width: prepared.width, height: prepared.height })
    .toEqual({ kind: "image", mimeType: "image/png", width: 200, height: 200 });
  // Same decoded 1x1 white pixel and resize path as historical PNG proof; no new encoder hash is invented.
  const bytes = Buffer.from(prepared.data, "base64");
  expect(bytes.byteLength).toBe(590);
  expect(item.preparedSha256).toBe("d39598a3d443533997fb6f9bdb856a1f7d05912f78753c9653391dae5b8942ff");
  expect(Bun.SHA256.hash(JSON.stringify({ kind: "image", mimeType: prepared.mimeType, data: prepared.data,
    width: prepared.width, height: prepared.height }), "hex")).toBe(item.preparedSha256);
  expect(item.preparedSha256).not.toBe(item.originalSha256);
  expect(opaqueWhitePngWitness(bytes, 200, 200))
    .toBe("cdbf6c0880cfbeebfa8480444fef83685e70091bf1f23a5e8a71564d1f8be33a");
  expect(item.facts).toEqual({ originalBytes: 10_485_760, preparedBytes: 590,
    sourceWidth: 1, sourceHeight: 1, frames: 1, decodedBytes: 4 });
  return receipt;
}

async function refuseImageOneByteOver(fixture: Awaited<ReturnType<typeof openWorker>>) {
  const draft = imageLimitDraft(true), before = await entries(fixture.worker), effects = await fixture.effects();
  const unchanged = { ...draft, objects: draft.objects.map(object => ({ ...object })) };
  expect(draft.objects).toHaveLength(1);
  const rawTotal = draft.objects.reduce((count, object) => count + Buffer.byteLength(object.data, "base64"), 0);
  expect(rawTotal).toBe(10_485_761); expect(rawTotal).toBeLessThan(33_554_432);
  const response = await sendBudgetFrame(fixture.worker,
    { ...draft, id: "image-over-refused".padEnd(36, "0"), type: "attachment_prepare" }, 13_981_384);
  expect(response.success).toBe(true); expect(isAttachmentReceipt(response.data)).toBe(true);
  if (!isAttachmentReceipt(response.data)) throw Error("ATTACHMENT_PUBLIC_IMAGE_OVER_RECEIPT_MISSING");
  const receipt = response.data;
  // The per-image raw budget must fail explicitly before isolated conversion, separately from count/total/RPC.
  expect(receipt).toMatchObject({ status: "failed", preparationId: draft.preparationId, draftId: draft.draftId,
    draftRevision: "1", authorityGeneration: "grant", binding: { sourceId: fixture.selected.sourceId,
      instanceId: fixture.selected.instanceId, nativeSessionId: fixture.selected.nativeSessionId } });
  expect(receipt.items).toHaveLength(1);
  expect(receipt.items[0]).toMatchObject({ status: "failed", originalId: "image",
    originalSha256: "ba7976fc44daa4f000c1f7dd68d8ea6d14275fa100fc9a543b2391a58967a780",
    preparedSha256: "", code: "attachment_original_budget" });
  expect(await fixture.worker.request(submission(fixture, receipt, "image-over-refused", [])))
    .toMatchObject({ success: false, code: "ATTACHMENT_NOT_READY", error: "ATTACHMENT_NOT_READY" });
  await expectBudgetQueryAbsent(fixture.worker, "image-over-refused");
  expect(await entries(fixture.worker)).toEqual(before); expect(await fixture.effects()).toEqual(effects);
  expect(draft).toEqual(unchanged);
  for (const object of draft.objects) {
    expect(Bun.SHA256.hash(Buffer.from(object.data, "base64"), "hex")).toBe(object.sha256);
  }
  expect(await fixture.client.cancel(receipt.preparationId)).toEqual({ cancelled: true });
}

test("actual public 10MiB PNG requires transformation consent and reports original budget for one byte over", async () => {
  await withWorker(async fixture => {
    const { worker } = fixture, before = await entries(worker), effects = await fixture.effects();
    const receipt = await prepareImageLimit(fixture, imageLimitDraft()), prepared = preparedImage(receipt);
    expect(await entries(worker)).toEqual(before); expect(await fixture.effects()).toEqual(effects);
    expect(await worker.request(submission(fixture, receipt, "image-limit-success", [])))
      .toMatchObject({ success: false, code: "ATTACHMENT_DEGRADATION_CONSENT_REQUIRED",
        error: "ATTACHMENT_DEGRADATION_CONSENT_REQUIRED" });
    await expectBudgetQueryAbsent(worker, "image-limit-success");
    expect(await entries(worker)).toEqual(before); expect(await fixture.effects()).toEqual(effects);
    expect(await worker.request(submission(fixture, receipt, "image-limit-success", ["image_transformed"])))
      .toMatchObject({ success: true });
    const result = await terminalSubmission(worker, "image-limit-success");
    const { sourceId, instanceId, nativeSessionId } = fixture.selected;
    expect(result).toMatchObject({ found: true, terminal: true, operationOutcome: "succeeded", inputOutcome: "generated",
      persistence: "committed", reservation: "committed", target: { sourceId, instanceId, nativeSessionId },
      origin: { sourceId, instanceId, nativeSessionId, clientSubmissionId: "image-limit-success" },
      preparation: consent(receipt, ["image_transformed"]) });
    // Public relation.entryId + actual content index give causality; verifyWebpSavedPart is format-neutral.
    await verifyWebpSavedPart(worker, receipt, result);
    expect(result.relations.flatMap(relation => relation.attachments ?? [])).toHaveLength(1);
    const after = await fixture.effects();
    expect(after).toMatchObject({ inputCalls: effects.inputCalls + 1, modelAttempts: effects.modelAttempts + 1,
      modelDispatches: effects.modelDispatches + 1, toolCalls: effects.toolCalls, blockedPayloads: effects.blockedPayloads });
    expect(after.requests).toHaveLength(effects.requests.length + 1);
    // Known image representation + independently decoded white pixels above; byte SHA here is delivery consistency.
    expect(after.requests.at(-1)?.images).toEqual([{ mimeType: "image/png", bytes: 590,
      sha256: Bun.SHA256.hash(Buffer.from(prepared.data, "base64"), "hex") }]);
    expect(after.requests.at(-1)?.attachmentText).toEqual([]);
    expect(decodeSubmission(await worker.request({ type: "submission_query", clientSubmissionId: "image-limit-success" })))
      .toEqual(result);
    expect(await fixture.effects()).toEqual(after);
    await refuseImageOneByteOver(fixture);
    expect(await fixture.effects()).toEqual(after);
  }, "image-original-budget-v2");
}, 90_000);
