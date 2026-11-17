import { constants } from "node:fs";
import { copyFile, lstat, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { acquireMaintenanceLease, type MaintenanceControl, type MaintenanceLease } from "../packages/delivery/maintenance.ts";
import { PrivateHelperError, helperError } from "../packages/supervision/errors.ts";

export interface PrivateFenceDirectory { path: string; device: string; inode: string }

async function exists(path: string): Promise<boolean> {
  try { await lstat(path); return true; } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}

export interface PrivateHelperBuild {
  root: string; control: MaintenanceControl; fences: PrivateFenceDirectory;
  dispatcher: { endpoint: string; installation: string };
}

async function validateBuild(input: PrivateHelperBuild): Promise<void> {
  const root = resolve(input.root);
  const dispatcher = input.dispatcher;
  if (!dispatcher || !/^[a-f0-9]{64}$/.test(dispatcher.installation)
    || !isAbsolute(dispatcher.endpoint) || resolve(dispatcher.endpoint) !== dispatcher.endpoint
    || !/^[\x20-\x7e]{1,107}$/.test(dispatcher.endpoint)) throw new PrivateHelperError("HELPER_BUILD_UNSUPPORTED");
  if (!isAbsolute(input.root) || input.root !== root || await realpath(root) !== root) {
    throw new PrivateHelperError("HELPER_BUILD_UNSUPPORTED");
  }
  if (await exists(join(root, "release.json"))) throw new PrivateHelperError("HELPER_BUILD_REQUIRES_FRESH_RELEASE");
  if (await exists(join(root, "bin/omp-private-helper"))) throw new PrivateHelperError("HELPER_BUILD_DESTINATION_EXISTS");
  for (const stable of [input.control, input.fences]) {
    if (!isAbsolute(stable.path) || resolve(stable.path) !== stable.path || !/^[\x20-\x7e]+$/.test(stable.path)
      || !/^\d+$/.test(stable.device) || !/^\d+$/.test(stable.inode)
      || stable.path === root || stable.path.startsWith(`${root}/`)) throw new PrivateHelperError("HELPER_BUILD_UNSUPPORTED");
  }
}

async function prepareDirectories(input: PrivateHelperBuild): Promise<void> {
  const root = input.root;
  const directory = await lstat(input.fences.path, { bigint: true });
  if (await realpath(input.fences.path) !== input.fences.path || !directory.isDirectory()
    || directory.dev.toString() !== input.fences.device || directory.ino.toString() !== input.fences.inode) {
    throw new PrivateHelperError("HELPER_FENCE_CHANGED");
  }
  await mkdir(join(root, "bin"), { recursive: true });
  await mkdir(join(root, "provenance"), { recursive: true });
  for (const directory of [join(root, "bin"), join(root, "provenance")]) {
    if (await realpath(directory) !== directory || !(await lstat(directory)).isDirectory()) {
      throw new PrivateHelperError("HELPER_BUILD_UNSUPPORTED");
    }
  }
}

async function writeConfiguration(input: PrivateHelperBuild, temporary: string): Promise<string> {
  const { root, dispatcher } = input;
  const header = join(temporary, "configuration.h");
  await writeFile(header, `#define OMP_DISPATCHER_PATH ${JSON.stringify(dispatcher.endpoint)}\n`
    + `#define OMP_INSTALLATION_ID ${JSON.stringify(dispatcher.installation)}\n`
    + `#define OMP_NATIVE_ENTRY ${JSON.stringify(join(root, "bin/omp"))}\n`
    + `#define OMP_CONTROL_PATH ${JSON.stringify(input.control.path)}\n`
    + `#define OMP_CONTROL_DEVICE UINTMAX_C(${input.control.device})\n`
    + `#define OMP_CONTROL_INODE UINTMAX_C(${input.control.inode})\n`
    + `#define OMP_FENCE_PATH ${JSON.stringify(input.fences.path)}\n`
    + `#define OMP_FENCE_DEVICE UINTMAX_C(${input.fences.device})\n`
    + `#define OMP_FENCE_INODE UINTMAX_C(${input.fences.inode})\n`);
  return header;
}

async function compileHelper(temporary: string, header: string): Promise<string> {
  const source = resolve(import.meta.dir, "../compatibility/supervision/private-helper.c");
  const command = ["/usr/bin/gcc", "-std=c11", "-Wall", "-Wextra", "-Werror", "-O2", "-static",
    "-include", header, source, "-o", join(temporary, "omp-private-helper")];
  try {
    const compiler = Bun.spawn(command, { env: { PATH: "/usr/bin:/bin" }, stdout: "ignore", stderr: "ignore" });
    if (await compiler.exited !== 0) throw new PrivateHelperError("HELPER_BUILD_FAILED");
  } catch (error) { throw helperError("HELPER_BUILD_FAILED", error); }
  return source;
}

async function publishHelper(input: PrivateHelperBuild, temporary: string, header: string, source: string): Promise<void> {
  const root = input.root;
  await copyFile(join(temporary, "omp-private-helper"), join(root, "bin/omp-private-helper"), constants.COPYFILE_EXCL);
  await copyFile(source, join(root, "provenance/private-helper.c"), constants.COPYFILE_EXCL);
  await copyFile(resolve(import.meta.dir, "../compatibility/supervision/candidates.h"),
    join(root, "provenance/candidates.h"), constants.COPYFILE_EXCL);
  await copyFile(resolve(import.meta.dir, "../compatibility/launcher/control.h"), join(root, "provenance/control.h"), constants.COPYFILE_EXCL);
  await copyFile(header, join(root, "provenance/private-helper-configuration.h"), constants.COPYFILE_EXCL);
}

async function maintenanceLease(input: PrivateHelperBuild): Promise<MaintenanceLease> {
  try { return await acquireMaintenanceLease(input.control, "use"); }
  catch (error) { throw helperError("HELPER_MAINTENANCE_FAILED", error); }
}

async function buildWithLease(input: PrivateHelperBuild, lease: MaintenanceLease): Promise<void> {
  let temporary: string | undefined;
  try {
    temporary = await mkdtemp(join(tmpdir(), "omp-helper-build-"));
    await prepareDirectories(input);
    const header = await writeConfiguration(input, temporary);
    const source = await compileHelper(temporary, header);
    await publishHelper(input, temporary, header, source);
    try { await lease.verify(); }
    catch (error) { throw helperError("HELPER_MAINTENANCE_FAILED", error); }
  } finally {
    try { if (temporary) await rm(temporary, { recursive: true, force: true }); }
    finally {
      try { await lease.release(); }
      catch (error) { throw helperError("HELPER_MAINTENANCE_FAILED", error); }
    }
  }
}

/** Explicit operator build only. Never enrolls approval, installs globally or starts the helper. */
export async function buildPrivateHelper(input: PrivateHelperBuild): Promise<void> {
  try {
    await validateBuild(input);
    await buildWithLease(input, await maintenanceLease(input));
  } catch (error) { throw helperError("HELPER_BUILD_IO_FAILED", error); }
}
if (import.meta.main) throw new PrivateHelperError("HELPER_BUILD_UNSUPPORTED");
