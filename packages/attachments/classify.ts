/** Shared browser/Host intake classification: content establishes the format, never a display name. */
import { documentOriginalBytes, imageOriginalBytes, sniffImage, type OriginalMediaType } from "./media.ts";

export const attachmentLimits = { objects: 8, draftBytes: 32 * 1024 ** 2,
  imageBytes: imageOriginalBytes, documentBytes: documentOriginalBytes } as const;

const starts = (bytes: Uint8Array, prefix: readonly number[]) => prefix.every((value, index) => bytes[index] === value);
const textDecoder = new TextDecoder("utf-8", { fatal: true });
const containerTypes: Record<string, OriginalMediaType> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  epub: "application/epub+zip",
};

/** Image/PDF/document containers come from bytes; the declared Office/EPUB subtype still needs Native conversion. */
export function classifyAttachment(bytes: Uint8Array, declared: { name?: string; type?: string } = {}): OriginalMediaType {
  const image = sniffImage(bytes);
  if (image) return image;
  if (starts(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf";
  if (starts(bytes, [0x50, 0x4b, 0x03, 0x04])) {
    const extension = /\.([a-z0-9]+)$/i.exec(declared.name ?? "")?.[1]?.toLowerCase();
    const mime = declared.type?.split(";", 1)[0]?.trim().toLowerCase();
    const subtype = (extension && containerTypes[extension]) ||
      Object.values(containerTypes).find(type => type === mime);
    if (!subtype) throw new Error("The file is a ZIP archive, not a supported DOCX, PPTX, XLSX, or EPUB document.");
    return subtype;
  }
  let decoded: string;
  try { decoded = textDecoder.decode(bytes); }
  catch { throw new Error("The file is not valid UTF-8 text or a supported PDF, Office, or EPUB document."); }
  if (decoded.includes("\u0000")) throw new Error("The file is binary, not UTF-8 text or a supported document.");
  return "text/plain";
}

/** Display-only identity: never a path, instruction, or control sequence; the Store still owns opaque object IDs. */
export function attachmentName(name: string): string {
  const cleaned = name.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/[\\/]+/g, "-").trim();
  return (cleaned || "attachment").slice(0, 255);
}
