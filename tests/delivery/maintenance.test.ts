import { expect, test } from "bun:test";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireMaintenanceLease } from "../../packages/delivery/maintenance.ts";

test("exclusive coordinated maintenance refuses active readers and fences new readers until release", async () => {
  const root = await mkdtemp(join(tmpdir(), "delivery-lock-"));
  try {
    const path = join(root, "maintenance.lock");
    await writeFile(path, "", { mode: 0o600, flag: "wx" });
    const metadata = await stat(path, { bigint: true });
    const control = { path, device: metadata.dev.toString(), inode: metadata.ino.toString() };
    const reader = await acquireMaintenanceLease(control, "use");
    await expect(acquireMaintenanceLease(control, "update")).rejects.toThrow("MAINTENANCE_UNAVAILABLE");
    await reader.release();
    const maintenance = await acquireMaintenanceLease(control, "update");
    await expect(acquireMaintenanceLease(control, "use")).rejects.toThrow("MAINTENANCE_UNAVAILABLE");
    await maintenance.release();
    const next = await acquireMaintenanceLease(control, "use");
    await next.verify();
    await next.release();
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("control pathname replacement never creates an independently accepted second lock domain", async () => {
  const root = await mkdtemp(join(tmpdir(), "delivery-lock-replace-"));
  try {
    const path = join(root, "maintenance.lock");
    await writeFile(path, "", { mode: 0o600, flag: "wx" });
    const metadata = await stat(path, { bigint: true });
    const control = { path, device: metadata.dev.toString(), inode: metadata.ino.toString() };
    const reader = await acquireMaintenanceLease(control, "use");
    const { rename } = await import("node:fs/promises");
    await rename(path, join(root, "original.lock"));
    await writeFile(path, "", { mode: 0o600, flag: "wx" });
    await expect(reader.verify()).rejects.toThrow("MAINTENANCE_CONTROL_CHANGED");
    await expect(acquireMaintenanceLease(control, "update")).rejects.toThrow("MAINTENANCE_CONTROL_CHANGED");
    await reader.release();
  } finally { await rm(root, { recursive: true, force: true }); }
});
