import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DiagnosticReport } from "../contracts/diagnostics.ts";
import { compatibilityBuild } from "../contracts/generated/identity.ts";
import { inspectInstallation, type InstallationSelection } from "./installation.ts";
import { verifyChildMappings } from "./runtime-mappings.ts";
import { PreflightTransport } from "./transport.ts";

export const missingCapabilities = [
  "catalog.readonly.v1", "continuation.strict.v1", "interaction.explicit-answer.v1", "attachments.prepare.v1",
  "submission.durable-receipt.v1", "history.coherent-cut.v1", "history.position-durable.v1",
  "client.conversation-rebuild.v1", "security.private-session-admission.v1", "installation.immutable-global.v1",
];

/** Only operator-selected installation facts are observed. Product admission is unconditionally blocked. */
export async function inspectDiagnostics(selection: InstallationSelection, signal?: AbortSignal): Promise<DiagnosticReport> {
  let profile: string | undefined;
  let client: PreflightTransport | undefined;
  try {
    const verified = await inspectInstallation(selection);
    if (verified.manifest.schema !== compatibilityBuild.schemaSha256
      || verified.manifest.patch !== compatibilityBuild.patchSha256) throw new Error("SCHEMA_OR_SOURCE_MISMATCH");
    signal?.throwIfAborted();
    profile = await mkdtemp(join(tmpdir(), "omp-webui-preflight-"));
    await verified.verify();
    client = await PreflightTransport.open({
      argv: [verified.runtime, "--no-env-file", verified.target, "--rpc-preflight"], cwd: profile,
      env: { HOME: profile, PI_CODING_AGENT_DIR: profile, TMPDIR: profile },
      ...(signal === undefined ? {} : { signal }),
    });
    await verifyChildMappings(verified, selection.manifest, client.processId);
    const report = await client.inspect();
    const drain = await client.close();
    if (drain.code !== 0 || drain.forced || drain.protocolFailure !== undefined) throw new Error("PREFLIGHT_DRAIN_FAILED");
    await verified.verify();
    if (report.base !== compatibilityBuild.base || report.patchSha256 !== compatibilityBuild.patchSha256
      || report.sourceSha256 !== compatibilityBuild.sourceSha256 || report.schemaSha256 !== compatibilityBuild.schemaSha256
      || report.runtime.version !== Bun.version || report.runtime.platform !== process.platform
      || report.runtime.arch !== process.arch || !report.capabilities.includes("safe-preflight-v1")) {
      throw new Error("PREFLIGHT_IDENTITY_MISMATCH");
    }
    return { status: "verified-blocked", sessionAdmission: "blocked", code: "S0_DIAGNOSTICS_ONLY",
      identity: { base: report.base, patchSha256: report.patchSha256, sourceSha256: report.sourceSha256,
        schemaSha256: report.schemaSha256, installationSha256: verified.identity, runtime: report.runtime },
      missingCapabilities };
  } catch (error) {
    const code = error instanceof Error && /^[A-Z][A-Z0-9_]{1,80}$/.test(error.message)
      ? error.message : "PREFLIGHT_FAILED";
    return { status: "blocked", sessionAdmission: "blocked", code, missingCapabilities };
  } finally {
    await client?.close();
    if (profile !== undefined) await rm(profile, { recursive: true, force: true });
  }
}
