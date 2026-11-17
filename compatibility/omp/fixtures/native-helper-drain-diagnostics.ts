/** Fixture-only diagnostics. Never imports Native or evaluates error getters/stringification. */
export const helperDrainPublicFailureCodes = ["ownership_protocol", "ownership_limit", "dispatcher_unavailable",
  "dispatcher_mismatch", "ownership_unresolved", "maintenance_fenced", "shared_service_unsupported",
  "ownership_backend_unavailable"] as const;

export const helperDrainFixtureFailureCodes = [
  "DRAIN_ANCHOR_SCOPE",
  "DRAIN_APPROVAL_LIMIT",
  "DRAIN_APPROVAL_SCOPE",
  "DRAIN_APPROVAL_SIGNATURE",
  "DRAIN_ENTRY_CHANGED",
  "DRAIN_HELLO_MISMATCH",
  "DRAIN_HELPER_NOT_REGISTERED",
  "DRAIN_HELPER_OUTPUT_LIMIT",
  "DRAIN_HOST_ARGUMENTS",
  "DRAIN_HOST_INCOMPLETE",
  "DRAIN_HOST_LEASE_RETAINED",
  "DRAIN_LAUNCH_CHANGED",
  "DRAIN_LAUNCH_DIGEST",
  "DRAIN_NATIVE_ARGUMENTS",
  "DRAIN_NATIVE_CLOSE_INCOMPLETE",
  "DRAIN_NONCANONICAL_APPROVAL",
  "DRAIN_OPERATOR_CHANGED",
  "DRAIN_OPERATOR_PATHS",
  "DRAIN_PARENT_COMMAND",
  "DRAIN_PARENT_INPUT_LIMIT",
  "DRAIN_PREIMPORT_GUARD_MISSING",
  "DRAIN_PREPARE_MISMATCH",
  "DRAIN_PREPARE_NOT_PENDING",
  "DRAIN_PUBLIC_INPUT_CHANGED",
  "DRAIN_ROLE_REQUIRED",
  "DRAIN_RUNTIME_CHANGED",
  "DRAIN_UNRESOLVED",
  "DRAIN_V4_REQUIRED",
  "DRAIN_WORKER_IDENTITY",
] as const;

export const helperDrainPhases = ["bootstrap_import", "bootstrap_entry", "native_imports", "native_handoff",
  "native_approval", "native_claim", "native_selection", "native_server_open", "native_wait_close", "native_close",
  "native_disposal", "host_run", "unrecognized"] as const;
export type HelperDrainPhase = typeof helperDrainPhases[number];

function ownString(error: unknown, key: string): string | undefined {
  try {
    if (typeof error !== "object" || error === null) return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(error, key);
    return descriptor && "value" in descriptor && typeof descriptor.value === "string" ? descriptor.value : undefined;
  } catch { return undefined; } // A hostile Proxy is unknown; never serialize it or invoke its coercion hooks.
}

export function helperDrainFailure(error: unknown, observedPhase: unknown): {
  code: string; codeSource: "public_code" | "fixture_message" | "unrecognized"; phase: HelperDrainPhase;
} {
  const phase = helperDrainPhases.find(known => known === observedPhase) ?? "unrecognized";
  const code = ownString(error, "code");
  const known = helperDrainPublicFailureCodes.find(known => known === code);
  if (known) return { code: known, codeSource: "public_code", phase };
  const message = ownString(error, "message");
  const fixture = helperDrainFixtureFailureCodes.find(known => known === message);
  if (fixture) return { code: fixture, codeSource: "fixture_message", phase };
  return { code: "DRAIN_UNRESOLVED", codeSource: "unrecognized", phase };
}
