import { expect, test } from "bun:test";
import type { SubmissionClientCommand } from "../../packages/contracts/candidates/durable-submission-v1/submission-client.ts";
import type { SubmissionResult, SubmissionTarget } from "../../packages/contracts/candidates/durable-submission-v1/omp-wire.ts";
import {
  inspectSubmissionPage, requestLocalSubmission, submissionPublication, type SubmissionReply,
} from "../../packages/contracts/submission-reply.ts";
import { readChatReceipt, type ChatReceipt } from "../../packages/chat/receipt.ts";
import recorded from "./fixtures/submission-native.json";

// Outputs of the unregistered Source38 candidate's real worker and native copy/branch operations.
// See compatibility/omp/candidates/native-cohort-38/submission-fault-runtime.md for the run and commands.
type HistoryItem = {
  id: string; role: string | null; text: string | null;
  submission: { role: string; origin: SubmissionTarget & { clientSubmissionId: string } } | null;
};
type Case = {
  target: SubmissionTarget; final: SubmissionResult; snapshots: SubmissionResult[];
  history?: HistoryItem[]; providerCalls?: { calls: number; realInference: boolean };
};

const fixture = recorded as unknown as {
  normal: Case & { submit: SubmissionResult; immediate: SubmissionResult; history: HistoryItem[]; providerCalls: { calls: number } };
  transform: Case & { submittedText: string; submit: SubmissionResult; history: HistoryItem[] };
  handled: Case & { submittedText: string; submit: SubmissionResult; history: HistoryItem[] };
  lostAck: Case & { faultReplyDelivered: boolean };
  crashBeforeQuery: { target: SubmissionTarget; snapshots: SubmissionResult[]; ack: SubmissionResult };
  writeFailure: { target: SubmissionTarget; ack: SubmissionResult; snapshots: SubmissionResult[];
    syscalls: string[]; providerCalls: { calls: number; realInference: boolean } };
  copy: { target: SubmissionTarget; query: SubmissionResult; originalTarget: SubmissionTarget;
    originalFinal: SubmissionResult };
  branch: { target: SubmissionTarget; query: SubmissionResult; originalTarget: SubmissionTarget;
    originalFinal: SubmissionResult };
  compatibility: { currentReader: { ready: string; entriesSuccess: boolean; entryCount: number; exit: number;
      history: HistoryItem[] };
    oldNative: { exit: number; error: string; stdout: string } };
};

async function receipt(key: string, target: SubmissionTarget, data: SubmissionResult): Promise<ChatReceipt | undefined> {
  return readChatReceipt(key, () => {}, (command: SubmissionClientCommand): Promise<SubmissionReply> =>
    requestLocalSubmission(target, command, async () =>
      ({ type: "response", id: command.id, command: command.type, success: true, data: structuredClone(data) })));
}

const relations = (result: SubmissionResult | null) => result?.relations ?? [];

test("a local receipt proves the committed input and retains every native relation", async () => {
  const { target, submit, immediate, final, history, providerCalls } = fixture.normal;
  const key = "normal-1";

  expect(await requestLocalSubmission(target, { id: "ack", type: "submission_query", clientSubmissionId: key },
    async () => ({ type: "response", id: "ack", command: "submission_query", success: true, data: submit })))
    .toMatchObject({ reservation: "committed", inputOutcome: "unresolved", terminal: false });
  expect(await receipt(key, target, submit)).toMatchObject({
    terminal: false, persistence: "unresolved", committedInput: false });
  expect(immediate.relations).toEqual([]);

  expect(await requestLocalSubmission(target, { id: "query", type: "submission_query", clientSubmissionId: key },
    async () => ({ type: "response", id: "query", command: "submission_query", success: true, data: final })))
    .toMatchObject({ origin: { ...target, clientSubmissionId: key }, terminal: true, persistence: "committed" });
  expect(inspectSubmissionPage(final, 0, 128, new Set())).toEqual({ invoked: false, committedInput: true });
  expect(await receipt(key, target, final)).toMatchObject({
    terminal: true, persistence: "committed", inputOutcome: "generated", operationOutcome: "succeeded",
    committedInput: true, completeNoInput: false, invoked: false });
  expect(relations(final).map(relation => relation.role)).toEqual(["additional", "input", "additional", "execution"]);
  expect(history.find(item => item.id === relations(final).find(relation => relation.role === "input")?.entryId))
    .toMatchObject({
    text: "hello probe", submission: { role: "input", origin: { ...target, clientSubmissionId: key } } });
  expect(providerCalls).toEqual({ calls: 1, realInference: false });
});

test("an extension-transformed input keeps its native entry and source without text matching", async () => {
  const { target, submittedText, final, history } = fixture.transform;
  const input = relations(final).find(relation => relation.role === "input");
  const historyInput = history.find(item => item.id === input?.entryId);

  expect(final).toMatchObject({ inputOutcome: "generated", persistence: "committed", terminal: true });
  expect(input).toMatchObject({ status: "observed", persistence: "committed", availability: "retained" });
  expect(historyInput?.text).toBe("equal transformed input");
  expect(historyInput?.text).not.toBe(submittedText);
  expect(historyInput?.submission).toEqual({
    role: "input", origin: { ...target, clientSubmissionId: "transform-1" } });
  expect(relations(final).filter(relation => relation.role !== "input").length).toBeGreaterThanOrEqual(3);
  expect(await receipt("transform-1", target, final)).toMatchObject({ committedInput: true, terminal: true });
});

