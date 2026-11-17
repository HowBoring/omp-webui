import { RemoteError } from "@deepseek-ai/dsh-typert-protocol";
import { isWorkspaceErrorCode } from "../contracts/workspace-errors.ts";

/** Translate only known codes; never publish a thrown message, stack, path, native output or arbitrary details. */
export function workspaceFailure(error: unknown): RemoteError {
  const candidate = error instanceof Error ? error.message : "";
  const system = error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : "";
  const code = isWorkspaceErrorCode(candidate) ? candidate
    : /^(E[A-Z]+|SQLITE_[A-Z]+)$/.test(system) && isWorkspaceErrorCode(system) ? system : "gateway/internal";
  return new RemoteError(code, code === "gateway/internal" ? "Workspace request failed."
    : `Workspace operation failed (${code}).`, {});
}
