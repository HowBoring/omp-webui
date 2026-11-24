import { expect, test } from 'bun:test';
import { decodeAttachmentXml, matchesAttachmentContentType } from '../../../vendor/omp/packages/coding-agent/src/attachments/package.ts';

test('a ZIP with a named main member still requires the actual selected Office package content type', () => {
  expect(matchesAttachmentContentType('docx','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>')).toBe(false);
  const xml = '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>';
  expect(matchesAttachmentContentType('docx',xml)).toBe(true);
  expect(matchesAttachmentContentType('xlsx',xml)).toBe(false);
});

test('unsupported or malformed XML encodings are refused rather than silently replaced', () => {
  for (const bytes of [new Uint8Array([0xff,0xfe,60,0]), new TextEncoder().encode('<?xml version="1.0" encoding="windows-1252"?><root/>')]) {
    expect(() => decodeAttachmentXml(bytes)).toThrow('attachment_document_encoding_unsupported');
  }
  expect(decodeAttachmentXml(new TextEncoder().encode('<?xml version="1.0" encoding="UTF-8"?><root/>'))).toContain('<root/>');
});
