import { expect, test } from "bun:test";
import { attachmentFormat, documentOriginalBytes, imageOriginalBytes, originalMediaTypes } from "../../packages/attachments/media.ts";
import { imageLimits } from "../../apps/chat/src/images.ts";
import { attachmentLimits, attachmentName, classifyAttachment, draftBudgetFailure } from "../../apps/chat/src/attachments.ts";

const text = (value: string) => new TextEncoder().encode(value);
const zip = [0x50, 0x4b, 0x03, 0x04];
const pdf = [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37];
const bytes = (...parts: (number[] | string)[]) => Uint8Array.from(parts.flatMap(part => typeof part === "string" ? [...text(part)] : part));
const draft = (mediaType: Parameters<typeof draftBudgetFailure>[0][number]["mediaType"], byteLength = 1, pixels = 0) =>
  ({ mediaType, byteLength, pixels });

test("every admitted original has a native attachment format", () => {
  expect(Object.fromEntries(originalMediaTypes.map(type => [type, attachmentFormat(type)]))).toEqual({
    "image/png": "png", "image/jpeg": "jpeg", "image/webp": "webp", "image/gif": "gif", "text/plain": "utf8",
    "application/pdf": "pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx", "application/epub+zip": "epub" });
});

test("content decides the format before any declared name or type", () => {
  expect(classifyAttachment(bytes(pdf), { name: "notes.txt", type: "text/plain" })).toBe("application/pdf");
  expect(classifyAttachment(bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), { name: "notes.txt", type: "text/plain" }))
    .toBe("image/png");
});

test("ZIP containers resolve their declared subtype but never invent one", () => {
  expect(classifyAttachment(bytes(zip), { name: "Report.DOCX", type: "application/octet-stream" }))
    .toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  expect(classifyAttachment(bytes(zip), { name: "slides", type: "application/vnd.openxmlformats-officedocument.presentationml.presentation" }))
    .toBe("application/vnd.openxmlformats-officedocument.presentationml.presentation");
  expect(classifyAttachment(bytes(zip), { name: "book.EPUB" })).toBe("application/epub+zip");
  expect(() => classifyAttachment(bytes(zip), { name: "archive.zip", type: "application/zip" }))
    .toThrow("ZIP archive");
});

test("UTF-8 source is text and invalid or binary bytes are refused", () => {
  expect(classifyAttachment(text("const answer = 42;\n"))).toBe("text/plain");
  expect(() => classifyAttachment(Uint8Array.from([0xc3, 0x28]))).toThrow("UTF-8");
  expect(() => classifyAttachment(Uint8Array.from([0x41, 0x00, 0x42]))).toThrow("binary");
  expect(() => classifyAttachment(Uint8Array.from([0xff, 0xfe, 0x00]))).toThrow("UTF-8");
});

test("display names cannot carry paths, controls, or an empty identity", () => {
  expect(attachmentName("../../etc/passwd")).toBe("..-..-etc-passwd");
  expect(attachmentName("a/b\\c\u0000d\ne")).toBe("a-b-c d e");
  expect(attachmentName("   ")).toBe("attachment");
  expect(attachmentName("x".repeat(300))).toHaveLength(255);
});

test("shared budgets mirror the native refusal ceilings", () => {
  expect(attachmentLimits.objects).toBe(8);
  expect(attachmentLimits.draftBytes).toBe(32 * 1024 ** 2);
  expect(draftBudgetFailure([], draft("text/plain", documentOriginalBytes))).toBeUndefined();
  expect(draftBudgetFailure([], draft("text/plain", documentOriginalBytes + 1))).toBe("bytes");
  expect(draftBudgetFailure([], draft("application/pdf", documentOriginalBytes + 1))).toBe("bytes");
  expect(draftBudgetFailure([], draft("image/png", imageOriginalBytes + 1))).toBe("bytes");
  expect(draftBudgetFailure([], draft("image/png", imageOriginalBytes))).toBeUndefined();
  expect(draftBudgetFailure(Array.from({ length: 8 }, () => draft("text/plain")), draft("text/plain"))).toBe("objects");
  expect(draftBudgetFailure(Array.from({ length: 6 }, () => draft("text/plain", documentOriginalBytes)), draft("text/plain", 3 * 1024 ** 2)))
    .toBe("bytes");
  expect(draftBudgetFailure([], draft("image/png", 1, imageLimits.draftPixels + 1))).toBe("pixels");
  expect(draftBudgetFailure([draft("image/png", 1, imageLimits.draftPixels)], draft("image/png", 1, 1))).toBe("pixels");
});
