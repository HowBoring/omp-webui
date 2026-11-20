import { expect, test } from "bun:test";
import { AttachmentBridge } from "../../packages/attachments/bridge.ts";
import { AttachmentSubmissionGate } from "../../packages/attachments/submission-gate.ts";
import type { AttachmentReceipt } from "../../packages/contracts/attachment-preparation.ts";
import type { RpcWireCommands } from "../../packages/contracts/generated/omp-wire.ts";

const selection = { session: "projection", draftId: "draft", revision: "1", originalIds: ["original"] };
const target = { sourceId: "a".repeat(64), instanceId: "b".repeat(64), nativeSessionId: "native" };
const attempt = { selection, submissionId: "attempt", requestId: "request" };
function fixture() {
  let revision = "1", owner = true, prepares = 0, submits = 0;
  let preparedMessage = "", submittedMessage = "";
  let failSubmit = false, noInput = false, mismatchOrigin = false, mismatchTarget = false, missingPart = false, unavailablePart = false;
  let terminal = true; let deferred: PromiseWithResolvers<void> | undefined;
  let operationOutcome: "succeeded" | "failed" | "cancelled" | "unknown" = "unknown";
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
    if (deferred) await deferred.promise;
    return { version: "durable-submission-v1", clientSubmissionId: input.clientSubmissionId,
      target: mismatchTarget ? { ...target, nativeSessionId: "another-session" } : target, found: true, duplicate: false,
      admission: "local", reservation: "committed", inputOutcome: noInput ? "no_input" : "generated", operationOutcome,
      persistence: "committed", terminal, nextOffset: null,
      origin: { ...target, clientSubmissionId: mismatchOrigin ? "another-attempt" : input.clientSubmissionId },
      relations: [...(noInput ? [] : [{ relationId: "entry:user", role: "input", status: "observed", persistence: "committed", entryId: "user" }]),
        { relationId: "entry:prepared", role: "prepared", status: "observed", persistence: "committed", entryId: "prepared", attachments: [{
          originalId: "original", preparedId: "prepared", originalSha256: "c".repeat(64), preparedSha256: "e".repeat(64), representationKind: "text",
          ...(unavailablePart ? { entryPartUnavailable: "missing" } : !missingPart ? { entryPart: { kind: "files", index: 0 } } : {}) }] }],
      preparation: { ...input.preparationConsent, attachments: [] } };
  } }));
  const gate = new AttachmentSubmissionGate(bridge, async () => { if (!owner) throw Error("ATTACHMENT_AUTHORITY_CHANGED"); });
  return { gate, counts: () => ({ prepares, submits }), messages: () => ({ preparedMessage, submittedMessage }),
    edit: () => { revision = "2"; }, revoke: () => { owner = false; }, loseReply: () => { failSubmit = true; },
    handledWithoutInput: (outcome: typeof operationOutcome = "unknown", settled = true) => { noInput = true; operationOutcome = outcome; terminal = settled; },
    mismatchOrigin: () => { mismatchOrigin = true; }, mismatchTarget: () => { mismatchTarget = true; }, missingPart: () => { missingPart = true; },
    unavailablePart: () => { unavailablePart = true; },
    deferSubmit: () => { deferred = Promise.withResolvers<void>(); return () => { deferred?.resolve(); deferred = undefined; }; } };
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

