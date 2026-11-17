import { resolve } from "node:path";
import { ExternalProtectorError } from "../packages/supervision/external.ts";
import { buildSupervisor, type SupervisorBuildFailure, type SupervisorBuildInput,
  type SupervisorFenceDirectory } from "./supervisor-build.ts";

export type ExternalFenceDirectory = SupervisorFenceDirectory;
export interface ExternalProtectorBuild extends SupervisorBuildInput {}

const errors = {
  unsupported: "EXTERNAL_BUILD_UNSUPPORTED", enrolled: "EXTERNAL_BUILD_REQUIRES_FRESH_RELEASE",
  destination: "EXTERNAL_BUILD_DESTINATION_EXISTS", fence: "EXTERNAL_FENCE_CHANGED", compile: "EXTERNAL_BUILD_FAILED",
  io: "EXTERNAL_BUILD_IO_FAILED", maintenance: "EXTERNAL_MAINTENANCE_FAILED",
} as const satisfies Record<SupervisorBuildFailure, string>;

/**
 * Explicit independent operator build. Publishes a separate binary and complete shared-source provenance.
 * Never enrolls approval, overwrites a release, installs globally or starts any process except the compiler.
 */
export async function buildExternalProtector(input: ExternalProtectorBuild): Promise<void> {
  await buildSupervisor(input, {
    binary: "omp-external-protector",
    source: resolve(import.meta.dir, "../compatibility/supervision/external-protector.c"),
    temporaryPrefix: "omp-external-build-", configuration: "external-protector-configuration.h",
    provenance: [
      { source: resolve(import.meta.dir, "../compatibility/supervision/external-protector.c"),
        destination: "external-protector.c" },
      { source: resolve(import.meta.dir, "../compatibility/supervision/private-helper.c"),
        destination: "external-protector-core.c" },
      { source: resolve(import.meta.dir, "../compatibility/supervision/candidates.h"),
        destination: "external-protector-candidates.h" },
      { source: resolve(import.meta.dir, "../compatibility/launcher/control.h"),
        destination: "external-protector-control.h" },
    ],
    error: (failure, cause) => cause instanceof ExternalProtectorError
      ? cause : new ExternalProtectorError(errors[failure], cause),
  });
}
if (import.meta.main) throw new ExternalProtectorError("EXTERNAL_BUILD_UNSUPPORTED");
