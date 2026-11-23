/** Browser-side attachment intake: content classification, safe display names, and the shared draft budget. */
import { documentOriginalBytes, imageOriginalBytes, type OriginalMediaType } from "../../../packages/attachments/media.ts";
import { attachmentLimits as sharedLimits } from "../../../packages/attachments/classify.ts";
import { imageLimits } from "./images.ts";

export { attachmentName, classifyAttachment } from "../../../packages/attachments/classify.ts";

export const attachmentLimits = sharedLimits;

export type DraftAttachment = { readonly mediaType: OriginalMediaType; readonly byteLength: number; readonly pixels?: number | undefined };
export type DraftBudgetFailure = "objects" | "bytes" | "pixels";

/** Client-side mirror of the native original ceilings; the Host and Native remain the authority on every byte. */
export function draftBudgetFailure(current: readonly DraftAttachment[], next: DraftAttachment): DraftBudgetFailure | undefined {
  if (current.length >= attachmentLimits.objects) return "objects";
  const ceiling = next.mediaType.startsWith("image/") ? attachmentLimits.imageBytes : attachmentLimits.documentBytes;
  if (next.byteLength > ceiling) return "bytes";
  if (current.reduce((sum, item) => sum + item.byteLength, 0) + next.byteLength > attachmentLimits.draftBytes) return "bytes";
  const pixels = current.reduce((sum, item) => sum + (item.pixels ?? 0), 0) + (next.pixels ?? 0);
  return pixels > imageLimits.draftPixels ? "pixels" : undefined;
}
