import { expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { trustedDiagnosticAssets } from "../../packages/compatibility/assets.ts";
import { writeInstallationManifest } from "../../packages/compatibility/manifest.ts";
import { digest } from "../../packages/compatibility/installation.ts";

test("changed served JavaScript or startup trust manifest cannot publish verified diagnostic UI", async () => {
  const root = await mkdtemp(join(tmpdir(), "omp-assets-"));
  try {
    const assets = join(root, "vendor/dsh");
    const manifest = join(root, "vendor/candidate/installation.json");
    await mkdir(assets, { recursive: true });
    await mkdir(join(root, "vendor/candidate"), { recursive: true });
    await writeFile(join(assets, "client.js"), "original fixture");
    await writeFile(join(root, "runtime"), "runtime fixture");
    await writeInstallationManifest({ root, path: manifest, launcher: "unused", target: "unused",
      runtime: join(root, "runtime"), trees: ["vendor/dsh"], patch: "a".repeat(64), schema: "b".repeat(64) });
    const manifestBytes = await readFile(manifest);
    const enrolled = digest(manifestBytes);
    const forged = await trustedDiagnosticAssets(manifest, assets, "f".repeat(64));
    expect((await forged.response("client.js")).status).toBe(503);
    const carrier = await trustedDiagnosticAssets(manifest, assets, enrolled);
    const served = await carrier.response("client.js");
    expect(served.status).toBe(200);
    const csp = served.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("worker-src 'self' blob:");
    expect(csp).toContain("img-src 'self' blob: data:");
    await writeFile(join(assets, "client.js"), "same-name replacement");
    expect((await carrier.response("client.js")).status).toBe(503);
    await writeFile(manifest, "{}");
    expect((await carrier.response("client.js")).status).toBe(503);
  } finally { await rm(root, { recursive: true, force: true }); }
});
