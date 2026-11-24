import { expect, test } from "bun:test";
import { readSubmissionRecords, submissionRecord } from "../../../vendor/omp/packages/coding-agent/src/session/submission-records";

const origin = { sourceId: "a".repeat(64), instanceId: "b".repeat(64), nativeSessionId: "synthetic", clientSubmissionId: "attempt" };
const link = { originalId: "image", preparedId: "prepared-image", originalSha256: "c".repeat(64),
  preparedSha256: "d".repeat(64), representationKind: "image", entryPart: { kind: "content", index: 2 } };
const base = { origin, fingerprint: "e".repeat(64), preparationId: "preparation", terminal: true,
  operationOutcome: "succeeded", inputOutcome: "generated", noEntries: [], entryFacts: [{ entryId: "user", role: "input", attachments: [link] }] };

test("later checksummed native records cannot forget or move a committed attachment's saved part", () => {
  for (const attachments of [undefined, [], [{ ...link, entryPart: { kind: "content", index: 3 } }],
    [{ ...link, preparedSha256: "f".repeat(64) }]]) {
    const next = { ...base, entryFacts: [{ entryId: "user", role: "input", ...(attachments ? { attachments } : {}) }] };
    expect(() => readSubmissionRecords([submissionRecord(base), submissionRecord(next)]))
      .toThrow("SUBMISSION_METADATA_CONFLICT");
  }
});

test("permanent native omission facts retain their exact attachment relation", () => {
  const { entryPart: _part, ...manifest } = link;
  const missing = { ...manifest, entryPartUnavailable: "missing" };
  const record = { ...base, entryFacts: [], noEntries: [{ relationId: "dropped", role: "prepared", status: "no_entry",
    reason: "native_context_replaced", attachments: [missing] }] };
  const changed = { ...record, noEntries: [{ ...record.noEntries[0], attachments: [{ ...manifest, entryPartUnavailable: "changed" }] }] };
  expect(() => readSubmissionRecords([submissionRecord(record), submissionRecord(changed)])).toThrow("SUBMISSION_METADATA_CONFLICT");
  const same = { ...record, noEntries: [{ ...record.noEntries[0], attachments: [{ entryPartUnavailable: "missing", ...manifest }] }] };
  expect(readSubmissionRecords([submissionRecord(record), submissionRecord(same)])[0].noEntries).toEqual(record.noEntries);
});
