import { createHash, randomUUID } from "node:crypto";
import type { SubmissionClientCommand } from "../contracts/candidates/durable-submission-v1/submission-client.ts";
import type { SubmissionResult } from "../contracts/candidates/durable-submission-v1/omp-wire.ts";

const submitPageSize = 64;
const queryPageSize = 128;
const pagesPerLookup = 32;
// Native submission policy allows 100,000 committed entry facts plus 4,096 no-entry facts.
const maxRelations = 100_000 + 4096;

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
  const invoked = inspectPage(receipt, 0, submitPageSize, new Set());
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
      const publication = publicationKey(page);
      if (saved && publication !== saved.publication) return;
      const seen = saved?.seen ?? new Set<string>();
      const pageInvoked = inspectPage(page, offset, queryPageSize, seen);
      if (pageInvoked === undefined) return;
      if (!page.terminal || page.persistence !== "committed" || page.inputOutcome !== "no_input"
        || page.operationOutcome === "unknown") return { receipt: page, invoked: false };
      const invoked = (saved?.invoked ?? false) || pageInvoked;
      if (page.nextOffset === null) return { receipt: page, invoked };
      this.#continuation = { offset: page.nextOffset, publication, invoked, seen };
    }
  }
}

function inspectPage(page: SubmissionResult, offset: number, limit: number, seen: Set<string>): boolean | undefined {
  const { relations, nextOffset } = page;
  const end = offset + relations.length;
  if (relations.length > limit || end > maxRelations || (offset !== 0 && relations.length === 0)
    || (nextOffset !== null && (relations.length !== limit || nextOffset !== end || end >= maxRelations))) return;
  let invoked = false;
  for (const relation of relations) {
    if (page.inputOutcome === "no_input" && relation.role === "input"
      && (relation.status === "observed" || relation.entryId !== undefined)) return;
    // Retain fixed-size digests independent of the lengths of Native relation IDs.
    const id = createHash("sha256").update(relation.relationId).digest("base64");
    if (seen.has(id)) return;
    seen.add(id);
    invoked ||= relation.role === "input" && relation.status === "no_entry" && relation.persistence === "committed"
      && relation.entryId === undefined && relation.reason === "native_builtin_consumed";
  }
  return invoked;
}

function publicationKey(page: SubmissionResult): string {
  const facts = [page.version, page.duplicate, page.terminal, page.persistence, page.inputOutcome,
    page.operationOutcome, page.code];
  return createHash("sha256").update(JSON.stringify(facts)).digest("base64");
}
