import { expect, test } from "bun:test";
import { NativeAttachmentFixture } from "../../experiments/attachment-seam/native.ts";
import type { AttachmentReceipt } from "../../packages/contracts/attachments.ts";

const consent = (receipt: AttachmentReceipt) => ({ receiptId: receipt.receiptId, resultDigest: receipt.resultDigest,
  draftRevision: receipt.draftRevision, authorityGeneration: receipt.authorityGeneration,
  acceptedDegradations: [...new Set(receipt.items.flatMap(item => item.status === "ready" ? item.degradations : []))] });

test("actual public native prepared kinds refuse before reservation and preserve an idle prompt receipt", async () => {
  const fixture = await NativeAttachmentFixture.open(() => "synthetic-authenticated-operator");
  try {
    const selected = fixture.select({ formats: ["utf8"], message: "supported plain prompt" });
    const receipt = await fixture.bridge.prepare(selected.selection); expect(receipt.status).toBe("ready");
    const before = await fixture.effects();
    for (const inputType of ["steer", "follow_up", "abort_and_prompt"] as const) {
      const key = `unsupported-${inputType}`;
      await expect(fixture.transport.submissions.submit({ ...fixture.target, clientSubmissionId: key,
        preparationId: receipt.preparationId, inputType, message: selected.message, preparationConsent: consent(receipt) }))
        .rejects.toThrow("ATTACHMENT_INPUT_KIND_UNSUPPORTED");
      expect(await fixture.transport.submissions.query(key)).toMatchObject({ found: false, reservation: "absent", relations: [] });
    }
    expect(await fixture.effects()).toEqual(before);
    const submitted = await fixture.transport.submissions.submit({ ...fixture.target, clientSubmissionId: "supported-idle",
      preparationId: receipt.preparationId, inputType: "prompt", message: selected.message, preparationConsent: consent(receipt) });
    expect(submitted.reservation).toBe("committed");
    let result = submitted;
    for (let index = 0; index < 200 && !result.terminal; index++) { await Bun.sleep(25); result = await fixture.transport.submissions.query("supported-idle"); }
    expect(result).toMatchObject({ terminal: true, inputOutcome: "generated", persistence: "committed" });
    const effects = await fixture.effects(); expect(effects).toMatchObject({ inputCalls: 1, modelDispatches: 1 });
  } finally { expect(await fixture.close()).toMatchObject({ drain: { code: 0, forced: false } }); }
}, 30_000);

test("actual builtin route refuses attachments before /retry effects without treating unknown slash text as a builtin", async () => {
  const fixture = await NativeAttachmentFixture.open(() => "synthetic-authenticated-operator");
  try {
    const selected = fixture.select({ formats: ["utf8"], message: "/retry" });
    const receipt = await fixture.bridge.prepare(selected.selection), before = await fixture.effects();
    await expect(fixture.transport.submissions.submit({ ...fixture.target, clientSubmissionId: "builtin-refused",
      preparationId: receipt.preparationId, inputType: "prompt", message: selected.message, preparationConsent: consent(receipt) }))
      .rejects.toThrow("ATTACHMENT_BUILTIN_INPUT_UNSUPPORTED");
    expect(await fixture.transport.submissions.query("builtin-refused")).toMatchObject({ reservation: "absent", found: false });
    expect(await fixture.effects()).toEqual(before);
    await fixture.bridge.cancel({ selection: selected.selection, preparationId: receipt.preparationId });
    const literal = fixture.select({ formats: ["utf8"], message: "/not-a-native-command literal text" });
    const prepared = await fixture.bridge.prepare(literal.selection);
    const accepted = await fixture.transport.submissions.submit({ ...fixture.target, clientSubmissionId: "unknown-native-literal",
      preparationId: prepared.preparationId, inputType: "prompt", message: literal.message, preparationConsent: consent(prepared) });
    expect(accepted.reservation).toBe("committed");
    let result = accepted;
    for (let index = 0; index < 200 && !result.terminal; index++) { await Bun.sleep(25); result = await fixture.transport.submissions.query("unknown-native-literal"); }
    expect(result).toMatchObject({ inputOutcome: "generated", persistence: "committed", terminal: true });
  } finally { expect(await fixture.close()).toMatchObject({ drain: { code: 0, forced: false } }); }
}, 30_000);
