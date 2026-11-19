import { Context } from "@deepseek-ai/cordis";
import { apply as connection } from "@deepseek-ai/dsh-client-connection/client";
import { apply as registry } from "@deepseek-ai/dsh-typert-registry/client";
import { apply as gateway } from "@deepseek-ai/dsh-api-gateway/client";
import * as React from "react";
import { createRoot } from "react-dom/client";
import { attachmentsContribution } from "../../../packages/contracts/attachment-remote.ts";
import { AttachmentPreparationController } from "../../../packages/client-extensions/attachment-preparation.ts";
import { AttachmentPreparationPanel } from "../../../packages/client-extensions/attachment-preparation-panel.tsx";
import { attachmentFixtureContribution, type AttachmentFixtureSnapshot } from "../../../packages/contracts/attachment-fixture.ts";

const ctx = new Context();
const state = document.querySelector<HTMLElement>("#state")!, result = document.querySelector<HTMLElement>("#result")!;
const originals = document.querySelector<HTMLElement>("#originals")!, evidenceNode = document.querySelector<HTMLElement>("#evidence")!;
const root = createRoot(document.querySelector<HTMLElement>("#panel")!);
let snapshot: AttachmentFixtureSnapshot | undefined;
let controller: AttachmentPreparationController | undefined;
let abort: AbortController | undefined;
let lastSubmission: unknown;

function evidence(value: Record<string, unknown>): void {
  evidenceNode.textContent = JSON.stringify({ build: snapshot?.build, target: snapshot?.target,
    selection: snapshot?.selection, originals: snapshot?.originals, submission: lastSubmission, ...value }, null, 2);
}

async function refresh(): Promise<void> {
  const answer = await ctx.remote.ompAttachmentFixture.snapshot();
  if (!answer.ok) { state.textContent = `snapshot_failed ${answer.error.message}`; return; }
  snapshot = answer.value;
  state.textContent = `native ${snapshot.target.nativeSessionId.slice(0, 8)} build ${snapshot.build.sourceSha256.slice(0, 12)} selection ${snapshot.selection?.draftId.slice(0, 8) ?? "none"}`;
  originals.replaceChildren(...snapshot.originals.map(item => {
    const row = document.createElement("li"); row.dataset.original = item.id;
    row.textContent = `${item.id} ${item.mediaType}`; return row;
  }));
  evidence({});
}

function mountController(): void {
  const selection = snapshot?.selection;
  if (!selection) throw Error("ATTACHMENT_SELECTION_REQUIRED");
  controller?.dispose();
  const draft = { current: () => ({ ...selection, originalIds: [...selection.originalIds] }) };
  controller = new AttachmentPreparationController(ctx.remote.ompAttachments, draft);
  root.render(React.createElement(AttachmentPreparationPanel, { controller }));
}

async function select(): Promise<void> {
  result.textContent = "";
  const answer = await ctx.remote.ompAttachmentFixture.select({ formats: ["utf8", "png"], message: "ordinary attachment prose" });
  if (!answer.ok) throw Error(answer.error.message);
  snapshot = answer.value; await refresh(); mountController();
}

async function send(): Promise<void> {
  if (!controller || !snapshot?.selection || snapshot.message === null) throw Error("ATTACHMENT_SELECTION_REQUIRED");
  abort = new AbortController();
  const selection = snapshot.selection;
  await controller.registerAttempt({ selection, submissionId: crypto.randomUUID(), requestId: crypto.randomUUID() }, abort.signal);
  const attempt = controller.getSnapshot();
  if (attempt.phase === "idle") throw Error("ATTACHMENT_ATTEMPT_UNRESOLVED");
  const answer = await ctx.remote.ompAttachmentFixture.send({ requestId: attempt.requestId, message: snapshot.message });
  lastSubmission = answer.ok ? answer.value : { error: answer.error.message };
  await controller.refresh();
  const view = controller.getSnapshot();
  const admitted = lastSubmission && typeof lastSubmission === "object" && "clientSubmissionId" in lastSubmission
    && typeof lastSubmission.clientSubmissionId === "string" ? lastSubmission.clientSubmissionId : undefined;
  result.dataset.status = answer.ok ? "accepted" : "error";
  result.textContent = answer.ok ? `submission ${admitted?.slice(0, 8) ?? "unknown"} admitted` : `error ${answer.error.message}`;
  evidence({ phase: view.phase === "idle" ? "idle" : view.phase, recovery: view.phase === "idle" ? "unresolved" : view.recovery });
}

async function cancel(): Promise<void> {
  abort?.abort();
  await controller?.cancel();
  evidence({ cancelled: true });
}

async function query(): Promise<void> {
  if (!lastSubmission || typeof lastSubmission !== "object" || !("clientSubmissionId" in lastSubmission)
    || typeof lastSubmission.clientSubmissionId !== "string") throw Error("ATTACHMENT_SUBMISSION_UNKNOWN");
  const id = lastSubmission.clientSubmissionId;
  const answer = await ctx.remote.ompAttachmentFixture.query({ clientSubmissionId: id });
  evidence({ query: answer.ok ? answer.value : { error: answer.error.message } });
  result.dataset.status = answer.ok ? "queried" : "error";
  result.textContent = answer.ok ? "submission queried" : `error ${answer.error.message}`;
}

const act = (run: () => Promise<void>) => () => { void run().catch(error => {
  result.dataset.status = "error"; result.textContent = `error ${String(error?.message ?? error)}`;
}); };

async function boot(): Promise<void> {
  connection(ctx); registry(ctx); gateway(ctx);
  await ctx.remote.$mount(attachmentsContribution);
  await ctx.remote.$mount(attachmentFixtureContribution);
  await refresh();
  document.querySelector("#select")!.addEventListener("click", act(select));
  document.querySelector("#send")!.addEventListener("click", act(send));
  document.querySelector("#cancel")!.addEventListener("click", act(cancel));
  document.querySelector("#query")!.addEventListener("click", act(query));
}

window.addEventListener("pagehide", () => { controller?.dispose(); void ctx.fiber.dispose(); }, { once: true });
void boot().catch(error => { state.textContent = `attachment_boot_failed ${String(error)}`; });
