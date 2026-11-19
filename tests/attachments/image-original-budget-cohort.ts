import * as path from "node:path";
import { PreflightTransport } from "../../packages/compatibility/transport.ts";
import { fixtureCandidatePath, type FixtureCandidate } from "../continuation/worker.ts";

// Independent expected authored tuple for the 1-6,7,9,10 stack (navigation 0008 belongs to #37), recomputed with
// sha256sum over the ordered patch files and the emitted schema rather than read back from the build itself.
const expectedBuild = {
  base: "57771ae562b9345e0579bceb2d68d585e3e6927e",
  sourceSha256: "adda6c134cbff19e7cd688f2b93baf26b962179e5f0b6e2bb1c68d7b675d9451",
  patchSha256: "de7b02421953a365c3a458d16e4f74d9122a1b2cf9112a8df4d53083f3e8b753",
  schemaSha256: "177282c33cc393c9ddbf9136eacffb6151b17dd6b349514061ae66b1ba9eb2ab",
} as const;

/** Public diagnostic-only child before synthetic Session authoring; no global installation or product admission. */
export async function inspectAttachmentCandidate(home: string, candidate: FixtureCandidate): Promise<void> {
  if (candidate === "baseline") return;
  if (!Reflect.get(globalThis, Symbol.for("omp.s0.network-guard"))) throw Error("ATTACHMENT_COHORT_GUARD_REQUIRED");
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
