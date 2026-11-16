import { expect, test } from "bun:test";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeReleaseManifest } from "../../packages/delivery/artifact.ts";
import { acquireMaintenanceLease } from "../../packages/delivery/maintenance.ts";
import { inspectCoordinatedSelection } from "../../packages/delivery/coordinator.ts";
import { fixtureRelease } from "./fixtures.ts";

test("operator inspection retains its shared lease through verification and never grants Session admission", async () => {
  const parent = await mkdtemp(join(tmpdir(), "delivery-coordinator-"));
  try {
    const root = await fixtureRelease(parent);
    const expectedIdentity = await writeReleaseManifest({ root, platformDependencies: [] });
    const path = join(parent, "maintenance.lock");
    await writeFile(path, "", { mode: 0o600, flag: "wx" });
    const metadata = await stat(path, { bigint: true });
    const control = { path, device: metadata.dev.toString(), inode: metadata.ino.toString() };
    const selection = await inspectCoordinatedSelection({ root, expectedIdentity, entry: join(root, "bin/omp"), control });
    expect(selection.sessionAdmission).toBe("blocked");
    await selection.verify();
    await expect(acquireMaintenanceLease(control, "update")).rejects.toThrow("MAINTENANCE_UNAVAILABLE");
    await selection.release();
    await expect(selection.verify()).rejects.toThrow("MAINTENANCE_CONTROL_CHANGED");
    const update = await acquireMaintenanceLease(control, "update");
    await update.release();
  } finally { await rm(parent, { recursive: true, force: true }); }
});
