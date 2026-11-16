import { expect, test } from "bun:test";
import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startDiagnosticsServer } from "../../apps/host/src/diagnostics-server.ts";
import { digest } from "../../packages/compatibility/installation.ts";
import { writeInstallationManifest } from "../../packages/compatibility/manifest.ts";
import { compatibilityBuild } from "../../packages/contracts/generated/identity.ts";

/** Public HTTP + actual filesystem provenance negative; the selected synthetic script must never be executed. */
test("stale independent startup trust blocks both diagnostic assets and preflight before a synthetic target executes", async () => {
  const root = await mkdtemp(join(tmpdir(), "omp-independent-http-"));
  try {
    const assets = join(root, "vendor/dsh");
    const candidate = join(root, "vendor/candidate");
    await mkdir(assets, { recursive: true });
    await mkdir(candidate, { recursive: true });
    const marker = join(root, "unsafe-execution");
    await writeFile(join(candidate, "cli.js"), `await Bun.write(${JSON.stringify(marker)}, "must not execute");\n`);
    await symlink("cli.js", join(candidate, "omp"));
    await writeFile(join(assets, "client.js"), "reviewed asset fixture");
    const manifest = join(candidate, "installation.json");
    const enroll = () => writeInstallationManifest({ root, path: manifest, launcher: "vendor/candidate/omp",
      target: "vendor/candidate/cli.js", runtime: process.execPath, trees: ["vendor/candidate", "vendor/dsh"],
      patch: compatibilityBuild.patchSha256, schema: compatibilityBuild.schemaSha256 });
    await enroll();
    const expectedIdentity = digest(await readFile(manifest));
    await writeFile(join(assets, "client.js"), "replacement with matching self-authored inventory");
    await enroll();
    const host = await startDiagnosticsServer({ manifest, launcher: join(candidate, "omp"), expectedIdentity,
      assets, port: 0 });
    try {
      const origin = host.server.url.origin;
      expect((await fetch(`${origin}/client.js`)).status).toBe(503);
      const response = await fetch(`${origin}/api/ompDiagnostics/preflight`, {
        method: "POST", headers: { origin, "content-type": "application/json" },
        body: JSON.stringify({ type: "client-request", method: "ompDiagnostics/preflight", rpcId: "independent-trust",
          payload: { args: {} } }),
      });
      expect(await response.json()).toEqual(expect.objectContaining({ result: expect.objectContaining({
        value: expect.objectContaining({ sessionAdmission: "blocked", code: "INSTALLATION_UNVERIFIED" }),
      }) }));
      await expect(access(marker)).rejects.toThrow();
    } finally { await host.stop(); }
  } finally { await rm(root, { recursive: true, force: true }); }
});
