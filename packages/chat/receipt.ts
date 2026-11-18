import { randomUUID } from "node:crypto";
import type { SubmissionClientCommand } from "../contracts/candidates/durable-submission-v1/submission-client.ts";
import type { SubmissionResult } from "../contracts/candidates/durable-submission-v1/omp-wire.ts";
import { inspectSubmissionPage, submissionBusy, submissionPublication } from "../contracts/submission-reply.ts";

const pageSize = 128;
const pagesPerLookup = 32;

export interface ChatReceipt {
  readonly terminal: boolean;
  readonly persistence: SubmissionResult["persistence"];
  readonly inputOutcome: SubmissionResult["inputOutcome"];
  readonly operationOutcome: SubmissionResult["operationOutcome"];
  readonly committedInput: boolean;
  readonly completeNoInput: boolean;
}

export function receiptFacts(receipt: SubmissionResult, committedInput = false, completeNoInput = false): ChatReceipt {
  return { terminal: receipt.terminal, persistence: receipt.persistence, inputOutcome: receipt.inputOutcome,
    operationOutcome: receipt.operationOutcome, committedInput, completeNoInput };
}

/** Query authoritative relations within one bounded, internally consistent Native publication. */
export async function readChatReceipt(requestId: string, current: () => void,
  request: (command: SubmissionClientCommand) => Promise<SubmissionResult | typeof submissionBusy | undefined>,
): Promise<ChatReceipt | undefined> {
  const seen = new Set<string>();
  let offset = 0, publication: string | undefined;
  for (let count = 0; count < pagesPerLookup; ++count) {
    current();
    const command = { type: "submission_query", id: randomUUID(), clientSubmissionId: requestId,
      limit: pageSize, ...(offset === 0 ? {} : { offset }) } as const;
    const receipt = await request(command).catch(() => undefined);
    current();
    if (!receipt || receipt === submissionBusy) return;
    const identity = submissionPublication(receipt);
    if (publication && identity !== publication) return;
    publication = identity;
    const facts = inspectSubmissionPage(receipt, offset, pageSize, seen);
    if (!facts) return;
    if (facts.committedInput) return receiptFacts(receipt, true);
    const noInput = receipt.terminal && receipt.persistence === "committed" && receipt.inputOutcome === "no_input";
    if (receipt.nextOffset === null) return receiptFacts(receipt, false, noInput);
    if (receipt.inputOutcome === "unresolved") return receiptFacts(receipt);
    offset = receipt.nextOffset;
  }
}
