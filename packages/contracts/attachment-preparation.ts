import validateReceipt from "./generated/attachment-receipt.js";
import type { AttachmentReceipt } from "./generated/omp-wire.ts";
export { AttachmentClient } from "./generated/attachment-client.ts";
export type { AttachmentCommand } from "./generated/attachment-client.ts";
export type { AttachmentReceipt, AttachmentConsent, AttachmentFormat, AttachmentItem } from "./generated/omp-wire.ts";

/** Schema validation is complemented by the same-source public client's version, order and representation digest checks. */
export function isAttachmentReceipt(value: unknown): value is AttachmentReceipt { return validateReceipt(value); }
