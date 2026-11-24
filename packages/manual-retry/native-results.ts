import { randomUUID } from "node:crypto";
import { inspectSubmissionPage, submissionPublication } from "../contracts/submission-reply.ts";
import type { SubmissionClientCommand } from "../contracts/candidates/durable-submission-v1/submission-client.ts";
import type { SubmissionResult } from "../contracts/candidates/durable-submission-v1/omp-wire.ts";

const submitPageSize = 64;
const queryPageSize = 128;
const pagesPerLookup = 32;

interface ReceiptFacts {
  readonly receipt: SubmissionResult;
  readonly invoked: boolean;
}
interface Continuation {
  readonly offset: number;
  readonly publication: string;
  readonly invoked: boolean;
  readonly seen: Set<string>;
}

export function validateSubmitReceipt(receipt: SubmissionResult | undefined): ReceiptFacts | undefined {
  if (!receipt) return;
  const invoked = inspectSubmissionPage(receipt, 0, submitPageSize, new Set())?.invoked;
  if (invoked !== undefined) return { receipt, invoked };
}

/** Retain only bounded, verified facts for one attempt. The caller verifies the exact reservation, target and origin. */
export class ReceiptLookup {
  #continuation: Continuation | undefined;

  async read(requestId: string, request: (command: SubmissionClientCommand) => Promise<SubmissionResult | undefined>,
    current: () => boolean): Promise<ReceiptFacts | undefined> {
    for (let read = 0; read < pagesPerLookup && current(); read++) {
      const saved = this.#continuation;
      const offset = saved?.offset ?? 0;
      const page = await request({ type: "submission_query", id: randomUUID(), clientSubmissionId: requestId,
        limit: queryPageSize, ...(offset === 0 ? {} : { offset }) });
      if (!current()) return;
      this.#continuation = undefined;
      if (!page) return;
      const publication = submissionPublication(page);
      if (saved && publication !== saved.publication) return;
      const seen = saved?.seen ?? new Set<string>();
      const pageInvoked = inspectSubmissionPage(page, offset, queryPageSize, seen)?.invoked;
      if (pageInvoked === undefined) return;
      if (!page.terminal || page.persistence !== "committed" || page.inputOutcome !== "no_input"
        || page.operationOutcome === "unknown") return { receipt: page, invoked: false };
      const invoked = (saved?.invoked ?? false) || pageInvoked;
      if (page.nextOffset === null) return { receipt: page, invoked };
      this.#continuation = { offset: page.nextOffset, publication, invoked, seen };
    }
  }
}
