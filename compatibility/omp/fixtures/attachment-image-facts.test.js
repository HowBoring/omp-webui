import { expect, test } from 'bun:test';
import { imageAnimation } from '../../../vendor/omp/packages/utils/src/image-animation.ts';

test('GIF frame allocation must fit the declared logical canvas', () => {
  const bytes = Uint8Array.from(Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAgABAAACAkQBADs=', 'base64'));
  expect(() => imageAnimation(bytes, 'image/gif')).toThrow('Invalid GIF frame bounds');
});

test('16-bit PNG exposes an eight-byte RGBA allocation floor before decoding', () => {
  const bytes = new Uint8Array(45); const view = new DataView(bytes.buffer);
  bytes.set([137,80,78,71,13,10,26,10]); view.setUint32(8,13); bytes.set([73,72,68,82],12);
  view.setUint32(16,100); view.setUint32(20,100); bytes[24]=16; bytes[25]=6;
  view.setUint32(33,0); bytes.set([73,69,78,68],37);
  expect(imageAnimation(bytes,'image/png').decodedBytesPerPixel).toBe(8);
});
