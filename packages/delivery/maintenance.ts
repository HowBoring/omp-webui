import { dlopen, FFIType } from "bun:ffi";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

/** Independently approved stable control inode, outside every replaceable release/entry/dependency tree. */
export interface MaintenanceControl { path: string; device: string; inode: string }
export interface MaintenanceLease {
  /** Detects control pathname replacement. Cooperative installers must never unlink or replace this inode. */
  verify(): Promise<void>;
  release(): Promise<void>;
}

/** Linux cooperative maintenance only. This is not protection against package managers or hostile same-UID writers. */
export async function acquireMaintenanceLease(
  control: MaintenanceControl, mode: "use" | "update",
): Promise<MaintenanceLease> {
  if (process.platform !== "linux") throw new Error("MAINTENANCE_BACKEND_UNSUPPORTED");
  if (!isAbsolute(control.path) || resolve(control.path) !== control.path || await realpath(control.path) !== control.path) {
    throw new Error("MAINTENANCE_CONTROL_CHANGED");
  }
  const native = dlopen("libc.so.6", { flock: { args: [FFIType.int, FFIType.int], returns: FFIType.int } });
  const file = await open(control.path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK).catch(error => {
    native.close();
    throw error;
  });
  let released = false;
  const verify = async (): Promise<void> => {
    if (released || await realpath(control.path) !== control.path) throw new Error("MAINTENANCE_CONTROL_CHANGED");
    const path = await lstat(control.path, { bigint: true });
    const fd = await file.stat({ bigint: true });
    for (const stat of [path, fd]) {
      if (!stat.isFile() || stat.nlink !== 1n || stat.dev.toString() !== control.device
        || stat.ino.toString() !== control.inode) throw new Error("MAINTENANCE_CONTROL_CHANGED");
    }
  };
  const release = async (): Promise<void> => {
    if (released) return;
    released = true;
    try { await file.close(); } finally { native.close(); }
  };
  try {
    await verify();
    // LOCK_SH/LOCK_EX plus LOCK_NB: never wait behind an unknown TUI or an updater.
    if (native.symbols.flock(file.fd, (mode === "use" ? 1 : 2) | 4) !== 0) {
      throw new Error("MAINTENANCE_UNAVAILABLE");
    }
    await verify();
    return { verify, release };
  } catch (error) {
    await release();
    throw error;
  }
}
