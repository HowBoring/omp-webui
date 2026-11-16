/** OMP-specific public slot UI displaying the exact native preparation before explicit consent. */
import * as React from "react";
import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-client-ui-renderer/client";
import type {} from "@deepseek-ai/dsh-client-ui-layout/client";
import type { AttachmentPreparationController } from "./attachment-preparation.ts";

const labels: Record<string, string> = {
  image_transformed: "Image size or encoding changed",
  animation_first_frame_only: "Only the first animation frame will be sent",
  text_truncated: "Text was shortened to the native input limit",
  document_structure_changed: "Document was converted to Markdown; formatting may change",
  pdf_ocr_required: "Some PDF pages need OCR and their text is unavailable",
  pdf_encoding_issues: "The PDF text has encoding issues",
  document_no_extractable_text: "The document has no extractable text",
  document_images_omitted: "Embedded document images are omitted",
};
export function AttachmentPreparationPanel({ controller }: { controller: AttachmentPreparationController }) {
  const view = React.useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const [error, setError] = React.useState<string>();
  const action = (run: () => Promise<void>) => { setError(undefined); void run().catch(value => setError(String(value))); };
  const codes = [...new Set(view.receipt?.items.flatMap(item => item.status === "ready" ? item.degradations : []) ?? [])];
  return <section aria-label="Prepared attachments" data-attachment-phase={view.phase}>
    <h2>Prepared attachments</h2>
    <button onClick={() => action(() => controller.prepare())} disabled={view.phase === "preparing"}>Prepare attachments</button>
    <button onClick={() => action(() => controller.cancel())} disabled={view.phase === "idle"}>Cancel preparation</button>
    {view.phase === "preparing" && <p role="status">Preparing every attachment…</p>}
    {view.receipt?.items.map((item, index) => <article key={item.preparedId} data-original-id={item.originalId}>
      <h3>Attachment {index + 1}</h3>
      {item.status === "failed" ? <p role="alert">Could not prepare this attachment: {item.code}</p> : <>
        {item.representation.kind === "image" ? <>
          <p>{item.representation.width} × {item.representation.height}, {item.representation.mimeType}</p>
          <img alt={`Prepared attachment ${index + 1}`} style={{ maxWidth: 280, maxHeight: 180 }}
            src={`data:${item.representation.mimeType};base64,${item.representation.data}`} />
        </> : <pre style={{ maxHeight: 180, overflow: "auto", whiteSpace: "pre-wrap" }}>{item.representation.text}</pre>}
        <ul>{item.degradations.map(code => <li key={code}>{labels[code] ?? code}</li>)}</ul>
        {item.facts?.pagesNeedingOcr?.length ? <p>Pages needing OCR: {item.facts.pagesNeedingOcr.join(", ")}</p> : null}
        {item.facts?.omittedImages ? <p>Embedded images omitted: {item.facts.omittedImages}</p> : null}
        {item.facts?.frames && item.facts.frames > 1 ? <p>Original animation frames: {item.facts.frames}</p> : null}
      </>}
    </article>)}
    {view.phase === "failed" && <p role="alert">This input cannot be sent. Keep the draft and correct the attachments.</p>}
    {view.phase === "ready" && <button onClick={() => action(() => controller.consent(codes))}>
      {codes.length ? "Accept listed changes" : "Use prepared attachments"}
    </button>}
    {view.phase === "consented" && <p role="status">Prepared attachments accepted for this draft. Send when ready.</p>}
    {(error ?? view.error) && <p role="alert">{error ?? view.error}</p>}
  </section>;
}
/** Effect-owned public shell slot contribution; the caller provides an authorized semantic provider/controller. */
export function mountAttachmentPreparationPanel(ctx: Context, controller: AttachmentPreparationController): void {
  ctx.slots.inject("shell.overlay", () => ctx.slots.register({ name: "shell.overlay", id: "omp-attachment-preparation",
    inject: () => ({ controller }) }, AttachmentPreparationPanel));
}
