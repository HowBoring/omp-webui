export const attachmentErrorCodePattern = /^attachment_[a-z0-9_]+$/;
export const maxAttachmentErrorCodeLength = 96;

export function isAttachmentError(error: unknown): error is Error {
  return error instanceof Error && error.message.length <= maxAttachmentErrorCodeLength
    && attachmentErrorCodePattern.test(error.message);
}