test("a handled builtin publishes no input relation and a complete no-input receipt", async () => {
  const { target, submit, final, history } = fixture.handled;

  expect(submit).toMatchObject({ inputOutcome: "no_input", terminal: true, reservation: "committed" });
  expect(await receipt("handled-1", target, submit)).toMatchObject({
    terminal: true, inputOutcome: "no_input", committedInput: false, completeNoInput: true });
  expect(relations(final).find(relation => relation.role === "input")).toBeUndefined();
  expect(relations(final)).toHaveLength(1);
  expect(relations(final)[0]).toMatchObject({ status: "observed", persistence: "committed" });
  expect(history.find(item => item.id === relations(final)[0]?.entryId)?.submission?.origin.clientSubmissionId)
    .toBe("handled-1");
  expect(inspectSubmissionPage(final, 0, 128, new Set())).toEqual({ invoked: false, committedInput: false });
  expect(submissionPublication(final)).not.toBe(submissionPublication(fixture.normal.final!));
});

test("a delayed first write is unresolved rather than durable proof", async () => {
  const { target, immediate, snapshots, final } = fixture.normal;

  expect(immediate.relations).toEqual([]);
  expect(await receipt("normal-1", target, fixture.normal.submit)).toMatchObject({
    terminal: false, persistence: "unresolved", inputOutcome: "unresolved", committedInput: false });
  const observed = snapshots.find(page => page.inputOutcome === "generated");
  expect(observed).toMatchObject({ persistence: "unresolved", terminal: false });
  expect(observed && inspectSubmissionPage(observed, 0, 128, new Set())?.committedInput).toBe(true);
  expect(final).toMatchObject({ persistence: "committed", terminal: true });
});

test("a successor recovers a lost acknowledgement without a second native execution", async () => {
  const { target, faultReplyDelivered, final, providerCalls } = fixture.lostAck;

  expect(faultReplyDelivered).toBe(false);
  expect(await receipt("lost-ack-1", target, final)).toMatchObject({ terminal: true, committedInput: true });
  expect(relations(final).find(relation => relation.role === "input")).toMatchObject({
    status: "observed", persistence: "committed" });
  expect(providerCalls).toEqual({ calls: 1, realInference: false });
});

test("a crash before any query stays pending and is never converted to an absence", async () => {
  const { target, snapshots, ack } = fixture.crashBeforeQuery;

  expect(snapshots.length).toBeGreaterThan(0);
  for (const page of snapshots) expect(page).toMatchObject({
    found: true, admission: "local", reservation: "committed", persistence: "unresolved", terminal: false });
  expect(snapshots.at(-1)).toMatchObject({ found: true, reservation: "committed", terminal: false });
  expect(await requestLocalSubmission(target,
    { id: "q", type: "submission_query", clientSubmissionId: "crash-1" },
    async () => ({ type: "response", id: "q", command: "submission_query", success: true, data: ack })))
    .toMatchObject({ found: true, reservation: "committed" });
  expect(await receipt("crash-1", target, ack)).toMatchObject({ terminal: false, committedInput: false });
});

test("a write failure stays unknown and never reports a committed receipt", async () => {
  const { target, ack, snapshots, syscalls, providerCalls } = fixture.writeFailure;
  const last = snapshots.at(-1)!;

  expect(ack).toMatchObject({ reservation: "committed", persistence: "unresolved", terminal: false });
  expect(last).toMatchObject({ found: false, admission: "absent", code: "SUBMISSION_SOURCE_UNREADABLE" });
  expect(await requestLocalSubmission(target,
    { id: "q", type: "submission_query", clientSubmissionId: "write-fault-1" },
    async () => ({ type: "response", id: "q", command: "submission_query", success: true, data: last }))).toBeUndefined();
  expect(await receipt("write-fault-1", target, last)).toBeUndefined();
  expect(syscalls.some(line => line.includes('"event":"submission-short-entry"')
    && line.includes('"actual_written":20') && line.includes('"injected_return":-28'))).toBe(true);
  expect(providerCalls).toEqual({ calls: 1, realInference: false });
});

test("a native copy or branch inherits the original source, never a new local admission", async () => {
  for (const copy of [fixture.copy, fixture.branch]) {
    const originals = new Set(relations(copy.originalFinal).map(relation => relation.entryId));
    expect(copy.query).toMatchObject({ admission: "inherited", terminal: true, persistence: "committed",
      origin: { ...copy.originalTarget, clientSubmissionId: "copy-1" } });
    expect(copy.target.nativeSessionId).not.toBe(copy.originalTarget.nativeSessionId);
    expect(new Set(relations(copy.query).map(relation => relation.entryId))).toEqual(originals);
    expect(await requestLocalSubmission(copy.target,
      { id: "q", type: "submission_query", clientSubmissionId: "copy-1" },
      async () => ({ type: "response", id: "q", command: "submission_query", success: true, data: copy.query })))
      .toBeUndefined();
  }
});

test("the current reader opens submission metadata while the old native reader refuses it intact", () => {
  const { currentReader, oldNative } = fixture.compatibility;
  const input = currentReader.history.find(item => item.role === "user");

  expect(currentReader).toMatchObject({ ready: "ready", entriesSuccess: true, exit: 0 });
  expect(currentReader.entryCount).toBeGreaterThan(0);
  expect(input).toMatchObject({ text: "hello probe", submission: { role: "input" } });
  expect(oldNative.exit).not.toBe(0);
  expect(oldNative.stdout).toBe("");
  expect(oldNative.error).toContain("the session header is missing or malformed");
  expect(oldNative.error).toContain("The file was not modified.");
});
