/** Browser-side image intake: signature sniffing, base64 transport, and the draft's independent decode budget. */
import { imageOriginalBytes, sniffImage, type ImageMediaType } from "../../../packages/attachments/media.ts";

export { sniffImage };
export type ImageKind = ImageMediaType;

export const imageLimits = { bytes: imageOriginalBytes, objects: 8, draftBytes: 32 * 1024 ** 2,
  edge: 16_384, pixels: 40_000_000, draftPixels: 120_000_000 } as const;

export function base64Of(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

export function bytesOfBase64(value: string): Uint8Array {
  const compact = value.replace(/\s+/g, "").replace(/^data:[^;,]+;base64,/, "");
  const binary = atob(compact);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; ++index) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** Decode at a bounded cost; a decompression bomb or a broken file fails before any upload. */
export async function decodeImage(bytes: Uint8Array, kind: ImageKind): Promise<{ width: number; height: number; pixels: number }> {
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes).buffer], { type: kind })); }
  catch { throw new Error("That file is not a decodable PNG, JPEG, WebP, or GIF image."); }
  try {
    const { width, height } = bitmap;
    if (!(width > 0) || !(height > 0)) throw new Error("The image has no decodable pixels.");
    const pixels = width * height;
    if (width > imageLimits.edge || height > imageLimits.edge || pixels > imageLimits.pixels)
      throw new Error(`The image exceeds the ${imageLimits.edge}px edge or ${imageLimits.pixels}-pixel decode budget.`);
    return { width, height, pixels };
  } finally { bitmap.close(); }
}

export type DraftImage = { readonly byteLength: number; readonly pixels: number };
export type DraftBudgetFailure = "objects" | "bytes" | "pixels";

/** Client-side mirror of the public originals target; the Host remains the authority on every byte. */
export function draftBudgetFailure(current: readonly DraftImage[], next: { byteLength: number; pixels?: number }): DraftBudgetFailure | undefined {
  if (current.length >= imageLimits.objects) return "objects";
  if (next.byteLength > imageLimits.bytes) return "bytes";
  if (current.reduce((sum, item) => sum + item.byteLength, 0) + next.byteLength > imageLimits.draftBytes) return "bytes";
  const pixels = current.reduce((sum, item) => sum + item.pixels, 0) + (next.pixels ?? 0);
  return pixels > imageLimits.draftPixels ? "pixels" : undefined;
}
