import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { MaintenanceControl } from "../packages/delivery/maintenance.ts";

/** Operator build action only. Pin the stable installation control inode into all normal TUI/Host entry paths. */
export async function buildControlledLauncher(input: { root: string; control: MaintenanceControl }): Promise<void> {
  if (process.platform !== "linux" || !/^[\x20-\x7e]+$/.test(input.control.path)
    || !/^\d+$/.test(input.control.device) || !/^\d+$/.test(input.control.inode)) {
    throw new Error("LAUNCHER_BUILD_UNSUPPORTED");
  }
  if (input.control.path === resolve(input.root) || input.control.path.startsWith(`${resolve(input.root)}/`)) {
    throw new Error("LAUNCHER_CONTROL_INSIDE_RELEASE");
  }
  const temporary = await mkdtemp(join(tmpdir(), "omp-launcher-build-"));
  try {
    await mkdir(join(input.root, "bin"), { recursive: true });
    const header = join(temporary, "control.h");
    await writeFile(header, `#define OMP_CONTROL_PATH ${JSON.stringify(input.control.path)}\n`
      + `#define OMP_CONTROL_DEVICE UINTMAX_C(${input.control.device})\n`
      + `#define OMP_CONTROL_INODE UINTMAX_C(${input.control.inode})\n`);
    const child = Bun.spawn(["/usr/bin/gcc", "-std=c11", "-Wall", "-Wextra", "-Werror", "-O2", "-static",
      "-include", header, resolve(import.meta.dir, "../compatibility/launcher/omp-entry.c"),
      "-o", join(input.root, "bin/omp")], { env: { PATH: "/usr/bin:/bin" }, stdout: "pipe", stderr: "pipe" });
    const [code, diagnostics] = await Promise.all([child.exited, new Response(child.stderr).text()]);
    if (code !== 0) throw new Error(`LAUNCHER_BUILD_FAILED: ${diagnostics.slice(0, 4096)}`);
  } finally { await rm(temporary, { recursive: true, force: true }); }
}

if (import.meta.main) {
  throw new Error("Use the typed buildControlledLauncher operator interface with independently approved control metadata");
}
