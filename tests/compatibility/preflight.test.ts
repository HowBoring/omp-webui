import { expect, test } from "bun:test";
import { inspectInstallation } from "../../packages/compatibility/installation.ts";

test("unknown startup installation blocks diagnostics before executing a launcher", async () => {
  await expect(inspectInstallation({ manifest: "/does/not/exist", launcher: "/does/not/exist" }))
    .rejects.toThrow("INSTALLATION_UNVERIFIED");
});

import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writeInstallationManifest } from "../../packages/compatibility/manifest.ts";

test("verified install rejects same-version launcher, symlink, runtime and native closure replacements", async () => {
  const root = await mkdtemp(join(tmpdir(), "omp-install-"));
  try {
    await mkdir(join(root, "vendor/candidate"), { recursive: true });
    await writeFile(join(root, "vendor/candidate/cli.js"), "version18.20.2 original");
    await writeFile(join(root, "vendor/candidate/native.node"), "native-original");
    await symlink("cli.js", join(root, "vendor/candidate/omp"));
    const path = join(root, "vendor/candidate/installation.json");
    await writeInstallationManifest({ root, path, launcher: "vendor/candidate/omp", target: "vendor/candidate/cli.js",
      runtime: process.execPath, trees: ["vendor/candidate"], patch: "a".repeat(64), schema: "b".repeat(64) });
    const selection = { manifest: path, launcher: join(root, "vendor/candidate/omp") };
    const verified = await inspectInstallation(selection);
    await writeFile(join(root, "vendor/candidate/native.node"), "native-replaced");
    await expect(verified.verify()).rejects.toThrow();
    await expect(inspectInstallation(selection)).rejects.toThrow("INSTALLATION_UNVERIFIED");
  } finally { await rm(root, { recursive: true, force: true }); }
});
