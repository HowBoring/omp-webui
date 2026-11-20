/** Browser-side image intake: signature sniffing, base64 transport, and the draft's independent decode budget. */
import { imageOriginalBytes } from "../../../packages/attachments/media.ts";

export type ImageKind = "image/png" | "image/jpeg" | "image/webp" | "image/gif";

export const imageLimits = { bytes: imageOriginalBytes, objects: 8, draftBytes: 32 * 1024 ** 2,
  edge: 16_384, pixels: 40_000_000, draftPixels: 120_000_000 } as const;

const ascii = (bytes: Uint8Array, start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));

/** Content decides the format; a file name or declared MIME type never does. */
export function sniffImage(bytes: Uint8Array): ImageKind | undefined {
  if (bytes.length >= 8 && bytes[0] === 0x89 && ascii(bytes, 1, 4) === "PNG" && bytes[4] === 0x0d && bytes[5] === 0x0a
    && bytes[6] === 0x1a && bytes[7] === 0x0a) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 6 && (ascii(bytes, 0, 6) === "GIF87a" || ascii(bytes, 0, 6) === "GIF89a")) return "image/gif";
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") return "image/webp";
  return undefined;
}

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
