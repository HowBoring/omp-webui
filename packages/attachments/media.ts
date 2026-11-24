import type { AttachmentFormat } from "../contracts/generated/omp-wire.ts";
const imageMediaTypes = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
export const originalMediaTypes = [...imageMediaTypes, "text/plain", "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/epub+zip"] as const;

export type ImageMediaType = (typeof imageMediaTypes)[number];
export type OriginalMediaType = (typeof originalMediaTypes)[number];

export const imageOriginalBytes = 10 * 1024 ** 2;
export const documentOriginalBytes = 5 * 1024 ** 2;

export function isOriginalMediaType(value: unknown): value is OriginalMediaType {
  return originalMediaTypes.some(type => type === value);
}


const attachmentFormats: Record<OriginalMediaType, AttachmentFormat> = {
  "image/png": "png", "image/jpeg": "jpeg", "image/webp": "webp", "image/gif": "gif",
  "text/plain": "utf8", "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/epub+zip": "epub",
};

/** Native converter identity for an admitted original; content validation remains Native's job. */
export function attachmentFormat(mediaType: OriginalMediaType): AttachmentFormat { return attachmentFormats[mediaType]; }

const ascii = (bytes: Uint8Array, start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));

/** Content decides the format; a file name or declared MIME type never does. */
export function sniffImage(bytes: Uint8Array): ImageMediaType | undefined {
  if (bytes.length >= 8 && bytes[0] === 0x89 && ascii(bytes, 1, 4) === "PNG" && bytes[4] === 0x0d && bytes[5] === 0x0a
    && bytes[6] === 0x1a && bytes[7] === 0x0a) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 6 && (ascii(bytes, 0, 6) === "GIF87a" || ascii(bytes, 0, 6) === "GIF89a")) return "image/gif";
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") return "image/webp";
  return undefined;
}

export function isImageMediaType(value: unknown): value is ImageMediaType {
  return imageMediaTypes.some(type => type === value);
}

/** Pixel dimensions from bounded header parsing; the Store already validated the signature. */
export function imageDimensions(bytes: Uint8Array, kind: ImageMediaType): { width: number; height: number } | undefined {
  if (bytes.length < 30) return;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (kind === "image/png") return { width: view.getUint32(16), height: view.getUint32(20) };
  if (kind === "image/gif") return { width: view.getUint16(6, true), height: view.getUint16(8, true) };
  if (kind === "image/jpeg") {
    for (let offset = 2; offset + 9 < bytes.length;) {
      if (view.getUint8(offset) !== 0xff) { offset++; continue; }
      const marker = view.getUint8(offset + 1);
      if (marker === 0xff) { offset++; continue; }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue; }
      const size = view.getUint16(offset + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: view.getUint16(offset + 5), width: view.getUint16(offset + 7) };
      }
      if (size < 2) return;
      offset += 2 + size;
    }
    return;
  }
  const fourcc = ascii(bytes, 12, 16);
  if (fourcc === "VP8 " && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
    return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
  }
  if (fourcc === "VP8L" && bytes[20] === 0x2f) {
    const bits = view.getUint32(21, true);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (fourcc === "VP8X") {
    return { width: 1 + (bytes[24]! | bytes[25]! << 8 | bytes[26]! << 16),
      height: 1 + (bytes[27]! | bytes[28]! << 8 | bytes[29]! << 16) };
  }
}
