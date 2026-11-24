/** Fixed Native degradation vocabulary; shared by the component panel and the stock consent overlay. */
export const attachmentDegradationLabels: Record<string, string> = {
  image_transformed: "Image size or encoding changed",
  animation_first_frame_only: "Only the first animation frame will be sent",
  text_truncated: "Text was shortened to the native input limit",
  document_structure_changed: "Document was converted to Markdown; formatting may change",
  pdf_ocr_required: "Some PDF pages need OCR and their text is unavailable",
  pdf_encoding_issues: "The PDF text has encoding issues",
  document_no_extractable_text: "The document has no extractable text",
  document_images_omitted: "Embedded document images are omitted",
};
