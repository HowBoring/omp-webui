import { RemoteError } from "@deepseek-ai/dsh-typert-protocol";
import { isNativeWorkerErrorCode, isSessionErrorCode } from "../contracts/session-errors.ts";
import { isWorkspaceErrorCode } from "../contracts/workspace-errors.ts";
import { isAttachmentGateErrorCode } from "../contracts/attachment-remote.ts";

const recovery: Readonly<Record<string, string>> = {
  SESSION_WORKER_BUSY_STOP_REQUIRED:
    "Stop the active Session and wait for confirmed quiescence, then explicitly retry New or Switch.",
  SESSION_WORKER_DRAINING: "Wait for the owned worker to finish exiting, then explicitly Open again.",
  SESSION_IDLE_EXIT_UNCONFIRMED_PENDING_48:
    "The owned worker exit is unconfirmed. Keep this worker reserved and resolve its exit manually before New or Switch.",
  SESSION_SWITCH_REQUIRES_EXPLICIT_ACTION: "Use the explicit Switch action to select a different Session.",
  SESSION_SELECTION_EXPIRED: "Refresh discovered Sessions and explicitly select the Session again.",
  SESSION_AUTH_REQUIRED: "Sign in again before accessing the Session.",
  SESSION_HOST_CLOSING: "Wait for the Host to restart, sign in, and explicitly Open the Session.",
  SESSION_ATTEMPT_UNAVAILABLE:
    "The Session attempt could not be saved. Restore Host storage and manually inspect the outcome before opening again.",
};
function message(code: string): string {
  if (code === "gateway/cancelled") return "The Session request was cancelled. Observe its state before another explicit action.";
  if (recovery[code]) return recovery[code];
  if (code.startsWith("RPC_") || code.includes("UNKNOWN") || code.includes("LOST") || code === "SESSION_OPEN_NOT_CONFIRMED") {
    return "The Session outcome is unconfirmed. Observe its state manually before another explicit action; do not replay work.";
  }
  if (code === "SESSION_EXTERNAL_OWNER" || code === "STRICT_OCCUPIED") {
    return "Another native worker owns this Session. Resolve that ownership before explicitly opening it again.";
  }
  if (code.includes("CWD") || code.includes("DIRECTORY")) {
    return "Review directory authorization and the selected directory, then explicitly Open again.";
  }
  return `Session operation failed (${code}). Refresh Session state and recover manually.`;
}
function publicCode(code: string) {
  return isSessionErrorCode(code) || isNativeWorkerErrorCode(code) || isWorkspaceErrorCode(code)
    || isAttachmentGateErrorCode(code) || code === "gateway/cancelled" ? code : undefined;
}
/** Rebuild public errors from a fixed vocabulary. Raw exceptions, details, paths and stacks never cross the carrier. */
export function sessionFailure(error: unknown): RemoteError {
  // Session settings failures are built from a fixed local vocabulary; other raw errors never cross the carrier.
  if (error instanceof RemoteError && error.code === "gateway/bad-request") {
    return new RemoteError(error.code, error.message, {});
  }
  const candidate = error instanceof Error ? error.message : "";
  const system = error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : "";
  const code = publicCode(system) ?? publicCode(candidate) ?? "gateway/internal";
  return new RemoteError(code, code === "gateway/internal" ? "Session request failed." : message(code), {});
}
