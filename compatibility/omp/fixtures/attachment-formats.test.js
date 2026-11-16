import { expect, test } from "bun:test";
import { prepareAttachment } from "../../../vendor/omp/packages/coding-agent/src/attachments/prepare";
import { encodeRawPng } from "../../../vendor/omp/packages/coding-agent/src/utils/png-encode";
import { encodeArchive } from "../../../vendor/omp/packages/utils/src/ar/write";

test("JPEG and WebP use actual decoding and WebP normalization is disclosed before consumption", async () => {
  const png = encodeRawPng(new Uint8Array(200 * 200 * 4).fill(255), 200, 200, 4);
  const jpeg = await new Bun.Image(png).jpeg().bytes();
  const webp = await new Bun.Image(png).webp().bytes();
  const jpegResult = await prepareAttachment({ format: "jpeg", bytes: jpeg });
  expect(jpegResult).toMatchObject({ status: "ready", representation: { mimeType: "image/jpeg", data: jpeg.toBase64() }, degradations: [] });
  const webpResult = await prepareAttachment({ format: "webp", bytes: webp });
  expect(webpResult.status).toBe("ready");
  expect(webpResult.representation.mimeType).not.toBe("image/webp");
  expect(webpResult.degradations).toContain("image_transformed");
  expect(await prepareAttachment({ format: "png", bytes: jpeg })).toEqual({ status: "failed", code: "attachment_format_mismatch" });
  expect(await prepareAttachment({ format: "jpeg", bytes: jpeg.subarray(0, jpeg.length - 2) }))
    .toEqual({ status: "failed", code: "attachment_invalid_image" });
});

test("decoded PNG size is refused before its compressed stream can allocate pixels", async () => {
  const bytes = encodeRawPng(new Uint8Array(4).fill(255), 1, 1, 4);
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(16, 100_000);
  expect(await prepareAttachment({ format: "png", bytes })).toEqual({ status: "failed", code: "attachment_decoded_budget" });
});

const contentTypes = format => `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/${format === 'pptx' ? 'ppt/presentation.xml' : 'xl/workbook.xml'}" ContentType="application/vnd.openxmlformats-officedocument.${format === 'pptx' ? 'presentationml.presentation' : 'spreadsheetml.sheet'}.main+xml"/></Types>`;
const packages = {
  pptx: [
    ["[Content_Types].xml", contentTypes("pptx")],
    ["ppt/presentation.xml", '<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>'],
    ["ppt/slides/slide1.xml", '<p:sld><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Selected slide text</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>'],
  ],
  xlsx: [
    ["[Content_Types].xml", contentTypes("xlsx")],
    ["xl/workbook.xml", '<workbook><sheets><sheet name="Selected sheet" r:id="sheet1"/></sheets></workbook>'],
    ["xl/_rels/workbook.xml.rels", '<Relationships><Relationship Id="sheet1" Target="worksheets/sheet1.xml"/></Relationships>'],
    ["xl/worksheets/sheet1.xml", '<worksheet><sheetData><row><c t="inlineStr"><is><t>Selected cell text</t></is></c></row></sheetData></worksheet>'],
  ],
  epub: [
    ["mimetype", "application/epub+zip"],
    ["META-INF/container.xml", '<container><rootfiles><rootfile full-path="content.opf"/></rootfiles></container>'],
    ["content.opf", '<package><manifest><item id="chapter" href="chapter.html"/></manifest><spine><itemref idref="chapter"/></spine></package>'],
    ["chapter.html", "<html><body><p>Selected chapter text</p></body></html>"],
  ],
};
for (const [format, members] of Object.entries(packages)) test(`${format} uses its native converter with explicit structure degradation`, async () => {
  const result = await prepareAttachment({ format, bytes: await encodeArchive("zip", members) });
  expect(result.status).toBe("ready");
  expect(result.degradations).toContain("document_structure_changed");
  expect(result.representation.text).toContain({ pptx: "Selected slide text", xlsx: "Selected cell text", epub: "Selected chapter text" }[format]);
});

function pdfDocument(text) {
  const stream = `BT /F1 12 Tf 20 100 Td (${text}) Tj ET`;
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  let result = "%PDF-1.4\n";
  const offsets = [];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(Buffer.byteLength(result)); result += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(result);
  result += `xref\n0 6\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}`;
  result += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(result);
}

test("PDF uses the actual native converter and reports missing extractable text structurally", async () => {
  const result = await prepareAttachment({ format: "pdf", bytes: pdfDocument("Selected PDF text") });
  expect(result.status).toBe("ready");
  expect(result.representation.text).toContain("Selected PDF text");
  expect(result.degradations).toContain("document_structure_changed");
  const empty = await prepareAttachment({ format: "pdf", bytes: pdfDocument("") });
  expect(empty.status).toBe("ready");
  expect(empty.degradations).toContain("pdf_ocr_required");
  expect(empty.degradations).toContain("document_no_extractable_text");
});
