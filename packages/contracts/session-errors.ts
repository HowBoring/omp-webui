import { isWorkspaceErrorCode } from "./workspace-errors.ts";

/** Matched strict-start/generation failure vocabulary. No arbitrary native message is a public code. */
export const nativeSessionErrorCodes = [
  "GENERATION_ARTIFACT_SCAN_LIMIT",
  "GENERATION_BINDING_MISMATCH",
  "GENERATION_BODY_LIMIT",
  "GENERATION_CARRIER_LIMIT",
  "GENERATION_CARRIER_UNREADABLE",
  "GENERATION_CHANGED_DURING_READ",
  "GENERATION_COMMIT_CORRUPT",
  "GENERATION_COMMIT_OUTCOME_UNKNOWN",
  "GENERATION_CONTENT_CORRUPT",
  "GENERATION_CONTENT_UNAVAILABLE",
  "GENERATION_CONTROL_MISSING",
  "GENERATION_CONTROL_UNAVAILABLE",
  "GENERATION_COUNT_LIMIT",
  "GENERATION_DIRECTORY_INVALID",
  "GENERATION_FORMAT_UNSUPPORTED",
  "GENERATION_HARDLINK_PUBLICATION_UNSUPPORTED",
  "GENERATION_HEADER_ENCODING_UNSUPPORTED",
  "GENERATION_HEAD_CORRUPT",
  "GENERATION_HEAD_MISMATCH",
  "GENERATION_HEAD_STALE_OR_MISSING",
  "GENERATION_INCOMPLETE_TAIL",
  "GENERATION_MARKER_OUTCOME_UNKNOWN",
  "GENERATION_METADATA_CORRUPT",
  "GENERATION_NATIVE_HEADER_INVALID",
  "GENERATION_NESTED_ARTIFACTS_UNSUPPORTED",
  "GENERATION_NOT_REGULAR",
  "GENERATION_PREDECESSOR_MISSING",
  "GENERATION_PREFIX_CORRUPT",
  "GENERATION_RETAINED_BYTES_LIMIT",
  "GENERATION_SHORT_WRITE",
  "STRICT_ALTERNATE_TARGET_FORBIDDEN",
  "STRICT_AUXILIARY_TARGET_FORBIDDEN",
  "STRICT_BINDING_CHANGED",
  "STRICT_BINDING_LOST",
  "STRICT_CANCELLED",
  "STRICT_CANCEL_REQUESTED",
  "STRICT_COMMAND_SCHEMA",
  "STRICT_CWD_MISMATCH",
  "STRICT_CWD_REPLACED",
  "STRICT_DELETE_FORBIDDEN",
  "STRICT_DIRECTORY_REPLACED",
  "STRICT_DRAFT_BYTES_LIMIT",
  "STRICT_FORWARD_BUFFER_LIMIT",
  "STRICT_INCOMPLETE_NATIVE_TAIL",
  "STRICT_INPUT_CLOSED",
  "STRICT_INPUT_LIMIT",
  "STRICT_INVALID_REFERENCE",
  "STRICT_MISSING_OR_INACCESSIBLE",
  "STRICT_NATIVE_HEADER_INVALID",
  "STRICT_NATIVE_ID_CHANGED",
  "STRICT_NATIVE_ID_OR_CWD_CHANGED",
  "STRICT_NEGOTIATION",
  "STRICT_NEGOTIATION_REQUIRED",
  "STRICT_NEW_OUTCOME_UNKNOWN",
  "STRICT_NEW_PATH_MISMATCH",
  "STRICT_NEW_REFERENCE_FORBIDDEN",
  "STRICT_NON_APPEND_WRITE_FORBIDDEN",
  "STRICT_OCCUPIED",
  "STRICT_OUTSIDE_SOURCE",
  "STRICT_OWNERSHIP_UNKNOWN",
  "STRICT_PARTIAL_EOF",
  "STRICT_PLATFORM_UNVALIDATED",
  "STRICT_RELOCATION_FORBIDDEN",
  "STRICT_REPLACED",
  "STRICT_RESERVATION_RELEASED",
  "STRICT_SOURCE_REPLACED",
  "STRICT_STARTUP_FAILED",
  "STRICT_START_ALREADY_ATTEMPTED",
  "STRICT_START_OUTCOME_UNKNOWN",
  "STRICT_STATE_IDENTITY",
  "STRICT_STATE_SCHEMA",
  "STRICT_TARGET_CHANGED",
  "STRICT_WRITER_CLOSED",
  "STRICT_WRITER_TRUNCATE_FORBIDDEN",
  "STRICT_WRITE_CONFLICT",
  "STRICT_WRITE_FAILED",
  "STRICT_WRITE_OUTCOME_UNKNOWN",
] as const;
export const sessionErrorCodes = [
  "INDEX_CURSOR_EXPIRED",
  "INDEX_PAGE_LIMIT",
  "INDEX_RECORD_LIMIT",
  "INDEX_REFERENCE_UNKNOWN",
  "INDEX_SNAPSHOT_LIMIT",
  "INDEX_STORAGE_LIMIT",
  "INDEX_UNAVAILABLE",
  "RPC_NATIVE_REJECTED",
  "SESSION_ATTEMPT_UNAVAILABLE",
  "SESSION_AUTH_REQUIRED",
  "SESSION_BRANCH_IDENTITY_UNCONFIRMED",
  "SESSION_BRANCH_LINEAGE_UNCONFIRMED",
  "SESSION_BRANCH_OUTCOME_UNKNOWN",
  "SESSION_BRANCH_RETAINED_MISMATCH",
  "SESSION_BRANCH_TARGET_UNAVAILABLE",
  "SESSION_CWD_CHANGED",
  "SESSION_CWD_UNKNOWN",
  "SESSION_DIRECTORY_DENIED",
  "SESSION_EXIT_OUTCOME_UNKNOWN",
  "SESSION_EXTERNAL_OWNER",
  "SESSION_FINAL_BINDING_REJECTED",
  "SESSION_HOST_CLOSING",
  "SESSION_HOST_RESTARTED_MANUAL_OPEN_REQUIRED",
  "SESSION_IDLE_EXIT_UNCONFIRMED_PENDING_48",
  "SESSION_INTERACTION_COMMAND_DENIED",
  "SESSION_INTERACTION_UNAVAILABLE",
  "SESSION_MANUAL_OPEN_REQUIRED",
  "SESSION_NATIVE_IDENTITY_UNCONFIRMED",
  "SESSION_NATIVE_INACCESSIBLE",
  "SESSION_NATIVE_INVALID_REFERENCE",
  "SESSION_NATIVE_MISSING",
  "SESSION_NATIVE_REPLACED",
  "SESSION_NATIVE_SOURCE_UNAVAILABLE",
  "SESSION_OPEN_NOT_CONFIRMED",
  "SESSION_OPEN_OUTCOME_UNKNOWN",
  "SESSION_OPEN_RETIRED_OUTCOME_UNKNOWN",
  "SESSION_OWNERSHIP_UNKNOWN",
  "SESSION_PRESENTATION_INVALIDATED",
  "SESSION_SELECTION_EXPIRED",
  "SESSION_SELECTION_LIMIT",
  "SESSION_STARTUP_BUFFER_LIMIT",
  "SESSION_STATE_SCHEMA",
  "SESSION_SUBSCRIBER_LIMIT",
  "SESSION_SWITCH_REQUIRES_EXPLICIT_ACTION",
  "SESSION_WORKER_BUSY_STOP_REQUIRED",
  "SESSION_WORKER_DRAINING",
  "SESSION_WORKER_LOST_MANUAL_OPEN_REQUIRED",
  "SESSION_WORKER_RETIRED",
] as const;
export type NativeSessionErrorCode = typeof nativeSessionErrorCodes[number];
export type SessionErrorCode = typeof sessionErrorCodes[number];
const nativeCodes: ReadonlySet<string> = new Set(nativeSessionErrorCodes);
const sessionCodes: ReadonlySet<string> = new Set(sessionErrorCodes);
export function isNativeSessionErrorCode(code: string): code is NativeSessionErrorCode {
  return code.length <= 96 && nativeCodes.has(code);
}
export function isSessionErrorCode(code: string): code is SessionErrorCode {
  return code.length <= 96 && sessionCodes.has(code);
}
/** Matched public history failures retain their lowercase native wire spelling. */
export const nativeHistoryErrorCodes = [
  "history_cache_full",
  "history_changed",
  "history_content_invalid",
  "history_content_items",
  "history_content_mime",
  "history_duplicate_entry",
  "history_handoff_changed",
  "history_invalid_entry",
  "history_invalid_handoff",
  "history_invalid_scope",
  "history_item_bytes",
  "history_live_item_bytes",
  "history_missing_leaf",
  "history_missing_parent",
  "history_native_item_bytes",
  "history_observation_gap",
  "history_parent_cycle",
  "history_response_bytes",
  "history_snapshot_bytes",
  "history_snapshot_deadline",
  "history_stale_content_cursor",
  "history_stale_cursor",
  "history_stale_observation",
  "history_unknown_content",
  "history_unknown_entry",
  "history_unknown_message",
  "history_unpageable_item",
] as const;
export type NativeHistoryErrorCode = typeof nativeHistoryErrorCodes[number];
const historyCodes: ReadonlySet<string> = new Set(nativeHistoryErrorCodes);
export function isNativeWorkerErrorCode(code: string): code is NativeSessionErrorCode | NativeHistoryErrorCode {
  return code.length <= 96 && (isNativeSessionErrorCode(code) || historyCodes.has(code));
}
/** Public native response boundary: unknown and oversized error strings have one bounded fallback. */
export function nativeWorkerFailureCode(code: string | undefined): string {
  return code && isNativeWorkerErrorCode(code) ? code : "RPC_NATIVE_REJECTED";
}
/** Unrecognized failures keep an explicit unknown outcome, never raw exception text. */
export function sessionFailureCode(error: unknown): string {
  const code = error instanceof Error ? error.message : "";
  return isSessionErrorCode(code) || isNativeSessionErrorCode(code) || isWorkspaceErrorCode(code)
    ? code : "SESSION_OPEN_OUTCOME_UNKNOWN";
}
declare module "@deepseek-ai/dsh-typert-protocol" {
  interface RemoteErrorDetailsMap extends Record<SessionErrorCode | NativeSessionErrorCode | NativeHistoryErrorCode, Record<string, never>> {}
}
