import { expect, test } from "bun:test";
import { AttachmentBridge } from "../../packages/attachments/bridge.ts";
import { AttachmentSubmissionGate } from "../../packages/attachments/submission-gate.ts";
import type { AttachmentReceipt } from "../../packages/contracts/attachments.ts";
import type { RpcWireCommands } from "../../packages/contracts/generated/omp-wire.ts";

const selection = { session: "projection", draftId: "draft", revision: "1", originalIds: ["original"] };
const target = { sourceId: "a".repeat(64), instanceId: "b".repeat(64), nativeSessionId: "native" };
const attempt = { selection, submissionId: "attempt", requestId: "request" };
function fixture() {
  let revision = "1", owner = true, prepares = 0, submits = 0;
  let preparedMessage = "", submittedMessage = "";
  let failSubmit = false, noInput = false;
  const bridge = new AttachmentBridge({ async authorize(request) {
    if (!owner) throw Error("ATTACHMENT_AUTHORITY_CHANGED");
    if (request.revision !== revision) throw Error("ATTACHMENT_DRAFT_CHANGED");
    return { target, draftId: "draft", draftRevision: "1", authorityGeneration: "grant", message: "raw semantic chip projection",
      objects: [{ originalId: "original", format: "utf8", data: "aGk=", sha256: "c".repeat(64) }] };
  } }, () => ({ async prepare(input) {
    prepares++; preparedMessage = input.message;
    return { version: "attachment-preparation-v1", budgetVersion: "attachment-budgets-v1", receiptId: "receipt", preparationId: input.preparationId,
      draftId: "draft", draftRevision: "1", authorityGeneration: "grant", draftFingerprint: "d".repeat(64),
      binding: { ...target, contextId: "e".repeat(64), modelFingerprint: "f".repeat(64), imageCapable: true }, expiresAt: Date.now() + 60_000,
      status: "ready", resultDigest: "d".repeat(64), items: [{ originalId: "original", originalSha256: "c".repeat(64),
        preparedId: "prepared", preparedSha256: "e".repeat(64), status: "ready", representation: { kind: "text", text: "processed original" },
        degradations: ["text_truncated"] }] } satisfies AttachmentReceipt;
  }, async cancel() { return { cancelled: true }; }, async submit(input: RpcWireCommands["submission_submit"]["params"]) {
    submits++; submittedMessage = input.message; if (failSubmit) throw Error("RPC_LOST_RESPONSE");
    return { version: "durable-submission-v1", clientSubmissionId: input.clientSubmissionId, target, found: true, duplicate: false,
      admission: "local", reservation: "committed", inputOutcome: noInput ? "no_input" : "generated", persistence: "committed", terminal: true, nextOffset: null,
      origin: { ...target, clientSubmissionId: input.clientSubmissionId },
      relations: [{ relationId: "entry:user", role: "input", status: "observed", persistence: "committed", entryId: "user" },
        { relationId: "entry:prepared", role: "prepared", status: "observed", persistence: "committed", entryId: "prepared", attachments: [{
          originalId: "original", preparedId: "prepared", originalSha256: "c".repeat(64), preparedSha256: "e".repeat(64), representationKind: "text" }] }],
      preparation: { ...input.preparationConsent, attachments: [] } };
  } }));
  const gate = new AttachmentSubmissionGate(bridge, async () => { if (!owner) throw Error("ATTACHMENT_AUTHORITY_CHANGED"); });
  return { gate, counts: () => ({ prepares, submits }), messages: () => ({ preparedMessage, submittedMessage }),
    edit: () => { revision = "2"; }, revoke: () => { owner = false; }, loseReply: () => { failSubmit = true; }, handledWithoutInput: () => { noInput = true; } };
}
async function awaiting(gate: AttachmentSubmissionGate) {
  for (let i = 0; i < 40; i++) { const state = await gate.status("request"); if (state.phase === "awaiting-consent") return state; await Promise.resolve(); }
  throw Error("PURE_GATE_NOT_AWAITING_CONSENT");
}
function accept(state: Awaited<ReturnType<AttachmentSubmissionGate["status"]>>) {
  if (!state.receipt) throw Error("PURE_GATE_NO_RECEIPT");
  return { selection, requestId: "request", receiptId: state.receipt.receiptId, resultDigest: state.receipt.resultDigest,
    acceptedDegradations: ["text_truncated"] };
}

