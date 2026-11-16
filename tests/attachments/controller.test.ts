import { expect, test } from "bun:test";
import { AttachmentPreparationController } from "../../packages/client-extensions/attachment-preparation.ts";
import type { TypertRemoteNamespaceMap } from "@deepseek-ai/dsh-typert-protocol";
import type { AttachmentGateStatus } from "../../packages/contracts/attachment-remote.ts";

const selection = { session: "projection", draftId: "draft", revision: "1", originalIds: ["original"] };
const attempt = { selection, requestId: "request", submissionId: "attempt" };

test("registering Send exposes pending local input and never prepares from a pre-Enter draft", async () => {
  let state: AttachmentGateStatus = { phase: "registered", requestId: "request", submissionId: "attempt",
    nativeState: "not-dispatched", recovery: "unresolved" };
  const remote: TypertRemoteNamespaceMap["ompAttachments"] = {
    async begin(value) { expect(value).toEqual(attempt); return { ok: true, value: { registered: true } }; },
    async status() { return { ok: true, value: state }; },
    async consent() { throw Error("not awaiting consent"); },
    async cancel() { state = { ...state, phase: "cancelled", recovery: "not-submitted" }; return { ok: true, value: { cancelled: true } }; },
    async finish() { return { ok: true, value: { finished: true } }; },
  };
  const controller = new AttachmentPreparationController(remote, { current: () => selection });
  try {
    await controller.registerAttempt(attempt, new AbortController().signal);
    expect(controller.getSnapshot()).toMatchObject({ phase: "registered", nativeState: "not-dispatched", recovery: "unresolved" });
    state = { ...state, phase: "preparing" }; await controller.refresh();
    expect(controller.getSnapshot().phase).toBe("preparing");
    await controller.cancel();
    expect(controller.getSnapshot()).toMatchObject({ phase: "cancelled", recovery: "not-submitted" });
    await controller.finishAfterRecovery("not-submitted"); expect(controller.getSnapshot().phase).toBe("idle");
  } finally { controller.dispose(); }
});

test("aborting the DSH Send after registration cancels that attempt without starting a replacement", async () => {
  let cancelled = false;
  const remote: TypertRemoteNamespaceMap["ompAttachments"] = {
    async begin() { return { ok: true, value: { registered: true } }; },
    async status() { return { ok: true, value: { phase: cancelled ? "cancelled" : "registered", requestId: "request", submissionId: "attempt",
      nativeState: "not-dispatched", recovery: cancelled ? "not-submitted" : "unresolved" } }; },
    async consent() { throw Error("not awaiting consent"); },
    async cancel() { cancelled = true; return { ok: true, value: { cancelled: true } }; },
    async finish() { return { ok: true, value: { finished: true } }; },
  };
  const controller = new AttachmentPreparationController(remote, { current: () => selection });
  try {
    const abort = new AbortController(); await controller.registerAttempt(attempt, abort.signal); abort.abort();
    await Promise.resolve(); await Promise.resolve();
    expect(cancelled).toBe(true);
    await controller.refresh(); expect(controller.getSnapshot()).toMatchObject({ phase: "cancelled", recovery: "not-submitted" });
  } finally { controller.dispose(); }
});
