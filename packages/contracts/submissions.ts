/** Public native submission boundary. This data is identity/provenance metadata, never transcript storage. */
import validate from "./generated/submission-result.js";
import type { SubmissionResult } from "./generated/omp-wire.ts";
export type { SubmissionResult, SubmissionRelation, SubmissionTarget } from "./generated/omp-wire.ts";
export { SubmissionClient } from "./generated/submission-client.ts";
export function isSubmissionResult(value: unknown): value is SubmissionResult { return validate(value); }
