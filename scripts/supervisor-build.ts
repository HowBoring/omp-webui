import { constants } from "node:fs";
import { copyFile, lstat, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { acquireMaintenanceLease, type MaintenanceControl,
  type MaintenanceLease } from "../packages/delivery/maintenance.ts";

export interface SupervisorFenceDirectory { path: string; device: string; inode: string }

async function exists(path: string): Promise<boolean> {
  try { await lstat(path); return true; } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}

export interface SupervisorBuildInput {
  root: string; control: MaintenanceControl; fences: SupervisorFenceDirectory;
  dispatcher: { endpoint: string; installation: string };
}

export type SupervisorBuildFailure = "unsupported" | "enrolled" | "destination" | "fence"
  | "compile" | "io" | "maintenance";
/** Concrete entry points provide audited policy names, never caller-selectable execution policy. */
export interface SupervisorBuildPolicy {
  binary: string;
  source: string;
  temporaryPrefix: string;
  configuration: string;
  provenance: readonly { source: string; destination: string }[];
  error(failure: SupervisorBuildFailure, cause?: unknown): Error;
}

async function validateBuild(input: SupervisorBuildInput, policy: SupervisorBuildPolicy): Promise<void> {
  const root = resolve(input.root);
  const dispatcher = input.dispatcher;
  if (!dispatcher || !/^[a-f0-9]{64}$/.test(dispatcher.installation)
    || !isAbsolute(dispatcher.endpoint) || resolve(dispatcher.endpoint) !== dispatcher.endpoint
    || !/^[\x20-\x7e]{1,107}$/.test(dispatcher.endpoint)) throw policy.error("unsupported");
  if (!isAbsolute(input.root) || input.root !== root || await realpath(root) !== root) {
    throw policy.error("unsupported");
  }
  if (await exists(join(root, "release.json"))) throw policy.error("enrolled");
  if (await exists(join(root, "bin", policy.binary))) throw policy.error("destination");
  for (const stable of [input.control, input.fences]) {
    if (!isAbsolute(stable.path) || resolve(stable.path) !== stable.path || !/^[\x20-\x7e]+$/.test(stable.path)
      || !/^\d+$/.test(stable.device) || !/^\d+$/.test(stable.inode)
      || stable.path === root || stable.path.startsWith(`${root}/`)) throw policy.error("unsupported");
  }
}

async function prepareDirectories(input: SupervisorBuildInput, policy: SupervisorBuildPolicy): Promise<void> {
  const root = input.root;
  const directory = await lstat(input.fences.path, { bigint: true });
  if (await realpath(input.fences.path) !== input.fences.path || !directory.isDirectory()
    || directory.dev.toString() !== input.fences.device || directory.ino.toString() !== input.fences.inode) {
    throw policy.error("fence");
  }
  await mkdir(join(root, "bin"), { recursive: true });
  await mkdir(join(root, "provenance"), { recursive: true });
  for (const directory of [join(root, "bin"), join(root, "provenance")]) {
    if (await realpath(directory) !== directory || !(await lstat(directory)).isDirectory()) {
      throw policy.error("unsupported");
    }
  }
}

async function writeConfiguration(input: SupervisorBuildInput, temporary: string): Promise<string> {
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

async function compile(temporary: string, header: string, policy: SupervisorBuildPolicy): Promise<void> {
  const command = ["/usr/bin/gcc", "-std=c11", "-Wall", "-Wextra", "-Werror", "-O2", "-static",
    "-include", header, policy.source, "-o", join(temporary, policy.binary)];
  try {
    const compiler = Bun.spawn(command, { env: { PATH: "/usr/bin:/bin" }, stdout: "ignore", stderr: "ignore" });
    if (await compiler.exited !== 0) throw policy.error("compile");
  } catch (error) { throw policy.error("compile", error); }
}

async function publish(input: SupervisorBuildInput, temporary: string, header: string,
  policy: SupervisorBuildPolicy): Promise<void> {
  await copyFile(join(temporary, policy.binary), join(input.root, "bin", policy.binary), constants.COPYFILE_EXCL);
  for (const member of policy.provenance) {
    await copyFile(member.source, join(input.root, "provenance", member.destination), constants.COPYFILE_EXCL);
  }
  await copyFile(header, join(input.root, "provenance", policy.configuration), constants.COPYFILE_EXCL);
}

async function maintenanceLease(input: SupervisorBuildInput, policy: SupervisorBuildPolicy): Promise<MaintenanceLease> {
  try { return await acquireMaintenanceLease(input.control, "use"); }
  catch (error) { throw policy.error("maintenance", error); }
}

async function buildWithLease(input: SupervisorBuildInput, lease: MaintenanceLease,
  policy: SupervisorBuildPolicy): Promise<void> {
  let temporary: string | undefined;
  try {
    temporary = await mkdtemp(join(tmpdir(), policy.temporaryPrefix));
    await prepareDirectories(input, policy);
    const header = await writeConfiguration(input, temporary);
    await compile(temporary, header, policy);
    await publish(input, temporary, header, policy);
    try { await lease.verify(); }
    catch (error) { throw policy.error("maintenance", error); }
  } finally {
    try { if (temporary) await rm(temporary, { recursive: true, force: true }); }
    finally {
      try { await lease.release(); }
      catch (error) { throw policy.error("maintenance", error); }
    }
  }
}

/** Shared build mechanics only; entry points retain independent executables, provenance and public error codes. */
export async function buildSupervisor(input: SupervisorBuildInput, policy: SupervisorBuildPolicy): Promise<void> {
  try {
    await validateBuild(input, policy);
    await buildWithLease(input, await maintenanceLease(input, policy), policy);
  } catch (error) { throw policy.error("io", error); }
}
