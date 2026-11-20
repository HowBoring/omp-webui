import { expect, test } from "bun:test";
import { base64Of, bytesOfBase64, sniffImage } from "../../apps/chat/src/images.ts";

test("image format comes from bytes, never from a name or declared MIME type", () => {
  expect(sniffImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("image/png");
  expect(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
  expect(sniffImage(new TextEncoder().encode("GIF89a\u0000\u0000"))).toBe("image/gif");
  expect(sniffImage(new TextEncoder().encode("RIFF\u0000\u0000\u0000\u0000WEBPVP8 "))).toBe("image/webp");
  expect(sniffImage(new TextEncoder().encode("this is not an image"))).toBeUndefined();
  expect(sniffImage(new TextEncoder().encode("<html>"))).toBeUndefined();
});

test("base64 transport round-trips arbitrary image bytes and accepts data URLs", () => {
  const bytes = Uint8Array.from({ length: 256 }, (_, index) => index);
  expect(bytesOfBase64(base64Of(bytes))).toEqual(bytes);
  expect(bytesOfBase64(`data:image/png;base64,${base64Of(bytes)}`)).toEqual(bytes);
  expect(bytesOfBase64(`  ${base64Of(bytes)}\n`)).toEqual(bytes);
});
