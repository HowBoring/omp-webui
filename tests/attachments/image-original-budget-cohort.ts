import * as path from "node:path";
import { PreflightTransport } from "../../packages/compatibility/transport.ts";
import { fixtureCandidatePath, type FixtureCandidate } from "../continuation/worker.ts";

// Independent expected authored tuple for the 1-6,7,9,10 stack (navigation 0008 belongs to #37), recomputed with
// sha256sum over the ordered patch files and the emitted schema rather than read back from the build itself.
const expectedBuild = {
  base: "57771ae562b9345e0579bceb2d68d585e3e6927e",
  sourceSha256: "b3cfa52e8955321f8518b883a6a19c0a66d15d50ff9378455d540b92dacb233c",
  patchSha256: "6f6ec2ae93c0e0be4d76ffd967bee2dcd136600b231ad055480903c7e29b3aba",
  sourceSha256: "35c1f9b52d8db66ed35478cf303cd532d763cd88957fd6e6c7fa8c74942ab5e1",
  patchSha256: "b223daf2990e4dfae3a84fb8ae279515b2f79c34892d3b28ab626d449fe5332e",
  schemaSha256: "e4fe30c9ed9cf053b4b8dada0691c2a3e2d31e4f915a83a55277da3a8d3ecf62",
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
