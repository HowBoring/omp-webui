import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { startDiagnosticsServer } from "../../apps/host/src/diagnostics-server.ts";
import { writeInstallationManifest } from "../../packages/compatibility/manifest.ts";
import { inspectDiagnostics } from "../../packages/compatibility/diagnostics.ts";
import { compatibilityBuild } from "../../packages/contracts/generated/identity.ts";

/** Enrollment (the bytes identity) and approval (the operator pin) must be independent facts. */
const pinOf = async (path: string) => createHash("sha256").update(await readFile(path)).digest("hex");

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "omp-webui-trust-"));
  const sentinel = join(root, "spawned");
  await mkdir(join(root, "vendor/candidate"), { recursive: true });
  await writeFile(join(root, "vendor/candidate/cli.js"),
    `await Bun.write(${JSON.stringify(sentinel)}, "preflight"); process.exit(1);\n`);
  await symlink("cli.js", join(root, "vendor/candidate/omp"));
  const manifestPath = join(root, "vendor/candidate/installation.json");
  await writeInstallationManifest({ root, path: manifestPath, launcher: "vendor/candidate/omp", target: "vendor/candidate/cli.js",
    runtime: process.execPath, trees: ["vendor/candidate"], patch: compatibilityBuild.patchSha256,
    schema: compatibilityBuild.schemaSha256 });
  return { root, sentinel, manifest: manifestPath, launcher: join(root, "vendor/candidate/omp") };
}

test("a client that supplies no enrolled digest is refused before any asset is trusted", async () => {
  await expect(startDiagnosticsServer({ manifest: "/missing/manifest", launcher: "/missing/launcher",
    port: 0, expectedIdentity: "" })).rejects.toThrow("MANIFEST_TRUST_REQUIRED");
});

test("a wrong pin blocks asset admission and never spawns the launcher", async () => {
  const asset = await fixture();
  const report = await inspectDiagnostics({ manifest: asset.manifest, launcher: asset.launcher,
    expectedIdentity: "f".repeat(64) });
  expect(report).toMatchObject({ status: "blocked", code: "INSTALLATION_UNVERIFIED", sessionAdmission: "blocked" });
  expect(await Bun.file(asset.sentinel).exists()).toBe(false);
  const host = await startDiagnosticsServer({ manifest: asset.manifest, launcher: asset.launcher, port: 0,
    expectedIdentity: "f".repeat(64) });
  try { expect((await fetch(host.server.url.origin)).status).toBe(503); } finally { await host.stop(); }
});

test("the correct independent pin reaches the launcher, and a later manifest rewrite revokes trust", async () => {
  const asset = await fixture();
  const pin = await pinOf(asset.manifest);
  const report = await inspectDiagnostics({ manifest: asset.manifest, launcher: asset.launcher, expectedIdentity: pin });
  expect(report.code).not.toBe("INSTALLATION_UNVERIFIED");
  expect(await Bun.file(asset.sentinel).exists()).toBe(true);
  const host = await startDiagnosticsServer({ manifest: asset.manifest, launcher: asset.launcher, port: 0,
    expectedIdentity: pin });
  try {
    await writeFile(asset.manifest, `${await readFile(asset.manifest, "utf8")}\n`);
    expect((await fetch(host.server.url.origin)).status).toBe(503);
  } finally { await host.stop(); }
});
