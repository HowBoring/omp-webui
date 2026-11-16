/** Pure native serialized-data seam; no worker, provider, disk or internal collaborator mocks. */
import { expect, test } from "bun:test";
import { readSubmissionRecords, submissionRecord } from "../../vendor/omp/packages/coding-agent/src/session/submission-records.ts";
const reserved = {
    origin: { sourceId: "1".repeat(64), instanceId: "2".repeat(64), nativeSessionId: "native-fixture", clientSubmissionId: "permanent-id" },
    fingerprint: "3".repeat(64), preparationId: "preparation", terminal: false, inputOutcome: "unresolved", noEntries: [],
};
test("a later validly checksummed native record cannot forget a committed entry fact", () => {
    const completed = { ...reserved, terminal: true, inputOutcome: "generated",
        entryFacts: [{ entryId: "committed-input", role: "input" }] };
    expect(() => readSubmissionRecords([submissionRecord(completed), submissionRecord({ ...completed, entryFacts: [] })]))
        .toThrow("SUBMISSION_METADATA_CONFLICT");
});
test("a later native record cannot forget a committed no-entry decision", () => {
    const completed = { ...reserved, terminal: true, inputOutcome: "no_input",
        noEntries: [{ relationId: "settled-empty-response", role: "execution", status: "no_entry", reason: "empty_error" }] };
    expect(() => readSubmissionRecords([submissionRecord(completed), submissionRecord({ ...completed, noEntries: [] })]))
        .toThrow("SUBMISSION_METADATA_CONFLICT");
});
test("a committed generated input outcome cannot become unresolved or no-input", () => {
    const completed = { ...reserved, terminal: true, inputOutcome: "generated" };
    expect(() => readSubmissionRecords([submissionRecord(completed), submissionRecord({ ...completed, inputOutcome: "no_input" })]))
        .toThrow("SUBMISSION_METADATA_CONFLICT");
});
test("malformed persisted causal origins fail closed before native proof caching", () => {
    const malformed = { ...submissionRecord(reserved), submission: { origin: null, role: "input" } };
    expect(() => readSubmissionRecords([malformed]))
        .toThrow("SUBMISSION_CAUSALITY_CORRUPT");
});
test("native committed entry facts reject an unknown causal role", () => {
    const malformed = { ...reserved, terminal: true, entryFacts: [{ entryId: "entry", role: "guessed-input" }] };
    expect(() => readSubmissionRecords([submissionRecord(malformed)])).toThrow("SUBMISSION_METADATA_CORRUPT");
});
test("native reservation metadata rejects an empty target identity", () => {
    expect(() => readSubmissionRecords([submissionRecord({ ...reserved, origin: { ...reserved.origin, nativeSessionId: "" } })]))
        .toThrow("SUBMISSION_METADATA_CORRUPT");
});
test("one native receipt cannot assign two roles to the same durable entry", () => {
    const malformed = { ...reserved, entryFacts: [
            { entryId: "same-entry", role: "input" }, { entryId: "same-entry", role: "additional" },
        ] };
    expect(() => readSubmissionRecords([submissionRecord(malformed)])).toThrow("SUBMISSION_METADATA_CORRUPT");
});
test("native metadata keeps original identity and permanent facts while admitting late additional facts", () => {
    const completed = { ...reserved, terminal: true, inputOutcome: "generated",
        entryFacts: [{ entryId: "original-input", role: "input" }] };
    const late = { ...completed, optionalFutureField: { opaque: "retained" }, entryFacts: [
            ...completed.entryFacts, { entryId: "late-additional", role: "additional" },
        ], noEntries: [{ relationId: "empty-response", role: "execution", status: "no_entry", reason: "empty_error" }] };
    expect(readSubmissionRecords([submissionRecord(reserved), submissionRecord(completed), submissionRecord(late), submissionRecord(late)]))
        .toMatchObject([{ origin: { clientSubmissionId: "permanent-id", nativeSessionId: "native-fixture" },
            terminal: true, inputOutcome: "generated", optionalFutureField: { opaque: "retained" },
            entryFacts: [{ entryId: "original-input", role: "input" }, { entryId: "late-additional", role: "additional" }],
            noEntries: [{ relationId: "empty-response", role: "execution", status: "no_entry", reason: "empty_error" }] }]);
});
test("native metadata reader refuses a control row larger than the writer can publish", () => {
    const oversized = { ...reserved, unsupportedPayload: "x".repeat(9 * 1024 * 1024) };
    let decision = "accepted";
    try {
        readSubmissionRecords([submissionRecord(oversized)]);
    }
    catch (error) {
        decision = error instanceof Error ? error.message : "unexpected_failure";
    }
    expect(decision).toBe("SUBMISSION_METADATA_CORRUPT");
});
test("a causal entry without its permanent native reservation is not authenticated metadata", () => {
    const orphan = { type: "custom", id: "orphan-entry", parentId: null,
        timestamp: "2026-01-01T00:00:00.000Z", customType: "extension.note",
        submission: { origin: reserved.origin, role: "additional" } };
    expect(() => readSubmissionRecords([orphan])).toThrow("SUBMISSION_CAUSALITY_ORPHAN");
});
test("native metadata authenticates a retained causal entry against its original reservation", () => {
    const entry = { type: "custom", id: "retained-additional", parentId: null,
        timestamp: "2026-01-01T00:00:00.000Z", customType: "extension.note",
        submission: { origin: reserved.origin, role: "additional" } };
    expect(readSubmissionRecords([submissionRecord(reserved), entry])).toMatchObject([
        { origin: { clientSubmissionId: "permanent-id", nativeSessionId: "native-fixture" }, terminal: false },
    ]);
});
for (const [label, malformed] of [
    ["empty preparation identity", { ...reserved, preparationId: "" }],
    ["empty retained entry identity", { ...reserved, entryFacts: [{ entryId: "", role: "input" }] }],
    ["unbounded decision reason", { ...reserved, noEntries: [{ relationId: "message", role: "execution", status: "no_entry", reason: "x".repeat(1024) }] }],
])
    test(`native metadata rejects ${label}`, () => {
        let decision = "accepted";
        try {
            readSubmissionRecords([submissionRecord(malformed)]);
        }
        catch (error) {
            decision = error instanceof Error ? error.message : "unexpected_failure";
        }
        expect(decision).toBe("SUBMISSION_METADATA_CORRUPT");
    });
test("a durable operation outcome cannot be replaced or forgotten by a later native record", () => {
    const completed = { ...reserved, terminal: true, operationOutcome: "succeeded" };
    expect(() => readSubmissionRecords([submissionRecord(completed), submissionRecord({ ...completed, operationOutcome: "unknown" })]))
        .toThrow("SUBMISSION_METADATA_CONFLICT");
});
test("a malformed persisted operation outcome cannot become a public success fact", () => {
    expect(() => readSubmissionRecords([submissionRecord({ ...reserved, operationOutcome: "acknowledged" })]))
        .toThrow("SUBMISSION_METADATA_CORRUPT");
});
