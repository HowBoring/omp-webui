import { createHash } from "node:crypto";
import { inflateSync } from "node:zlib";

// The existing 1x1 grayscale/alpha white pixel, with its IDAT CRC repaired.
// Scanline inflates to 01 ff ff: Sub filter, luminance=255, alpha=255.
const whitePixel = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=";

export function pngCrc(bytes: Uint8Array): number {
  let crc = 0xffff_ffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb8_8320 : 0);
  }
  return (crc ^ 0xffff_ffff) >>> 0;
}

/** Runtime only: private ancillary chunks <=64KiB leave IDAT, pixels and geometry unchanged. */
export function whitePngAtBytes(bytes: number): Buffer {
  const tiny = Buffer.from(whitePixel, "base64"), chunks = [tiny.subarray(0, 33)];
  let remaining = bytes - tiny.length;
  if (remaining < 12) throw Error("PNG_PADDING_TOO_SMALL");
  while (remaining > 0) {
    const dataBytes = Math.min(65_536, remaining - 12);
    if (dataBytes < 0) throw Error("PNG_PADDING_REMAINDER");
    const chunk = Buffer.alloc(dataBytes + 12);
    chunk.writeUInt32BE(dataBytes, 0); chunk.write("npAD", 4, "ascii");
    chunk.writeUInt32BE(pngCrc(chunk.subarray(4, 8 + dataBytes)), 8 + dataBytes);
    chunks.push(chunk); remaining -= chunk.length;
  }
  chunks.push(tiny.subarray(33));
  return Buffer.concat(chunks);
}

function paeth(left: number, up: number, corner: number): number {
  const p = left + up - corner, a = Math.abs(p - left), b = Math.abs(p - up), c = Math.abs(p - corner);
  return a <= b && a <= c ? left : b <= c ? up : corner;
}

/** Independent PNG scanline witness. No image codec/Native import; rejects every non-white pixel. */
export function opaqueWhitePngWitness(bytes: Buffer, width: number, height: number): string {
  if (!bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) throw Error("PNG_SIGNATURE");
  const idat: Buffer[] = [];
  let channels = 0, ended = false;
  for (let offset = 8; offset < bytes.length;) {
    if (offset + 12 > bytes.length) throw Error("PNG_TRUNCATED");
    const count = bytes.readUInt32BE(offset), end = offset + 12 + count;
    if (end > bytes.length) throw Error("PNG_TRUNCATED");
    const type = bytes.toString("ascii", offset + 4, offset + 8), data = bytes.subarray(offset + 8, end - 4);
    if (pngCrc(bytes.subarray(offset + 4, end - 4)) !== bytes.readUInt32BE(end - 4)) throw Error("PNG_CRC");
    if (type === "IHDR") {
      if (offset !== 8 || count !== 13 || data.readUInt32BE(0) !== width || data.readUInt32BE(4) !== height ||
        data[8] !== 8 || data[10] !== 0 || data[11] !== 0 || data[12] !== 0) throw Error("PNG_LAYOUT");
      channels = ({ 0: 1, 2: 3, 4: 2, 6: 4 } as Record<number, number>)[data[9] ?? -1] ?? 0;
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") { if (count !== 0 || end !== bytes.length) throw Error("PNG_TRAILER"); ended = true; }
    else if (type === "tRNS" || type === "acTL" || /^[A-Z]/.test(type)) throw Error("PNG_UNSUPPORTED");
    offset = end;
  }
  if (!ended || !channels || !idat.length) throw Error("PNG_LAYOUT");
  const stride = width * channels;
  const scanlines = inflateSync(Buffer.concat(idat), { maxOutputLength: (stride + 1) * height });
  if (scanlines.length !== (stride + 1) * height) throw Error("PNG_SCANLINES");
  let previous = Buffer.alloc(stride);
  const hash = createHash("sha256");
  for (let row = 0; row < height; row++) {
    const offset = row * (stride + 1), filter = scanlines[offset], current = Buffer.alloc(stride);
    if (filter === undefined || filter > 4) throw Error("PNG_FILTER");
    for (let x = 0; x < stride; x++) {
      const left = current[x - channels] ?? 0, up = previous[x] ?? 0, corner = previous[x - channels] ?? 0;
      const prediction = [0, left, up, Math.floor((left + up) / 2), paeth(left, up, corner)][filter] ?? 0;
      current[x] = ((scanlines[offset + 1 + x] ?? 0) + prediction) & 255;
      if (current[x] !== 255) throw Error("PNG_NOT_OPAQUE_WHITE");
    }
    hash.update(Buffer.alloc(width * 4, 255)); previous = current;
  }
  return hash.digest("hex");
}
