export type PrivateHelperErrorCode =
  | "CONTROL_PROTOCOL" | "CONTROL_LIMIT" | "CONTROL_GENERATION" | "CONTROL_SEQUENCE"
  | "CONTROL_WRITE_LIMIT" | "CONTROL_WRITE_FAILED" | "FORCE_NOT_AVAILABLE"
  | "HELPER_ARTIFACT_UNAPPROVED" | "HELPER_LAUNCH_UNSUPPORTED" | "HELPER_ARGUMENT_LIMIT"
  | "HELPER_ENVIRONMENT_UNSUPPORTED" | "HELPER_SELECTION_UNVERIFIED" | "HELPER_PREPARE_FAILED"
  | "HELPER_SPAWN_FAILED" | "HELPER_CONTROL_UNAVAILABLE" | "HELPER_IDENTITY_MISMATCH"
  | "HELPER_REGISTRATION_FAILED" | "NATIVE_ADMISSION_CLOSE_FAILED" | "NATIVE_ADMISSION_CLOSED"
  | "NATIVE_INPUT_FAILED" | "PRIVATE_DOMAIN_UNRESOLVED"
  | "HELPER_BUILD_UNSUPPORTED" | "HELPER_BUILD_REQUIRES_FRESH_RELEASE" | "HELPER_BUILD_DESTINATION_EXISTS"
  | "HELPER_FENCE_CHANGED" | "HELPER_BUILD_FAILED" | "HELPER_BUILD_IO_FAILED" | "HELPER_MAINTENANCE_FAILED";

const systemCodes = ["EACCES", "EPERM", "ENOENT", "EEXIST", "EIO", "EMFILE", "ENFILE", "ENOSPC",
  "ENOMEM", "ENOTDIR", "EISDIR", "ELOOP", "EBADF", "EPIPE", "ECONNRESET", "EINVAL"] as const;
type BoundedCauseCode = PrivateHelperErrorCode | typeof systemCodes[number] | "UNCLASSIFIED";

/** Stable public code and bounded diagnostic category; never retains raw error messages, paths or causes. */
export class PrivateHelperError extends Error {
  readonly causeCode: BoundedCauseCode | undefined;
  constructor(readonly code: PrivateHelperErrorCode, cause?: unknown) {
    super(code);
    this.name = "PrivateHelperError";
    this.causeCode = cause instanceof PrivateHelperError ? cause.code : systemCause(cause);
  }
}

function systemCause(cause: unknown): BoundedCauseCode | undefined {
  if (cause === undefined) return undefined;
  if (typeof cause === "object" && cause !== null && "code" in cause
    && typeof cause.code === "string") return systemCodes.find(code => code === cause.code) ?? "UNCLASSIFIED";
  return "UNCLASSIFIED";
}

export function helperError(code: PrivateHelperErrorCode, cause: unknown): PrivateHelperError {
  return cause instanceof PrivateHelperError ? cause : new PrivateHelperError(code, cause);
}
