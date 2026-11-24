/** OMP-specific public slot UI displaying the exact native preparation before explicit consent. */
import * as React from "react";
import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-client-ui-renderer/client";
import type {} from "@deepseek-ai/dsh-client-ui-layout/client";
import type { AttachmentPreparationController } from "./attachment-preparation.ts";
import { attachmentDegradationLabels as labels } from "./attachment-labels.ts";
export const attachmentFailures: Record<string, string> = {
  attachment_format_mismatch: "The bytes do not match the declared format.",
  attachment_conversion_failed: "The document converter failed.",
  attachment_conversion_empty: "The document has no extractable text.",
  attachment_conversion_output_budget: "The converted text exceeds the prepared-text ceiling.",
  attachment_archive_budget: "The archive exceeds Native's archive budget.",
  attachment_original_budget: "The original exceeds Native's byte budget.",
  attachment_decoded_budget: "The image exceeds Native's decode budget.",
  attachment_prepared_budget: "The prepared image exceeds Native's output budget.",
};
export function AttachmentPreparationPanel({ controller }: { controller: AttachmentPreparationController }) {
  const view = React.useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const [error, setError] = React.useState<string>();
  const action = (run: () => Promise<void>) => { setError(undefined); void run().catch(value => setError(String(value))); };
  const status = view.phase === "idle" ? undefined : view;
  const codes = [...new Set(status?.receipt?.items.flatMap(item => item.status === "ready" ? item.degradations : []) ?? [])];
  return <section aria-label="Prepared attachments" data-attachment-phase={view.phase}>
    <h2>Prepared attachments</h2>
    <button onClick={() => action(() => controller.cancel())} disabled={view.phase === "idle"}>Cancel this Send attempt</button>
    {view.phase === "idle" && <p>Send to prepare the exact input. Native admission waits for your review.</p>}
    {view.phase === "registered" && <p role="status">Send is pending preparation. This is not a committed Native message.</p>}
    {view.phase === "preparing" && <p role="status">Preparing every attachment…</p>}
    {status?.prompt !== undefined && <details><summary>Exact serialized prompt</summary><pre>{status.prompt}</pre></details>}
    {status?.receipt?.items.map((item, index) => <article key={item.preparedId} data-original-id={item.originalId}
      data-attachment-representation={item.status === "failed" ? "failed" : item.representation.kind}>
      <h3>Attachment {index + 1}</h3>
      {item.status === "failed" ? <p role="alert">Could not prepare this attachment: {attachmentFailures[item.code] ?? item.code}</p> : <>
        <p>Host original {item.originalId} stays private; Native receives {item.representation.kind === "image" ? "the transformed image" : "the text"} below.</p>
        {item.representation.kind === "image" ? <>
          <p>{item.representation.width} × {item.representation.height}, {item.representation.mimeType}</p>
          <img alt={`Prepared attachment ${index + 1}`} style={{ maxWidth: 280, maxHeight: 180 }}
            src={`data:${item.representation.mimeType};base64,${item.representation.data}`} />
        </> : <pre style={{ maxHeight: 180, overflow: "auto", whiteSpace: "pre-wrap" }}>{item.representation.text}</pre>}
        <ul>{item.degradations.map(code => <li key={code}>{labels[code] ?? code}</li>)}</ul>
        {item.facts?.pagesNeedingOcr?.length ? <p>Pages needing OCR: {item.facts.pagesNeedingOcr.join(", ")}</p> : null}
        {item.facts?.omittedImages ? <p>Embedded images omitted: {item.facts.omittedImages}</p> : null}
        {item.facts?.frames && item.facts.frames > 1 ? <p>Images in original container: {item.facts.frames}</p> : null}
      </>}
    </article>)}
    {view.phase === "failed" && <p role="alert">This input cannot be sent. Keep the draft and correct the attachments.</p>}
    {view.phase === "awaiting-consent" && <button onClick={() => action(() => controller.consent(codes))}>
      {codes.length ? "Accept listed changes and continue Send" : "Continue this Send attempt"}
    </button>}
    {view.phase === "submitting" && <p role="status">This Send attempt is awaiting Native admission.</p>}
    {view.phase === "unresolved" && <p role="status">Native outcome is unresolved. This attempt cannot be resent.</p>}
    {status?.recovery === "accepted" && <p role="status">Native input is committed. The local checkpoint can be resolved.</p>}
    {status?.recovery === "not-submitted" && <p role="status">Native input was not submitted. Keep the valid originals and unsent draft.</p>}
    {status?.recovery === "completed-without-input" && <p role="status">Native operation completed without a committed user input. Originals remain available.</p>}
    {(error ?? view.error) && <p role="alert">{error ?? view.error}</p>}
  </section>;
}
/** Effect-owned public shell slot contribution; the caller provides an authorized semantic provider/controller. */
export function mountAttachmentPreparationPanel(ctx: Context, controller: AttachmentPreparationController): void {
  ctx.slots.inject("shell.overlay", () => ctx.slots.register({ name: "shell.overlay", id: "omp-attachment-preparation",
    inject: () => ({ controller }) }, AttachmentPreparationPanel));
}
