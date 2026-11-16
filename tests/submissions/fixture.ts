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
