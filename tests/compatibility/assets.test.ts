import { expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { trustedDiagnosticAssets } from "../../packages/compatibility/assets.ts";
import { writeInstallationManifest } from "../../packages/compatibility/manifest.ts";

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
    const carrier = await trustedDiagnosticAssets(manifest, assets);
    expect((await carrier.response("client.js")).status).toBe(200);
    await writeFile(join(assets, "client.js"), "same-name replacement");
    expect((await carrier.response("client.js")).status).toBe(503);
    await writeFile(manifest, "{}");
    expect((await carrier.response("client.js")).status).toBe(503);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("independent operator digest rejects a replaced manifest even when replacement assets match its new inventory", async () => {
  const root = await mkdtemp(join(tmpdir(), "omp-assets-independent-"));
  try {
    const assets = join(root, "vendor/dsh");
    const manifest = join(root, "vendor/candidate/installation.json");
    await mkdir(assets, { recursive: true });
    await mkdir(join(root, "vendor/candidate"), { recursive: true });
    await writeFile(join(assets, "client.js"), "reviewed fixture");
    await writeFile(join(root, "runtime"), "runtime fixture");
    const enroll = () => writeInstallationManifest({ root, path: manifest, launcher: "unused", target: "unused",
      runtime: join(root, "runtime"), trees: ["vendor/dsh"], patch: "a".repeat(64), schema: "b".repeat(64) });
    await enroll();
    const approved = (await trustedDiagnosticAssets(manifest, assets)).identity;
    if (approved === undefined) throw new Error("fixture enrollment failed");
    await writeFile(join(assets, "client.js"), "replacement fixture");
    await enroll();
    const carrier = await trustedDiagnosticAssets(manifest, assets, approved);
    expect((await carrier.response("client.js")).status).toBe(503);
  } finally { await rm(root, { recursive: true, force: true }); }
});
