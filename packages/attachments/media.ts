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
