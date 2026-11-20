import { expect, test } from "bun:test";
import { prepareAttachmentIsolated } from "../../../vendor/omp/packages/coding-agent/src/attachments/isolated";

test("cancelled conversion is refused before a helper is started", async () => {
  const signal = AbortSignal.abort();
  expect(await prepareAttachmentIsolated({ format: "utf8", bytes: new TextEncoder().encode("retained draft") }, signal))
    .toEqual({ status: "failed", code: "attachment_cancelled" });
});

test("owned resource-limited helper converts a valid input and is reaped before readiness", async () => {
  expect(await prepareAttachmentIsolated({ format: "utf8", bytes: new TextEncoder().encode("prepared in helper") }))
    .toEqual({ status: "ready", representation: { kind: "text", text: "prepared in helper" }, degradations: [] });
});
