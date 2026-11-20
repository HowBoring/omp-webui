import * as path from "node:path";
import { PreflightTransport } from "../../packages/compatibility/transport.ts";
import { fixtureCandidatePath, type FixtureCandidate } from "../continuation/worker.ts";

// Independent expected authored tuple for the merged OMP19 stack (0012 strict branch belongs to #52),
// recomputed from the authored patches and emitted schema rather than read back from the running build.
const expectedBuild = {
  base: "57771ae562b9345e0579bceb2d68d585e3e6927e",
  sourceSha256: "b245d8ec1080025d3fcb45bfe8fd9c1e8f7bf77d75f8b4d44b6c651a09bdfcea",
  patchSha256: "b91a85710e6085fc6a53c1b43505fd74edfb5249f8317697c61e4946d78ac13a",
  schemaSha256: "b13a75ebfb36a0c48edb5d796e8335d6ab0a6a6b6fad7eda06be40c7f7c5a1ff",
} as const;

/** Public diagnostic-only child before synthetic Session authoring; no global installation or product admission. */
export async function inspectAttachmentCandidate(home: string, candidate: FixtureCandidate): Promise<void> {
  if (candidate === "baseline") return;
  const client = await PreflightTransport.open({ argv: [process.execPath, "--no-env-file", "--preload",
    path.resolve("compatibility/omp/fixtures/no-provider.ts"), fixtureCandidatePath(candidate), "--rpc-preflight"],
    env: { HOME: home, PATH: "/usr/bin:/bin", TMPDIR: home, PI_CODING_AGENT_DIR: path.join(home, ".omp/agent"),
      OMP_OFFLINE: "1", BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0" }, timeoutMs: 3000 });
  try {
    const report = await client.inspect();
    const actual = { base: report.base, sourceSha256: report.sourceSha256,
      patchSha256: report.patchSha256, schemaSha256: report.schemaSha256 };
    if (JSON.stringify(actual) !== JSON.stringify(expectedBuild) || report.safePreflight !== true
      || report.sessionAdmission !== "blocked" || report.runtime.name !== "bun"
      || report.runtime.version !== Bun.version || report.runtime.platform !== "linux") {
      throw Error("ATTACHMENT_ADDITIVE_PREFLIGHT_COHORT_MISMATCH");
    }
    // Top test stdout is bounded/captured by the fresh retainer; no prompt, image or Session payload is logged.
    process.stdout.write(JSON.stringify({ event: "ATTACHMENT_ADDITIVE_PUBLIC_PREFLIGHT",
      candidate, processId: client.processId, actual, runtime: report.runtime }) + "\n");
  } finally {
    const drain = await client.close();
    if (drain.code !== 0 || drain.forced || drain.stderrBytes !== 0 || drain.protocolFailure !== undefined) {
      throw Error("ATTACHMENT_ADDITIVE_PREFLIGHT_DRAIN_FAILED");
    }
    process.stdout.write(JSON.stringify({ event: "ATTACHMENT_ADDITIVE_PUBLIC_PREFLIGHT_DRAIN", drain }) + "\n");
  }
}