test("revoking the View before consent admits no native dispatch for the pending attempt", async () => {
  const f = fixture(); await f.gate.begin(attempt);
  const abort = new AbortController();
  const pending = f.gate.submit("request", "revoked before consent", abort.signal);
  const state = await awaiting(f.gate);
  f.revoke(); abort.abort();
  await expect(pending).rejects.toThrow("ATTACHMENT_CANCELLED");
  await expect(f.gate.consent(accept(state))).rejects.toThrow("ATTACHMENT_AUTHORITY_CHANGED");
  expect(f.counts().submits).toBe(0);
  await expect(f.gate.status("request")).rejects.toThrow("ATTACHMENT_AUTHORITY_CHANGED");
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

test("a result with another native origin key or target cannot settle the attachment attempt", async () => {
  for (const mismatch of ["mismatchOrigin", "mismatchTarget"] as const) {
    const f = fixture(); await f.gate.begin(attempt); f[mismatch]();
    const pending = f.gate.submit("request", "serialized", new AbortController().signal);
    const state = await awaiting(f.gate); await f.gate.consent(accept(state)); await pending;
    expect(await f.gate.status("request")).toMatchObject({ recovery: "unresolved" });
    await expect(f.gate.finish("request", "accepted")).rejects.toThrow("ATTACHMENT_OUTCOME_UNRESOLVED");
    expect(f.counts().submits).toBe(1);
  }
});

test("a committed prepared identity without an actual saved part cannot accept an original", async () => {
  for (const omission of ["missingPart", "unavailablePart"] as const) {
    const f = fixture(); await f.gate.begin(attempt); f[omission]();
    const pending = f.gate.submit("request", "serialized", new AbortController().signal);
    const state = await awaiting(f.gate); await f.gate.consent(accept(state)); await pending;
    expect(await f.gate.status("request")).toMatchObject({ recovery: "unresolved" });
    await expect(f.gate.finish("request", "accepted")).rejects.toThrow("ATTACHMENT_OUTCOME_UNRESOLVED");
  }
});

test("a successful no-input acknowledgement cannot complete before native terminal publication", async () => {
  const f = fixture(); await f.gate.begin(attempt); f.handledWithoutInput("succeeded", false);
  const pending = f.gate.submit("request", "serialized", new AbortController().signal);
  const state = await awaiting(f.gate); await f.gate.consent(accept(state)); await pending;
  expect(await f.gate.status("request")).toMatchObject({ recovery: "unresolved" });
  await expect(f.gate.finish("request", "completed-without-input")).rejects.toThrow("ATTACHMENT_OUTCOME_UNRESOLVED");
});

test("only a correlated successful terminal no-input result completes without accepting any original", async () => {
  for (const outcome of ["unknown", "failed", "cancelled", "succeeded"] as const) {
    const f = fixture(); await f.gate.begin(attempt); f.handledWithoutInput(outcome);
    const pending = f.gate.submit("request", "serialized", new AbortController().signal);
    const state = await awaiting(f.gate); await f.gate.consent(accept(state)); await pending;
    expect(await f.gate.status("request")).toMatchObject({ recovery: outcome === "succeeded" ? "completed-without-input" : "unresolved" });
    await expect(f.gate.finish("request", "accepted")).rejects.toThrow("ATTACHMENT_OUTCOME_UNRESOLVED");
    await expect(f.gate.finish("request", "not-submitted")).rejects.toThrow("ATTACHMENT_OUTCOME_UNRESOLVED");
    if (outcome === "succeeded") await f.gate.finish("request", "completed-without-input");
    else await expect(f.gate.finish("request", "completed-without-input")).rejects.toThrow("ATTACHMENT_OUTCOME_UNRESOLVED");
    expect(f.counts().submits).toBe(1);
  }
});

test("a cancelled attempt stays unresolved when a late publication arrives and is never retroactively accepted", async () => {
  const f = fixture();
  const release = f.deferSubmit();
  await f.gate.begin(attempt);
  const controller = new AbortController();
  const running = f.gate.submit("request", "late publication", controller.signal);
  const state = await awaiting(f.gate);
  await f.gate.consent(accept(state));
  let submitting = false;
  for (let index = 0; index < 200; index++) {
    if ((await f.gate.status("request")).phase === "submitting") { submitting = true; break; }
    await new Promise(resolve => setTimeout(resolve, 1));
  }
  expect(submitting).toBe(true);
  expect(await f.gate.cancel("request")).toEqual({ cancelled: false });
  expect((await f.gate.status("request")).phase).toBe("unresolved");
  release();
  await running.catch(() => {});
  const late = await f.gate.status("request");
  expect(late.phase).toBe("unresolved");
  expect(late.recovery).toBe("unresolved");
  await expect(f.gate.finish("request", "accepted")).rejects.toThrow("ATTACHMENT_OUTCOME_UNRESOLVED");
});

test("deletion protection refuses occupancy or execution and changes revision after resolution", async () => {
  const f = fixture();
  const binding = { sessionId: "projection", draftId: "draft" };
  const initial = f.gate.protection(binding, "original");
  expect(initial.status).toBe("unreferenced");
  expect(f.gate.protection({ sessionId: "projection", draftId: "other" }, "original")).toEqual(initial);
  expect(f.gate.protection(binding, "another-original")).toEqual(initial);

  await f.gate.begin(attempt);
  expect(f.gate.protection(binding, "original")).toEqual({ status: "occupied" });
  const pending = f.gate.submit("request", "serialized", new AbortController().signal);
  const state = await awaiting(f.gate);
  expect(f.gate.protection(binding, "original")).toEqual({ status: "occupied" });
  await f.gate.consent(accept(state)); await pending;
  expect(f.gate.protection(binding, "original")).toEqual({ status: "executing" });
  await f.gate.finish("request", "accepted");
  const resolved = f.gate.protection(binding, "original");
  expect(resolved.status).toBe("unreferenced");
  expect("revision" in resolved && resolved.revision).not.toBe("revision" in initial && initial.revision);
});

test("a lost publication blocks deletion until explicit recovery resolves the attempt", async () => {
  const f = fixture();
  f.loseReply();
  await f.gate.begin(attempt);
  const pending = f.gate.submit("request", "serialized", new AbortController().signal);
  void pending.catch(() => {});
  const state = await awaiting(f.gate); await f.gate.consent(accept(state));
  await expect(pending).rejects.toThrow("ATTACHMENT_SEND_FAILED");
  expect(f.gate.protection({ sessionId: "projection", draftId: "draft" }, "original"))
    .toEqual({ status: "unresolved-submission" });
  expect(await f.gate.status("request")).toMatchObject({ phase: "unresolved", recovery: "unresolved" });
});
