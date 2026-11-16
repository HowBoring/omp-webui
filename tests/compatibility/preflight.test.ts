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

for (const mutation of ["launcher-content", "launcher-symlink", "runtime-content", "dependency-content", "new-dependency"]) {
  test(`enrolled ${mutation} drift blocks the same-version candidate before launch`, async () => {
    const root = await mkdtemp(join(tmpdir(), "omp-install-drift-"));
    try {
      const dir = join(root, "vendor/candidate");
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "cli.js"), "omp/18.20.2 original");
      await writeFile(join(dir, "runtime"), "bun1.4.4 original");
      await writeFile(join(dir, "dependency.node"), "native-original");
      await writeFile(join(dir, "other.js"), "omp/18.20.2 original");
      await symlink("cli.js", join(dir, "omp"));
      const path = join(dir, "installation.json");
      await writeInstallationManifest({ root, path, launcher: "vendor/candidate/omp", target: "vendor/candidate/cli.js",
        runtime: join(dir, "runtime"), trees: ["vendor/candidate"], patch: "a".repeat(64), schema: "b".repeat(64) });
      const selection = { manifest: path, launcher: join(dir, "omp") };
      const before = await inspectInstallation(selection);
      if (mutation === "launcher-symlink") {
        await rm(join(dir, "omp"));
        await symlink("other.js", join(dir, "omp"));
      } else {
        const file = { "launcher-content": "cli.js", "runtime-content": "runtime",
          "dependency-content": "dependency.node", "new-dependency": "unreviewed.js" }[mutation];
        if (file === undefined) throw new Error("fixture mutation not defined");
        await writeFile(join(dir, file), "same-version replacement");
      }
      await expect(before.verify()).rejects.toThrow();
      await expect(inspectInstallation(selection)).rejects.toThrow("INSTALLATION_UNVERIFIED");
    } finally { await rm(root, { recursive: true, force: true }); }
  });
}

test("untracked intermediate dependency symlinks cannot be enrolled as a complete closure", async () => {
  const root = await mkdtemp(join(tmpdir(), "omp-indirect-link-"));
  try {
    const dir = join(root, "vendor/candidate");
    await mkdir(dir, { recursive: true });
    await writeFile(join(root, "final.js"), "fixture");
    await symlink("final.js", join(root, "middle"));
    await symlink("../../middle", join(dir, "dependency"));
    await expect(writeInstallationManifest({ root, path: join(dir, "installation.json"), launcher: "unused",
      target: "unused", runtime: process.execPath, trees: ["vendor/candidate"],
      patch: "a".repeat(64), schema: "b".repeat(64) })).rejects.toThrow("Indirect symlink unsupported");
  } finally { await rm(root, { recursive: true, force: true }); }
});
