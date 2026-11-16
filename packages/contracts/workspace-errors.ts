/** Stable failure vocabulary for the authenticated Workspace Remote; details never contain filesystem or native data. */
export const workspaceErrorCodes = [
  "GRANT_PREVIEW_EXPIRED", "DIRECTORY_CHANGED", "DIRECTORY_INVALID", "GRANT_LIMIT",
  "GRANT_PREVIEW_LIMIT", "GRANTS_UNAVAILABLE", "INDEX_PAGE_LIMIT", "INDEX_CURSOR_INVALID",
  "CATALOG_UNAVAILABLE", "CATALOG_RESULT_SCHEMA", "CATALOG_COMMAND_SCHEMA", "CATALOG_CURSOR_INVALID_OR_EXPIRED",
  "CATALOG_CURSOR_SCOPE", "CATALOG_FAILED", "CATALOG_INPUT_LIMIT", "CATALOG_MEMORY_LIMIT",
  "CATALOG_NEGOTIATION", "CATALOG_NEGOTIATION_REQUIRED", "CATALOG_PAGE_LIMIT", "CATALOG_PARTIAL_EOF",
  "CATALOG_RESPONSE_LIMIT", "CATALOG_SOURCE_CONFIG_INVALID", "CATALOG_STALE", "RPC_CANCELLED",
  "RPC_CLOSED", "RPC_COMMAND_CORRELATION", "RPC_COMMAND_LIMIT", "RPC_COMMAND_SCHEMA",
  "RPC_CORRELATION", "RPC_DRAIN_TIMEOUT", "RPC_DUPLICATE_ID", "RPC_ENVELOPE_SCHEMA",
  "RPC_NEGOTIATION", "RPC_PENDING_LIMIT", "RPC_PROTOCOL", "RPC_READY",
  "RPC_READY_TIMEOUT", "RPC_REQUEST_TIMEOUT", "RPC_STDERR_LIMIT", "RPC_STDIN",
  "RPC_UNEXPECTED_EOF", "ENOENT", "EACCES", "EPERM",
  "ENOTDIR", "ENOSPC", "EIO", "SQLITE_BUSY",
  "SQLITE_FULL", "SQLITE_READONLY", "SQLITE_CORRUPT", "SQLITE_IOERR",
] as const;
export type WorkspaceErrorCode = typeof workspaceErrorCodes[number];
const knownCodes: ReadonlySet<string> = new Set(workspaceErrorCodes);
/** Admit only the explicitly declared public failure vocabulary. */
export function isWorkspaceErrorCode(value: string): value is WorkspaceErrorCode { return knownCodes.has(value); }
declare module "@deepseek-ai/dsh-typert-protocol" {
  interface RemoteErrorDetailsMap extends Record<WorkspaceErrorCode, Record<string, never>> {}
}
