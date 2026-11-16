import { expect, test } from "bun:test";
import { NativeAttachmentFixture } from "../../experiments/attachment-seam/native.ts";
import { isSubmissionResult } from "../../packages/contracts/submissions.ts";
import type { HistoryItem } from "../../packages/contracts/generated/omp-wire.ts";

test("genuine native skill, file command and prompt template expansions preserve the exact staged bundle", async () => {
  const fixture = await NativeAttachmentFixture.open(() => "synthetic-authenticated-operator", { nativeExpansions: true });
  try {
    let serial = 0;
    for (const [message, expanded] of [["/skill:attachment-proof", "NATIVE SKILL PROOF"],
      ["/attachment-file argument", "NATIVE FILE EXPANSION argument"],
      ["/attachment-template argument", "NATIVE TEMPLATE EXPANSION argument"]]) {
      const selected = fixture.select({ formats: ["png", "utf8"], message: message! });
      const before = await fixture.effects(); const receipt = await fixture.bridge.prepare(selected.selection);
      expect(receipt.status).toBe("ready"); expect(await fixture.effects()).toEqual(before);
      const key = `expanded-${++serial}`;
      const accepted = await fixture.bridge.consent({ selection: selected.selection, receiptId: receipt.receiptId,
        resultDigest: receipt.resultDigest, acceptedDegradations: [...new Set(receipt.items.flatMap(item => item.status === "ready" ? item.degradations : []))] });
      const requestId = crypto.randomUUID();
      await fixture.bridge.bind({ selection: selected.selection, consentId: accepted.consentId, submissionId: key, requestId });
      const submitted = await fixture.bridge.submitForRequest(requestId);
      if (!isSubmissionResult(submitted)) throw Error("EXPANSION_NATIVE_RESULT_SCHEMA");
      let result = submitted;
      for (let index = 0; index < 200 && !result.terminal; index++) { await Bun.sleep(25); result = await fixture.transport.submissions.query(key); }
      expect(result).toMatchObject({ terminal: true, inputOutcome: "generated", persistence: "committed" });
      const input = result.relations.find(relation => relation.role === "input" && relation.persistence === "committed");
      expect(input?.attachments).toContainEqual(expect.objectContaining({ originalId: "original-png" }));
      expect(result.relations).toContainEqual(expect.objectContaining({ role: "prepared", persistence: "committed",
        attachments: [expect.objectContaining({ originalId: "original-utf8" })] }));
      const snapshot = await fixture.transport.history.open("active"), items: HistoryItem[] = [];
      let cursor: string | undefined = snapshot.cursor;
      while (cursor) { const page = await fixture.transport.history.page(cursor); items.push(...page.items); cursor = page.nextCursor; }
      const parts: string[] = [];
      for (const item of items.filter(item => item.entryId === input?.entryId)) {
        parts.push(item.text);
        for (const content of item.contents ?? []) if (content.mimeType.startsWith("text/") || content.mimeType.includes("json")) {
          let partCursor: string | undefined = content.cursor;
          while (partCursor) { const part = await fixture.transport.history.content(partCursor);
            parts.push(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.from(part.data, "base64"))); partCursor = part.nextCursor; }
        }
      }
      await fixture.transport.history.close(snapshot.snapshot);
      expect(parts.join("\n")).toContain(expanded!);
      expect(await fixture.effects()).toMatchObject({ modelDispatches: serial });
    }
  } finally { expect(await fixture.close()).toMatchObject({ drain: { code: 0, forced: false } }); }
}, 40_000);
