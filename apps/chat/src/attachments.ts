/** Browser-side attachment intake: content classification, safe display names, and the shared draft budget. */
import { documentOriginalBytes, imageOriginalBytes, type OriginalMediaType } from "../../../packages/attachments/media.ts";
import { imageLimits, sniffImage } from "./images.ts";

export const attachmentLimits = { objects: 8, draftBytes: 32 * 1024 ** 2,
  imageBytes: imageOriginalBytes, documentBytes: documentOriginalBytes } as const;

export type DraftAttachment = { readonly mediaType: OriginalMediaType; readonly byteLength: number; readonly pixels?: number | undefined };
export type DraftBudgetFailure = "objects" | "bytes" | "pixels";

const starts = (bytes: Uint8Array, prefix: readonly number[]) => prefix.every((value, index) => bytes[index] === value);
const textDecoder = new TextDecoder("utf-8", { fatal: true });
const containerTypes: Record<string, OriginalMediaType> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  epub: "application/epub+zip",
};

/** Bytes establish image/PDF/document containers; the declared Office/EPUB subtype is validated by Native conversion. */
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

/** Client-side mirror of the native original ceilings; the Host and Native remain the authority on every byte. */
export function draftBudgetFailure(current: readonly DraftAttachment[], next: DraftAttachment): DraftBudgetFailure | undefined {
  if (current.length >= attachmentLimits.objects) return "objects";
  const ceiling = next.mediaType.startsWith("image/") ? attachmentLimits.imageBytes : attachmentLimits.documentBytes;
  if (next.byteLength > ceiling) return "bytes";
  if (current.reduce((sum, item) => sum + item.byteLength, 0) + next.byteLength > attachmentLimits.draftBytes) return "bytes";
  const pixels = current.reduce((sum, item) => sum + (item.pixels ?? 0), 0) + (next.pixels ?? 0);
  return pixels > imageLimits.draftPixels ? "pixels" : undefined;
}

