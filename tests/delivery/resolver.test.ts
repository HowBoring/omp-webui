import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeReleaseManifest } from "../../packages/delivery/artifact.ts";
import { resolveGlobalSelection } from "../../packages/delivery/resolver.ts";
import { fixtureRelease } from "./fixtures.ts";

test("operator-selected ordinary entry resolves without executing its unknown contents or claiming global acceptance", async () => {
  const parent = await mkdtemp(join(tmpdir(), "delivery-entry-"));
  try {
    const root = await fixtureRelease(parent);
    const expectedIdentity = await writeReleaseManifest({ root, platformDependencies: [] });
    await mkdir(join(parent, "bin"));
    const entry = join(parent, "bin/omp");
    await symlink(join(root, "bin/omp"), entry);
    const selected = await resolveGlobalSelection({ entry, root, expectedIdentity });
    expect(selected.entry).toBe(entry);
    expect(selected.release.runtime).toBe(join(root, "runtime/bun"));
    expect(selected.sessionAdmission).toBe("blocked");
  } finally { await rm(parent, { recursive: true, force: true }); }
});

for (const layout of ["shell-wrapper", "indirect-link", "ancestor-link", "retarget"] as const) {
  test(`selected entry refuses ${layout} without launcher execution`, async () => {
    const parent = await mkdtemp(join(tmpdir(), "delivery-entry-negative-"));
    try {
      const root = await fixtureRelease(parent);
      const expectedIdentity = await writeReleaseManifest({ root, platformDependencies: [] });
      await mkdir(join(parent, "bin"));
      let entry = join(parent, "bin/omp");
      const fs = await import("node:fs/promises");
      if (layout === "shell-wrapper") await fs.writeFile(entry, "#!/bin/sh\nexit 0\n");
      if (layout === "indirect-link") {
        await symlink(join(root, "bin/omp"), join(parent, "bin/alias"));
        await symlink("alias", entry);
      }
      if (layout === "ancestor-link") {
        await symlink(join(root, "bin/omp"), entry);
        await symlink(join(parent, "bin"), join(parent, "linked-bin"));
        entry = join(parent, "linked-bin/omp");
      }
      if (layout === "retarget") {
        await symlink(join(root, "bin/omp"), entry);
        const selected = await resolveGlobalSelection({ entry, root, expectedIdentity });
        await fs.unlink(entry);
        await symlink(join(root, "runtime/bun"), entry);
        await expect(selected.verify()).rejects.toThrow();
        return;
      }
      await expect(resolveGlobalSelection({ entry, root, expectedIdentity })).rejects.toThrow("GLOBAL_SELECTION_UNVERIFIED");
    } finally { await rm(parent, { recursive: true, force: true }); }
  });
}
