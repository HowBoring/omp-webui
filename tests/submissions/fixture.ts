import validateHistoryOpen from "../../packages/contracts/generated/history-open.js";
import validateHistoryPage from "../../packages/contracts/generated/history-page.js";
import type { HistoryOpen, HistoryPage, HistoryItem } from "../../packages/contracts/generated/omp-wire.ts";
import * as path from "node:path";
import validateResult from "../../packages/contracts/generated/submission-result.js";
import type { SubmissionResult } from "../../packages/contracts/generated/omp-wire.ts";
import type { StrictFrame } from "../continuation/worker.ts";
export const controlledRuntime = ["--offline", "--model", "submission-controlled/literal", "--no-lsp", "--no-skills", "--no-rules",
  "--no-spotlight", "--no-judge", "--no-context-files", "--trusted-extension", path.resolve("compatibility/omp/fixtures/submission-provider.ts")];
export function decodeSubmission(frame: StrictFrame): SubmissionResult {
  if (frame.success !== true || !validateResult(frame.data)) throw Error("SUBMISSION_FIXTURE_RESULT_SCHEMA");
  return frame.data as SubmissionResult;
}
export async function terminalSubmission(worker: { request(command: object): Promise<StrictFrame> }, clientSubmissionId: string): Promise<SubmissionResult> {
  for (let attempt = 0; attempt < 200; attempt++) {
    const result = decodeSubmission(await worker.request({ type: "submission_query", clientSubmissionId }));
    if (result.terminal || result.persistence === "failed" || result.persistence === "unknown") return result;
    await Bun.sleep(25);
  }
  throw Error("SUBMISSION_FIXTURE_TERMINAL_TIMEOUT");
}

/** Public immutable history pages, validated against the same-source generated contract. */
export async function submissionHistory(worker: { request(command: object): Promise<StrictFrame> }, scope: "tree" | "running" = "tree"): Promise<HistoryItem[]> {
  const opened = await worker.request({ type: "history_snapshot_open", scope });
  if (opened.success !== true || !validateHistoryOpen(opened.data)) throw Error("SUBMISSION_HISTORY_OPEN_SCHEMA");
  const open = opened.data as HistoryOpen, items: HistoryItem[] = [];
  let cursor: string | undefined = open.cursor;
  try {
    for (let pageIndex = 0; cursor && pageIndex < 200; pageIndex++) {
      const frame = await worker.request({ type: "history_snapshot_page", cursor });
      if (frame.success !== true || !validateHistoryPage(frame.data)) throw Error("SUBMISSION_HISTORY_PAGE_SCHEMA");
      const page = frame.data as HistoryPage;
      items.push(...page.items); cursor = page.nextCursor;
    }
    if (cursor) throw Error("SUBMISSION_HISTORY_PAGE_LIMIT");
    return items;
  } finally { await worker.request({ type: "history_snapshot_close", snapshot: open.snapshot }); }
}
