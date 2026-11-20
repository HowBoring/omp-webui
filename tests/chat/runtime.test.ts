import { expect, test } from "bun:test";
import { parseProjectionBinding } from "@deepseek-ai/dsh-api-session-controller/projection";
import type { SessionRequestId } from "@deepseek-ai/dsh-api-session-controller/types";
import { SessionId } from "@deepseek-ai/dsh-session/types";
import type { PeerScope } from "@deepseek-ai/dsh-typert-protocol";
import { brandString } from "@deepseek-ai/dsh-brand";
import { ChatViewAdmission } from "../../apps/host/src/chat-view-admission.ts";
import { ChatComponentRuntime } from "../../apps/host/src/chat-component-runtime.ts";
import { ChatError } from "../../packages/chat/gateway.ts";
import { chatViewCaller } from "../../packages/chat/service.ts";
import type { SubmissionResult } from "../../packages/contracts/candidates/durable-submission-v1/omp-wire.ts";
import type { SubmissionClientCommand } from "../../packages/contracts/candidates/durable-submission-v1/submission-client.ts";
import { sourceFixture } from "../sessions/source-fixture.ts";

const projection = parseProjectionBinding({ source: "source", generation: "native-session" });

test("a Session relaunched after switching away resolves Chat to the new worker generation", async () => {
  const source = await sourceFixture();
  const admission = new ChatViewAdmission(source.authority, source.grants, source.supervisor);
  const runtime = new ChatComponentRuntime(source.authority, source.grants, source.supervisor, admission);
  try {
    const { nativeSessionId, sourceId, instanceId } = source.selected;
    const sessionId = SessionId(nativeSessionId);
    const first = await source.supervisor.open(source.identity, source.selected);
    expect(runtime.attach(source.identity, { workerId: first.workerId, projection, draftId: "draft" })?.generation)
      .toBe(first.generation);

    // Switch away and back: the same native Session is reopened by a new supervised worker generation.
    const selectedStart = source.controls.start;
    const other = source.other;
    const opened = await selectedStart();
    source.controls.start = async () => ({ ...opened, nativeSessionId: other.nativeSessionId,
      binding: { ...other, ownership: { ...other.ownership, state: "held" } } });
    await source.supervisor.switchTo(source.identity, other);
    source.controls.start = selectedStart;
    const returned = await source.supervisor.switchTo(source.identity, source.selected);
    expect(returned.generation).not.toBe(first.generation);
    expect(returned.registration.nativeSessionId).toBe(nativeSessionId);

    expect(runtime.attach(source.identity, { workerId: returned.workerId, projection, draftId: "draft" })?.generation)
      .toBe(returned.generation);

    const { worker } = source.supervisor.runtime(source.identity, returned.workerId);
    const target = { nativeSessionId, sourceId, instanceId };
    let submitted = 0;
    worker.submitCommand = async (command: SubmissionClientCommand) => {
      const clientSubmissionId = command.clientSubmissionId;
      if (command.type === "submission_submit") ++submitted;
      const data: SubmissionResult = {
        version: "durable-submission-v1", clientSubmissionId, target, found: true, duplicate: false, admission: "local",
        origin: { ...target, clientSubmissionId }, reservation: "committed", nextOffset: null, operationOutcome: "unknown",
        inputOutcome: "generated", terminal: false, persistence: "committed",
        relations: [{ relationId: `entry:${clientSubmissionId}`, role: "input", status: "observed",
          persistence: "committed", entryId: "real-input", availability: "retained" }],
      };
      return { type: "response", id: command.id, command: command.type, success: true, data };
    };

    const enrollment = runtime.enrollment(source.identity);
    expect(enrollment).toBeDefined();
    const peer = { signal: new AbortController().signal } as PeerScope;
    const binding = admission.bind(source.identity, enrollment!, peer, new AbortController().signal);
    expect(binding).toBeDefined();
    const request = { sessionId, requestId: brandString<SessionRequestId>("draft-a"), projection,
      mode: "queue" as const, content: [{ type: "text" as const, text: "resumed text" }] };
    const outcome = await binding!.run(async () => {
      const gateway = runtime.gateway(sessionId);
      if (!gateway) return "no-gateway";
      const view = chatViewCaller.getStore();
      if (!view) return "no-capability";
      try {
        await gateway.prompt({ view, peer }, request, new AbortController().signal);
        return "accepted";
      } catch (error) {
        return error instanceof ChatError ? error.code : "other";
      }
    });
    expect({ outcome, submitted }).toEqual({ outcome: "accepted", submitted: 1 });
  } finally {
    runtime.close();
    await source.close();
  }
});

test("a replacement browser attaches to the live worker after the first browser is gone", async () => {
  const source = await sourceFixture();
  const admission = new ChatViewAdmission(source.authority, source.grants, source.supervisor);
  const runtime = new ChatComponentRuntime(source.authority, source.grants, source.supervisor, admission);
  try {
    const opened = await source.supervisor.open(source.identity, source.selected);
    expect(runtime.attach(source.identity, { workerId: opened.workerId, projection, draftId: "first" })?.generation)
      .toBe(opened.generation);
    // The first browser disappears without releasing the worker; a new browser bootstraps its own credential.
    const replacement = await source.browser();
    expect(replacement.identity.credentialId).not.toBe(source.identity.credentialId);
    expect(runtime.attach(replacement.identity, { workerId: opened.workerId, projection, draftId: "replacement" })?.generation)
      .toBe(opened.generation);
  } finally {
    runtime.close();
    await source.close();
  }
});