test("post-Enter gate uses actual serialized prose and continues only the same explicitly consented attempt", async () => {
  const f = fixture(); await f.gate.begin(attempt); expect(f.counts()).toEqual({ prepares: 0, submits: 0 });
  const prompt = "> exact quoted content\n\nresolved reference from owner codec";
  const pending = f.gate.submit("request", prompt, new AbortController().signal);
  const state = await awaiting(f.gate); expect(state).toMatchObject({ phase: "awaiting-consent", nativeState: "not-dispatched", prompt });
  expect(f.counts().submits).toBe(0);
  await expect(f.gate.consent({ ...accept(state), acceptedDegradations: [] })).rejects.toThrow("ATTACHMENT_DEGRADATION_CONSENT_REQUIRED");
  await f.gate.consent(accept(state)); await pending;
  expect(f.messages()).toEqual({ preparedMessage: prompt, submittedMessage: prompt }); expect(f.counts().submits).toBe(1);
  expect(await f.gate.status("request")).toMatchObject({ phase: "submitted", recovery: "accepted" });
  await f.gate.finish("request", "accepted");
});

test("newer draft edit after preparation refuses consumption without creating another native attempt", async () => {
  const f = fixture(); await f.gate.begin(attempt);
  const pending = f.gate.submit("request", "serialized", new AbortController().signal); void pending.catch(() => {});
  const state = await awaiting(f.gate); f.edit();
  await expect(f.gate.consent(accept(state))).rejects.toThrow("ATTACHMENT_DRAFT_CHANGED");
  await f.gate.cancel("request"); await expect(pending).rejects.toThrow("ATTACHMENT_CANCELLED");
  expect(f.counts().submits).toBe(0); expect(await f.gate.status("request")).toMatchObject({ recovery: "not-submitted" });
});

test("cancelled Remote before consent seals the request against any later native dispatch", async () => {
  const f = fixture(); await f.gate.begin(attempt); const abort = new AbortController();
  const pending = f.gate.submit("request", "serialized", abort.signal); void pending.catch(() => {});
  const state = await awaiting(f.gate); abort.abort(); await expect(pending).rejects.toThrow("ATTACHMENT_CANCELLED");
  await expect(f.gate.consent(accept(state))).rejects.toThrow("ATTACHMENT_CONSENT_STALE"); expect(f.counts().submits).toBe(0);
});

test("lost native response remains unresolved and never authorizes a new send from query absence", async () => {
  const f = fixture(); await f.gate.begin(attempt); f.loseReply();
  const pending = f.gate.submit("request", "serialized", new AbortController().signal); void pending.catch(() => {});
  const state = await awaiting(f.gate); await f.gate.consent(accept(state)); await expect(pending).rejects.toThrow();
  expect(await f.gate.status("request")).toMatchObject({ phase: "unresolved", recovery: "unresolved" });
  await expect(f.gate.finish("request", "not-submitted")).rejects.toThrow("ATTACHMENT_OUTCOME_UNRESOLVED");
  expect(f.counts().submits).toBe(1);
});


test("committed no_input is not proof that native hooks or commands never executed", async () => {
  const f = fixture(); await f.gate.begin(attempt); f.handledWithoutInput();
  const pending = f.gate.submit("request", "serialized", new AbortController().signal);
  const state = await awaiting(f.gate); await f.gate.consent(accept(state)); await pending;
  expect(await f.gate.status("request")).toMatchObject({ nativeState: "reserved", recovery: "unresolved" });
  await expect(f.gate.finish("request", "not-submitted")).rejects.toThrow("ATTACHMENT_OUTCOME_UNRESOLVED");
});
