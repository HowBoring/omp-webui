import { constants } from "node:fs";
import { copyFile, lstat, mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { isMainThread } from "node:worker_threads";
import type { MaintenanceControl } from "../packages/delivery/maintenance.ts";
import { ControlIoError } from "../packages/control-io/errors.ts";
import { buildPublicControlIo, controlIoPublicMembers } from "./build-control-io-public.ts";

export interface ControlIoBuild { root: string; control: MaintenanceControl }
const nativePublications = ["lib/libomp-control-io.so", "provenance/owned-control-io.c", "provenance/owned-control-io.h"] as const;
const publications = [...nativePublications, ...controlIoPublicMembers];
async function absent(path: string): Promise<void> {
  try { await lstat(path); }
  catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
    throw error;
  }
  throw new ControlIoError("CONTROL_IO_UNAPPROVED");
}
async function validate(input: ControlIoBuild): Promise<void> {
  if (!isMainThread || process.platform !== "linux" || !isAbsolute(input.root) || resolve(input.root) !== input.root
    || await realpath(input.root) !== input.root || !(await lstat(input.root)).isDirectory()
    || !isAbsolute(input.control.path) || resolve(input.control.path) !== input.control.path
    || input.control.path === input.root || input.control.path.startsWith(`${input.root}/`)
    || !/^\d+$/.test(input.control.device) || !/^\d+$/.test(input.control.inode)) {
    throw new ControlIoError("CONTROL_IO_UNSUPPORTED");
  }
  await absent(join(input.root, "release.json"));
  for (const path of publications) await absent(join(input.root, path));
}
/** Fresh unenrolled release only. No install, enrollment, approval generation, dlopen or execution of the result.
 * Uses existing delivery maintenance; inventory/approval stays with delivery's separate explicit operator workflow. */
export async function buildControlIo(input: ControlIoBuild): Promise<void> {
  let temporary: string | undefined;
  try {
    await validate(input);
    const { acquireMaintenanceLease } = await import("../packages/delivery/maintenance.ts");
    const lease = await acquireMaintenanceLease(input.control, "update");
    try {
      await validate(input);
      temporary = await mkdtemp("/tmp/omp-control-io-build-");
      for (const name of ["lib", "provenance", "control-io", "provenance/control-io"]) {
        const path = join(input.root, name);
        await mkdir(path, { recursive: true });
        if (await realpath(path) !== path || !(await lstat(path)).isDirectory()) {
          throw new ControlIoError("CONTROL_IO_UNAPPROVED");
        }
      }
      const source = join(temporary, "owned-control-io.c");
      const header = join(temporary, "owned-control-io.h");
      for (const name of ["owned-control-io.c", "owned-control-io.h"]) {
        await copyFile(resolve(import.meta.dir, "../compatibility/control-io", name), join(temporary, name),
          constants.COPYFILE_EXCL);
      }
      const binary = join(temporary, "libomp-control-io.so");
      const compiler = Bun.spawn(["/usr/bin/gcc", "-std=c11", "-Wall", "-Wextra", "-Werror", "-Wconversion",
        "-Wsign-conversion", "-Wshadow", "-Wformat=2", "-O2", "-fPIC", "-fvisibility=hidden", "-shared",
        source, "-Wl,-z,defs,-z,relro,-z,now", "-o", binary],
      { env: { PATH: "/usr/bin:/bin" }, stdout: "ignore", stderr: "ignore" });
      if (await compiler.exited !== 0) throw new ControlIoError("CONTROL_IO_LOAD_FAILED");
      await buildPublicControlIo(temporary);
      await lease.verify();
      await validate(input);
      for (const [index, sourcePath] of [binary, source, header].entries()) {
        const destination = nativePublications[index];
        if (!destination) throw new ControlIoError("CONTROL_IO_ARGUMENT");
        await copyFile(sourcePath, join(input.root, destination), constants.COPYFILE_EXCL);
      }
      for (const member of controlIoPublicMembers) {
        await copyFile(join(temporary, member), join(input.root, member), constants.COPYFILE_EXCL);
      }
      await lease.verify();
    } finally { await lease.release(); }
  } catch (error) {
    throw error instanceof ControlIoError ? error : new ControlIoError("CONTROL_IO_LOAD_FAILED");
  } finally { if (temporary) await rm(temporary, { recursive: true, force: true })
    .catch(() => { throw new ControlIoError("CONTROL_IO_LOAD_FAILED"); }); }
}
if (import.meta.main) throw new ControlIoError("CONTROL_IO_UNSUPPORTED");
