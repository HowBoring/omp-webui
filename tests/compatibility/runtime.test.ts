import { expect, test } from "bun:test";
import { cp, mkdtemp, mkdir, readdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { inspectDiagnostics } from "../../packages/compatibility/diagnostics.ts";
import { writeInstallationManifest } from "../../packages/compatibility/manifest.ts";
import { compatibilityBuild } from "../../packages/contracts/generated/identity.ts";

test("a real candidate with omitted runtime/native mappings is blocked despite a matched ready/schema/build", async () => {
  const root = await mkdtemp(join(tmpdir(), "omp-native-closure-"));
  try {
    const candidate = join(root, "vendor/candidate");
    await mkdir(candidate, { recursive: true });
    for (const file of await readdir("vendor/omp-candidate")) {
      if (file !== "installation.json") await cp(resolve("vendor/omp-candidate", file), join(candidate, file),
        { verbatimSymlinks: true });
    }
    const path = join(candidate, "installation.json");
    await writeInstallationManifest({ root, path, launcher: "vendor/candidate/omp", target: "vendor/candidate/cli.js",
      runtime: process.execPath, trees: ["vendor/candidate"], patch: compatibilityBuild.patchSha256,
      schema: compatibilityBuild.schemaSha256, runtimeDependencies: [] });
    const report = await inspectDiagnostics({ manifest: path, launcher: join(candidate, "omp") });
    expect(report.status).toBe("blocked");
    expect(report.code).toBe("PREFLIGHT_RUNTIME_MAPPING_MISMATCH");
    expect(report.identity).toBeUndefined();
  } finally { await rm(root, { recursive: true, force: true }); }
});
