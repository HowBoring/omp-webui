import { expect, test } from "bun:test";
import { prepareAttachment } from "../../../vendor/omp/packages/coding-agent/src/attachments/prepare";
import { encodeRawPng } from "../../../vendor/omp/packages/coding-agent/src/utils/png-encode";
import { encodeArchive } from "../../../vendor/omp/packages/utils/src/ar/write";

test("UTF-8 preparation rejects invalid bytes rather than supplying replacement text", async () => {
  const result = await prepareAttachment({ format: "utf8", bytes: new Uint8Array([0xc3, 0x28]) });
  expect(result).toEqual({ status: "failed", code: "attachment_invalid_utf8" });
});

test("PNG preparation validates actual pixels and returns unchanged compliant bytes", async () => {
  const bytes = encodeRawPng(new Uint8Array(200 * 200 * 4).fill(255), 200, 200, 4);
  const result = await prepareAttachment({ format: "png", bytes });
  expect(result.status).toBe("ready");
  expect(result.representation).toEqual({ kind: "image", mimeType: "image/png", data: bytes.toBase64(), width: 200, height: 200 });
  expect(result.degradations).toEqual([]);
});

test("long first UTF-8 line is explicitly degraded to the native inline budget", async () => {
  const result = await prepareAttachment({ format: "utf8", bytes: new TextEncoder().encode("界".repeat(20_000)) });
  expect(result.status).toBe("ready");
  expect(result.degradations).toEqual(["text_truncated"]);
  expect(Buffer.byteLength(result.representation.text)).toBe(51_198);
  expect(result.representation.text.endsWith("界")).toBe(true);
});

test("raw document ceiling refuses before truncation can conceal an oversized original", async () => {
  expect(await prepareAttachment({ format: "utf8", bytes: new Uint8Array(5 * 1024 * 1024 + 1).fill(65) }))
    .toEqual({ status: "failed", code: "attachment_original_budget" });
});

test("DOCX preparation uses the native converter and discloses structural conversion loss", async () => {
  const bytes = await encodeArchive("zip", [
    ["[Content_Types].xml", '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'],
    ["word/document.xml", '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Native document text</w:t></w:r></w:p></w:body></w:document>'],
  ]);
  const result = await prepareAttachment({ format: "docx", bytes });
  expect(result.status).toBe("ready");
  expect(result.representation).toEqual({ kind: "text", text: "Native document text" });
  expect(result.degradations).toContain("document_structure_changed");
});

test("animated GIF preparation explicitly reports first-frame loss", async () => {
  const bytes = Buffer.from("47494638396101000100800000000000ffffff" +
    "21f90400000000002c0000000001000100000202440100" +
    "21f90400010000002c00000000010001000002024c01003b", "hex");
  const result = await prepareAttachment({ format: "gif", bytes });
  expect(result.status).toBe("ready");
  expect(result.degradations).toContain("animation_first_frame_only");
  expect(result.representation.mimeType).toBe("image/png");
});
