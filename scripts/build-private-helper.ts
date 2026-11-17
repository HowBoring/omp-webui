import { resolve } from "node:path";
import { PrivateHelperError, helperError } from "../packages/supervision/errors.ts";
import { buildSupervisor, type SupervisorBuildFailure, type SupervisorBuildInput,
  type SupervisorFenceDirectory } from "./supervisor-build.ts";

export type PrivateFenceDirectory = SupervisorFenceDirectory;
export interface PrivateHelperBuild extends SupervisorBuildInput {}

const errors = {
  unsupported: "HELPER_BUILD_UNSUPPORTED", enrolled: "HELPER_BUILD_REQUIRES_FRESH_RELEASE",
  destination: "HELPER_BUILD_DESTINATION_EXISTS", fence: "HELPER_FENCE_CHANGED", compile: "HELPER_BUILD_FAILED",
  io: "HELPER_BUILD_IO_FAILED", maintenance: "HELPER_MAINTENANCE_FAILED",
} as const satisfies Record<SupervisorBuildFailure, string>;

/** Explicit operator build only. Never enrolls approval, installs globally or starts the helper. */
export async function buildPrivateHelper(input: PrivateHelperBuild): Promise<void> {
  await buildSupervisor(input, {
    binary: "omp-private-helper", source: resolve(import.meta.dir, "../compatibility/supervision/private-helper.c"),
    temporaryPrefix: "omp-helper-build-", configuration: "private-helper-configuration.h",
    provenance: [
      { source: resolve(import.meta.dir, "../compatibility/supervision/private-helper.c"),
        destination: "private-helper.c" },
      { source: resolve(import.meta.dir, "../compatibility/supervision/candidates.h"), destination: "candidates.h" },
      { source: resolve(import.meta.dir, "../compatibility/launcher/control.h"), destination: "control.h" },
    ],
    error: (failure, cause) => helperError(errors[failure], cause),
  });
}
if (import.meta.main) throw new PrivateHelperError("HELPER_BUILD_UNSUPPORTED");
