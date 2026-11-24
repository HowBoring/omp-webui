import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CompatibilityReport } from "../contracts/preflight.ts";
import { compatibilityBuild } from "../contracts/generated/identity.ts";
import { inspectInstallation, type InstallationSelection, type VerifiedInstallation } from "./installation.ts";
import { verifyChildMappings } from "./runtime-mappings.ts";
import { PreflightTransport } from "./transport.ts";

/** Capabilities the product Host actually consumes. Every one must be reported by the enrolled build. */
export const productCapabilities = ["safe-preflight-v1", "rpc-framing-v2"] as const;
export interface ProductIdentity {
  base: string; patchSha256: string; sourceSha256: string; schemaSha256: string;
  installationSha256: string; runtime: CompatibilityReport["runtime"];
}
export interface ProductAdmission {
  status: "admitted" | "blocked";
  sessionAdmission: "admitted" | "blocked";
  code: "ADMITTED" | "MANIFEST_UNTRUSTED" | "CAPABILITY_MISSING" | "PREFLIGHT_FAILED" | "PLATFORM_UNSUPPORTED";
  identity?: ProductIdentity;
  missingCapabilities: string[];
  verified?: VerifiedInstallation;
}

const policyGaps = (report: CompatibilityReport): string[] => {
  const gaps: string[] = [];
  if (!report.capabilities.includes("safe-preflight-v1")) gaps.push("safe-preflight-v1");
  if (!report.capabilities.includes("rpc-framing-v2")) gaps.push("rpc-framing-v2");
  if (report.rpcUiInteractionPolicy?.version !== "1" || report.rpcUiInteractionPolicy?.explicitAnswersOnly !== true) {
    gaps.push("interaction.explicit-answer.v1");
  }
  if (!report.rpcUiStrictStartupPolicy?.platforms?.includes(process.platform)) gaps.push("continuation.strict.v1");
  if (report.rpcUiSubmissionPolicy?.version !== "durable-submission-v1") gaps.push("submission.durable-receipt.v1");
  if (report.rpcUiNavigationPolicy?.version !== "durable-navigation-v1") gaps.push("history.position-durable.v1");
  return gaps;
};

/**
 * Admit the exact operator-enrolled installation, never a self-asserted or browser-supplied one.
 * The manifest digest must be independently pinned; capability evidence comes from the enrolled runtime.
 */
export async function admitProduct(selection: InstallationSelection, signal?: AbortSignal): Promise<ProductAdmission> {
  let profile: string | undefined;
  let client: PreflightTransport | undefined;
  try {
    if (selection.expectedIdentity === undefined) throw new Error("MANIFEST_UNTRUSTED");
    const verified = await inspectInstallation(selection);
    if (verified.manifest.schema !== compatibilityBuild.schemaSha256
      || verified.manifest.patch !== compatibilityBuild.patchSha256) throw new Error("MANIFEST_UNTRUSTED");
    if (verified.manifest.platform !== process.platform || verified.manifest.arch !== process.arch) {
      throw new Error("PLATFORM_UNSUPPORTED");
    }
    signal?.throwIfAborted();
    profile = await mkdtemp(join(tmpdir(), "omp-webui-product-"));
    await verified.verify();
    client = await PreflightTransport.open({
      argv: [verified.runtime, "--no-env-file", verified.target, "--rpc-preflight"], cwd: profile,
      env: { HOME: profile, PI_CODING_AGENT_DIR: profile, TMPDIR: profile },
      ...(signal === undefined ? {} : { signal }),
    });
    await verifyChildMappings(verified, selection.manifest, client.processId);
    const report = await client.inspect();
    const drain = await client.close();
    if (drain.code !== 0 || drain.forced || drain.protocolFailure !== undefined) throw new Error("PREFLIGHT_FAILED");
    await verified.verify();
    if (report.base !== compatibilityBuild.base || report.patchSha256 !== compatibilityBuild.patchSha256
      || report.sourceSha256 !== compatibilityBuild.sourceSha256 || report.schemaSha256 !== compatibilityBuild.schemaSha256
      || report.runtime.name !== "bun" || report.runtime.platform !== verified.manifest.platform
      || report.runtime.arch !== verified.manifest.arch) throw new Error("MANIFEST_UNTRUSTED");
    const missingCapabilities = policyGaps(report);
    if (missingCapabilities.length > 0) {
      return { status: "blocked", sessionAdmission: "blocked", code: "CAPABILITY_MISSING", missingCapabilities,
        identity: { base: report.base, patchSha256: report.patchSha256, sourceSha256: report.sourceSha256,
          schemaSha256: report.schemaSha256, installationSha256: verified.identity, runtime: report.runtime } };
    }
    return { status: "admitted", sessionAdmission: "admitted", code: "ADMITTED", missingCapabilities: [],
      identity: { base: report.base, patchSha256: report.patchSha256, sourceSha256: report.sourceSha256,
        schemaSha256: report.schemaSha256, installationSha256: verified.identity, runtime: report.runtime },
      verified };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const code = message === "MANIFEST_UNTRUSTED" || message === "PLATFORM_UNSUPPORTED" ? message
      : "PREFLIGHT_FAILED";
    return { status: "blocked", sessionAdmission: "blocked", code, missingCapabilities: [...productCapabilities] };
  } finally {
    await client?.close();
    if (profile !== undefined) await rm(profile, { recursive: true, force: true });
  }
}
