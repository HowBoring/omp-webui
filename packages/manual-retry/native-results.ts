import { randomUUID } from "node:crypto";
import type { SubmissionClientCommand } from "../contracts/candidates/durable-submission-v1/submission-client.ts";
import type { SubmissionResult } from "../contracts/candidates/durable-submission-v1/omp-wire.ts";

const pageSize = 128;
const pageLimit = 32;
interface ReceiptFacts {
  readonly receipt: SubmissionResult;
  readonly invoked: boolean;
}

export function consumedBuiltin(receipt: SubmissionResult | undefined): boolean {
  return receipt?.relations.some(relation => relation.role === "input" && relation.status === "no_entry"
    && relation.persistence === "committed" && relation.entryId === undefined
    && relation.reason === "native_builtin_consumed") ?? false;
}

/** The caller verifies the exact committed reservation, target and origin for every page. */
export async function queryReceipt(requestId: string,
  request: (command: SubmissionClientCommand) => Promise<SubmissionResult | undefined>,
  current: () => boolean): Promise<ReceiptFacts | undefined> {
  let first: SubmissionResult | undefined;
  let offset = 0;
  let invoked = false;
  const seen = new Set<string>();
  for (let read = 0; read < pageLimit && current(); read++) {
    const page = await request({ type: "submission_query", id: randomUUID(), clientSubmissionId: requestId,
      limit: pageSize, ...(offset === 0 ? {} : { offset }) });
    if (!current() || !page || !validPage(page, offset, seen)
      || (first && !samePublication(first, page))) return;
    first ??= { ...page };
    if (!page.terminal || page.persistence !== "committed" || page.inputOutcome !== "no_input"
      || page.operationOutcome === "unknown") return { receipt: first, invoked: false };
    if (page.relations.some(relation => relation.role === "input"
      && (relation.status === "observed" || relation.entryId !== undefined))) return;
    invoked ||= consumedBuiltin(page);
    if (page.nextOffset === null) return { receipt: first, invoked };
    offset = page.nextOffset;
  }
}

function validPage(page: SubmissionResult, offset: number, seen: Set<string>): boolean {
  const { relations, nextOffset } = page;
  if (relations.length > pageSize || (offset !== 0 && relations.length === 0)
    || (nextOffset !== null && (relations.length !== pageSize || nextOffset !== offset + pageSize))) return false;
  for (const relation of relations) {
    if (seen.has(relation.relationId)) return false;
    seen.add(relation.relationId);
  }
  return true;
}

function samePublication(first: SubmissionResult, page: SubmissionResult): boolean {
  return page.version === first.version && page.duplicate === first.duplicate && page.terminal === first.terminal
    && page.persistence === first.persistence && page.inputOutcome === first.inputOutcome
    && page.operationOutcome === first.operationOutcome && page.code === first.code;
}
