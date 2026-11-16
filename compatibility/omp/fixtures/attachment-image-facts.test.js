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

function chunk(type, data) {
  const bytes = new Uint8Array(12 + data.length), view = new DataView(bytes.buffer);
  view.setUint32(0, data.length); bytes.set(new TextEncoder().encode(type), 4); bytes.set(data, 8); return bytes;
}
function apng(declared) {
  const header = new Uint8Array(13), control = new Uint8Array(8), frame = new Uint8Array(26);
  new DataView(header.buffer).setUint32(0, 1); new DataView(header.buffer).setUint32(4, 1); header[8] = 8; header[9] = 6;
  new DataView(control.buffer).setUint32(0, declared);
  new DataView(frame.buffer).setUint32(4, 1); new DataView(frame.buffer).setUint32(8, 1);
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR',header), chunk('acTL',control),
    chunk('fcTL',frame), chunk('IDAT',new Uint8Array()), chunk('IEND',new Uint8Array())]);
}
test('APNG allocation counts actual frame controls and rejects a dishonest frame declaration', () => {
  expect(imageAnimation(apng(1),'image/png').frames).toBe(1);
  expect(() => imageAnimation(apng(2),'image/png')).toThrow('Invalid APNG frame count');
});
test('WebP frame dimensions cannot exceed the actual selected canvas', () => {
  const bytes = new Uint8Array(36), view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode('RIFF'),0); view.setUint32(4,28,true); bytes.set(new TextEncoder().encode('WEBP'),8);
  bytes.set(new TextEncoder().encode('ANMF'),12); view.setUint32(16,16,true); bytes[26] = 1;
  expect(() => imageAnimation(bytes,'image/webp',{width:1,height:1})).toThrow('Invalid WebP frame bounds');
});
