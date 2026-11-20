import { expect, test } from "bun:test";
import { AttachmentBridge, type AttachmentAuthority } from "../../packages/attachments/bridge.ts";
import type { RpcWireCommands } from "../../packages/contracts/generated/omp-wire.ts";
import type { AttachmentReceipt } from "../../packages/contracts/attachment-preparation.ts";
const selection = { session: "projection", draftId: "draft", revision: "1", originalIds: ["original"] };
const target = { sourceId: "a".repeat(64), instanceId: "b".repeat(64), nativeSessionId: "session" };
function fixture(options: { reserve?: AttachmentAuthority["reserve"] } = {}) {
  let authorized = true, revision = "1", prepared = 0, submitted = 0;
  let lastSubmitted: RpcWireCommands["submission_submit"]["params"] | undefined;
  const authority: AttachmentAuthority = { ...(options.reserve ? { reserve: options.reserve } : {}),
    async authorize(request) {
    if (!authorized || request.revision !== revision) throw Error("ATTACHMENT_AUTHORITY_CHANGED");
    return { target, authorityGeneration: "grant", draftId: "draft", draftRevision: revision, message: "prose",
      objects: [{ originalId: "original", format: "utf8", sha256: "c".repeat(64), data: "aGk=" }] };
  } };
  const native = { async prepare(input: { preparationId: string }) {
    prepared++;
    return { version: "attachment-preparation-v1", budgetVersion: "attachment-budgets-v1", receiptId: "receipt",
      preparationId: input.preparationId, draftId: "draft", draftRevision: "1", authorityGeneration: "grant",
      draftFingerprint: "c".repeat(64), binding: { ...target, contextId: "d".repeat(64), modelFingerprint: "e".repeat(64), imageCapable: true },
      expiresAt: Date.now() + 60_000, resultDigest: "f".repeat(64), status: "ready",
      items: [{ originalId: "original", originalSha256: "c".repeat(64), preparedId: "prepared", preparedSha256: "d".repeat(64),
        status: "ready", representation: { kind: "text", text: "hi" }, degradations: ["text_truncated"] }] } satisfies AttachmentReceipt;
  }, async cancel() { return { cancelled: true }; }, async submit(input: RpcWireCommands["submission_submit"]["params"]) {
    submitted++; lastSubmitted = input;
    return { version: "durable-submission-v1", clientSubmissionId: input.clientSubmissionId, target,
      found: true, duplicate: false, admission: "local", reservation: "committed", inputOutcome: "unresolved", operationOutcome: "unknown",
      persistence: "unresolved", terminal: false, relations: [], nextOffset: null,
      origin: { ...target, clientSubmissionId: input.clientSubmissionId },
      preparation: { ...input.preparationConsent, attachments: [] } };
  } };
  return { bridge: new AttachmentBridge(authority, () => native), revoke: () => { authorized = false; },
    edit: () => { revision = "2"; }, lastSubmitted: () => lastSubmitted, counts: () => ({ prepared, submitted }) };
}

test("all actual degradations require explicit consent before a DSH request can be bound", async () => {
  const f = fixture(), receipt = await f.bridge.prepare(selection);
  expect(f.counts()).toEqual({ prepared: 1, submitted: 0 });
  await expect(f.bridge.consent({ selection, receiptId: receipt.receiptId, resultDigest: receipt.resultDigest,
    acceptedDegradations: [] })).rejects.toThrow("ATTACHMENT_DEGRADATION_CONSENT_REQUIRED");
  const accepted = await f.bridge.consent({ selection, receiptId: receipt.receiptId, resultDigest: receipt.resultDigest,
    acceptedDegradations: ["text_truncated"] });
  await f.bridge.bind({ selection, consentId: accepted.consentId, submissionId: "attempt", requestId: "dsh-request" });
  expect(f.counts().submitted).toBe(0);
  expect(await f.bridge.submitForRequest("dsh-request")).toMatchObject({ reservation: "committed", inputOutcome: "unresolved" });
  expect(f.lastSubmitted()).toMatchObject({ ...target, clientSubmissionId: "attempt", message: "prose",
    preparationConsent: { receiptId: "receipt", acceptedDegradations: ["text_truncated"] } });
  expect(f.counts().submitted).toBe(1);
});

test("revocation after consent refuses consumption before native submission effects", async () => {
  const f = fixture(), receipt = await f.bridge.prepare(selection);
  const accepted = await f.bridge.consent({ selection, receiptId: receipt.receiptId, resultDigest: receipt.resultDigest,
    acceptedDegradations: ["text_truncated"] });
  await f.bridge.bind({ selection, consentId: accepted.consentId, submissionId: "attempt", requestId: "dsh-request" });
  f.revoke(); await expect(f.bridge.submitForRequest("dsh-request")).rejects.toThrow("ATTACHMENT_AUTHORITY_CHANGED");
  expect(f.counts().submitted).toBe(0);
});

test("a refused reservation never marks Native started or dispatches the input", async () => {
  let dispatched = false;
  const f = fixture({ reserve: async () => { throw Error("attachment_original_protected"); } });
  const receipt = await f.bridge.prepare(selection);
  const accepted = await f.bridge.consent({ selection, receiptId: receipt.receiptId, resultDigest: receipt.resultDigest,
    acceptedDegradations: ["text_truncated"] });
  await f.bridge.bind({ selection, consentId: accepted.consentId, submissionId: "attempt", requestId: "dsh-request" });
  await expect(f.bridge.submitForRequest("dsh-request", () => { dispatched = true; }))
    .rejects.toThrow("attachment_original_protected");
  expect(dispatched).toBe(false);
  expect(f.counts()).toMatchObject({ submitted: 0 });
  expect(f.lastSubmitted()).toBeUndefined();
});

test("draft edit after preparation refuses old consent and preserves the whole input", async () => {
  const f = fixture(), receipt = await f.bridge.prepare(selection); f.edit();
  await expect(f.bridge.consent({ selection, receiptId: receipt.receiptId, resultDigest: receipt.resultDigest,
    acceptedDegradations: ["text_truncated"] })).rejects.toThrow("ATTACHMENT_AUTHORITY_CHANGED");
  expect(f.counts().submitted).toBe(0);
});

test("an authorized draft cannot cancel an unowned native preparation by guessing an ID", async () => {
  const f = fixture();
  expect(await f.bridge.cancel({ selection, preparationId: "another-draft-preparation" })).toEqual({ cancelled: false });
  expect(f.counts().submitted).toBe(0);
});
