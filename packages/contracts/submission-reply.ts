import { createHash } from "node:crypto";
import validateCommand from "./candidates/durable-submission-v1/submission-command.js";
import validateResult from "./candidates/durable-submission-v1/submission-result.js";
import type { SubmissionClientCommand } from "./candidates/durable-submission-v1/submission-client.ts";
import type { SubmissionResult, SubmissionTarget } from "./candidates/durable-submission-v1/omp-wire.ts";
import { validResponse } from "./preflight.ts";

export const submissionBusy = Symbol("native submission busy");
export const submissionConflict = Symbol("native submission conflict");
export type SubmissionReply = SubmissionResult | typeof submissionBusy | typeof submissionConflict | undefined;

export const sameSubmissionTarget = (a: SubmissionTarget, b: SubmissionTarget) =>
  a.sourceId === b.sourceId && a.instanceId === b.instanceId && a.nativeSessionId === b.nativeSessionId;

/** Candidate RPC adapter for already-matched, worker-owned public transports. */
export async function requestLocalSubmission(
  target: SubmissionTarget, command: SubmissionClientCommand,
  request: (command: SubmissionClientCommand) => Promise<unknown>,
): Promise<SubmissionReply> {
  if (!validateCommand(command)) return;
  const response = await request(command);
  if (!validResponse(response) || response.id !== command.id || response.command !== command.type) return;
  if (!response.success) {
    if (command.type === "submission_submit") {
      if (response.code === "SUBMISSION_BUSY") return submissionBusy;
      if (response.code === "SUBMISSION_CONFLICT") return submissionConflict;
    }
    return;
  }
  if (!validateResult(response.data)) return;
  const result = response.data as SubmissionResult;
  if (result.found && result.admission === "local" && result.reservation === "committed" && result.origin
    && sameSubmissionTarget(result.target, target) && sameSubmissionTarget(result.origin, target)
    && result.clientSubmissionId === command.clientSubmissionId
    && result.origin.clientSubmissionId === command.clientSubmissionId) return result;
}

const maxRelations = 100_000 + 4096;

export function inspectSubmissionPage(page: SubmissionResult, offset: number, limit: number, seen: Set<string>) {
  const { relations, nextOffset } = page;
  const end = offset + relations.length;
  if (relations.length > limit || end > maxRelations || (offset !== 0 && relations.length === 0)
    || (nextOffset !== null && (relations.length !== limit || nextOffset !== end || end >= maxRelations))) return;
  let invoked = false, committedInput = false;
  for (const relation of relations) {
    if (page.inputOutcome === "no_input" && relation.role === "input"
      && (relation.status === "observed" || relation.entryId !== undefined)) return;
    const id = createHash("sha256").update(relation.relationId).digest("base64");
    if (seen.has(id)) return;
    seen.add(id);
    if (relation.role !== "input" || relation.persistence !== "committed") continue;
    invoked ||= relation.status === "no_entry" && relation.entryId === undefined
      && relation.reason === "native_builtin_consumed";
    committedInput ||= page.inputOutcome === "generated" && relation.status === "observed" && !!relation.entryId;
  }
  return { invoked, committedInput };
}

/** The request adapter checks target, origin and reservation before a page reaches this comparison. */
export function submissionPublication(page: SubmissionResult): string {
  const facts = [page.version, page.duplicate, page.terminal, page.persistence,
    page.inputOutcome, page.operationOutcome, page.code];
  return createHash("sha256").update(JSON.stringify(facts)).digest("base64");
}
