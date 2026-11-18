const attachmentErrors = [
  "association_conflict",
  "association_evidence_invalid",
  "authority_unavailable",
  "binding_changed",
  "canceled",
  "deletion_confirmation_required",
  "draft_budget",
  "intake_active",
  "intake_budget",
  "intake_failed",
  "invalid_base64",
  "invalid_descriptor",
  "invalid_limits",
  "invalid_target",
  "invalid_utf8",
  "limits_changed",
  "media_mismatch",
  "object_budget",
  "object_unavailable",
  "original_corrupt",
  "original_protected",
  "original_unavailable",
  "size_mismatch",
  "storage_unavailable",
  "store_closed",
  "store_full",
  "unaccounted_data",
  "unsafe_store",
] as const;

export type AttachmentErrorName = (typeof attachmentErrors)[number];
export const attachmentErrorCodes = attachmentErrors.map(name => `attachment_${name}` as const);
type AttachmentErrorCode = (typeof attachmentErrorCodes)[number];
const knownCodes = new Set<string>(attachmentErrorCodes);

export function isAttachmentError(error: unknown): error is Error & { message: AttachmentErrorCode } {
  return error instanceof Error && knownCodes.has(error.message);
}
