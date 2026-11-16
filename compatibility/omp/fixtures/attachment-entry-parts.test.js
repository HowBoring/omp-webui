import { expect, test } from "bun:test";
import { type } from "../../../vendor/omp/packages/omptype/src/index";
import { locatePreparedEntryParts, stagePreparedEntryPart } from "../../../vendor/omp/packages/coding-agent/src/attachments/entry-parts";
import { attachmentDefs } from "../../../vendor/omp/packages/coding-agent/src/modes/rpc/wire/attachments";
import { validPreparedLinks, validNativePreparation } from "../../../vendor/omp/packages/coding-agent/src/attachments/validation";

const origin = { sourceId: "a".repeat(64), instanceId: "b".repeat(64), nativeSessionId: "synthetic", clientSubmissionId: "attempt" };
const link = { originalId: "image", preparedId: "prepared-image", originalSha256: "c".repeat(64),
  preparedSha256: "d".repeat(64), representationKind: "image" };

test("native persisted slots follow the actual surviving object, never equal bytes or a planned offset", () => {
  const image = { type: "image", data: "prepared", mimeType: "image/png" };
  stagePreparedEntryPart(image, link);
  const cause = { origin, role: "input", attachments: [link] };
  expect(locatePreparedEntryParts(cause, { content: [{ type: "text", text: "prose" }, { ...image }, image] }).attachments)
    .toEqual([{ ...link, entryPart: { kind: "content", index: 2 } }]);
  expect(locatePreparedEntryParts(cause, { content: [{ ...image }] }).attachments)
    .toEqual([{ ...link, entryPartUnavailable: "missing" }]);
});

test("changed, duplicated or removed native parts cannot retain a planned slot", () => {
  const image = { type: "image", data: "prepared", mimeType: "image/png" };
  stagePreparedEntryPart(image, link);
  const cause = { origin, role: "input", attachments: [{ ...link, entryPart: { kind: "content", index: 7 } }] };
  expect(locatePreparedEntryParts(cause, { content: [image, image] }).attachments)
    .toEqual([{ ...link, entryPartUnavailable: "ambiguous" }]);
  image.data = "modified";
  expect(locatePreparedEntryParts(cause, { content: [image] }).attachments)
    .toEqual([{ ...link, entryPartUnavailable: "changed" }]);
  expect(locatePreparedEntryParts(cause, { content: [] }).attachments)
    .toEqual([{ ...link, entryPartUnavailable: "missing" }]);
});

test("a converted document locator addresses its exact native files occurrence", () => {
  const document = { path: "attachment-prepared://prepared-document", content: "converted exact text" };
  const documentLink = { ...link, preparedId: "prepared-document", representationKind: "text" };
  stagePreparedEntryPart(document, documentLink);
  const cause = { origin, role: "prepared", attachments: [documentLink] };
  expect(locatePreparedEntryParts(cause, { files: [{ ...document }, document] }).attachments)
    .toEqual([{ ...documentLink, entryPart: { kind: "files", index: 1 } }]);
});

test("persisted locators are bounded and cannot be mixed with an unavailable marker", () => {
  expect(validPreparedLinks([{ ...link, entryPart: { kind: "content", index: 2 } }])).toBe(true);
  expect(validPreparedLinks([{ ...link, entryPart: { kind: "content", index: 65_536 } }])).toBe(false);
  expect(validPreparedLinks([{ ...link, entryPart: { kind: "content", index: 0 }, entryPartUnavailable: "missing" }])).toBe(false);
  expect(validNativePreparation({ receiptId: "receipt", resultDigest: "e".repeat(64), draftRevision: "revision", authorityGeneration: "grant",
    acceptedDegradations: [], attachments: [{ ...link, entryPart: { kind: "content", index: 0 } }] })).toBe(false);
});

test("the authored public wire rejects locator indices outside the native persisted-body bound", () => {
  const part = type(attachmentDefs.PreparedEntryPart);
  expect(part.allows({ kind: "content", index: 0 })).toBe(true);
  expect(part.allows({ kind: "files", index: 65_535 })).toBe(true);
  expect(part.allows({ kind: "content", index: -1 })).toBe(false);
  expect(part.allows({ kind: "files", index: 65_536 })).toBe(false);
  expect(part.allows({ kind: "files", index: 0.5 })).toBe(false);
  expect(part.toJsonSchema()).toMatchObject({ properties: { index: { type: "integer", minimum: 0, maximum: 65_535 } } });
});

test("malformed persisted omission markers fail validation without coercing attacker-controlled fields", () => {
  expect(validPreparedLinks([{ ...link, entryPartUnavailable: { toString: "missing" } }])).toBe(false);
  expect(validPreparedLinks([{ ...link, entryPartUnavailable: { toString() { return "missing"; } } }])).toBe(false);
});
