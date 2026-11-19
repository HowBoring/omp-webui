/** Synthetic fixture authoring only. Host runtime never imports native converter/Session internals. */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { encodeArchive } from "../../../vendor/omp/packages/utils/src/ar/write";
import { encodeRawPng } from "../../../vendor/omp/packages/coding-agent/src/utils/png-encode";
const text = (value: string): Uint8Array => new TextEncoder().encode(value);
const officeType = (part: string, type: string): string =>
  `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/${part}" ContentType="application/vnd.openxmlformats-officedocument.${type}.main+xml"/></Types>`;
function pdf(textValue: string): Uint8Array {
  const stream = `BT /F1 12 Tf 20 100 Td (${textValue}) Tj ET`;
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  let result = "%PDF-1.4\n"; const offsets: number[] = [];
  for (let i = 0; i < objects.length; i++) { offsets.push(Buffer.byteLength(result)); result += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`; }
  const xref = Buffer.byteLength(result);
  result += `xref\n0 6\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}`;
  return text(`${result}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
}
async function originals(): Promise<Record<string, Uint8Array>> {
  const png = encodeRawPng(new Uint8Array(200 * 200 * 4).fill(255), 200, 200, 4);
  return { png, jpeg: await new Bun.Image(png).jpeg().bytes(), webp: await new Bun.Image(png).webp().bytes(),
    gif: Buffer.from("47494638396101000100800000000000ffffff" +
      "21f90400000000002c0000000001000100000202440100" + "21f90400010000002c00000000010001000002024c01003b", "hex"),
    utf8: text("Selected UTF-8 attachment content"), pdf: pdf("Selected PDF attachment content"),
    docx: await encodeArchive("zip", [
      ["[Content_Types].xml", officeType("word/document.xml", "wordprocessingml.document")],
      ["word/document.xml", '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Selected DOCX attachment content</w:t></w:r></w:p></w:body></w:document>'],
    ]),
    pptx: await encodeArchive("zip", [
      ["[Content_Types].xml", officeType("ppt/presentation.xml", "presentationml.presentation")],
      ["ppt/presentation.xml", '<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>'],
      ["ppt/slides/slide1.xml", '<p:sld><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Selected PPTX attachment content</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>'],
    ]),
    xlsx: await encodeArchive("zip", [
      ["[Content_Types].xml", officeType("xl/workbook.xml", "spreadsheetml.sheet")],
      ["xl/workbook.xml", '<workbook><sheets><sheet name="Selected sheet" r:id="sheet1"/></sheets></workbook>'],
      ["xl/_rels/workbook.xml.rels", '<Relationships><Relationship Id="sheet1" Target="worksheets/sheet1.xml"/></Relationships>'],
      ["xl/worksheets/sheet1.xml", '<worksheet><sheetData><row><c t="inlineStr"><is><t>Selected XLSX attachment content</t></is></c></row></sheetData></worksheet>'],
    ]),
    epub: await encodeArchive("zip", [
      ["mimetype", "application/epub+zip"],
      ["META-INF/container.xml", '<container><rootfiles><rootfile full-path="content.opf"/></rootfiles></container>'],
      ["content.opf", '<package><manifest><item id="chapter" href="chapter.html"/></manifest><spine><itemref idref="chapter"/></spine></package>'],
      ["chapter.html", '<html><body><p>Selected EPUB attachment content</p></body></html>'],
    ]),
    "broken-utf8": new Uint8Array([0xc3, 0x28]), "long-utf8": text("界".repeat(20_000)),
  };
}
const home = process.env.HOME;
if (!home?.includes("attachment-") || process.env.OMP_HISTORY_FIXTURE_PROFILE !== home) throw Error("SYNTHETIC_ATTACHMENT_AUTHORING_PROFILE_REQUIRED");
if (!Reflect.get(globalThis, Symbol.for("omp.s0.network-guard"))) throw Error("PREIMPORT_EGRESS_GUARD_REQUIRED");
await fs.mkdir(path.join(home, "originals"), { recursive: true, mode: 0o700 });
const metadata = [];
for (const [id, bytes] of Object.entries(await originals())) {
  await fs.writeFile(path.join(home, "originals", id), bytes, { mode: 0o600 });
  metadata.push({ id, sha256: Bun.SHA256.hash(bytes, "hex"), bytes: bytes.length });
}
await fs.writeFile(path.join(home, "originals.json"), JSON.stringify(metadata), { mode: 0o600 });
