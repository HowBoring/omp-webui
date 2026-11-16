import * as fs from "node:fs/promises";
import { constants } from "node:fs";
import * as path from "node:path";
import { buildControlledLauncher } from "./build-controlled-launcher.ts";

/** Source/static/file preparation only. Never executes a fixture, probe, launcher or copied Bun. */
const repo = path.resolve(import.meta.dir, ".."), runtimeSource = "/workspace/work/rpc-public-module-probe/tooling/bun/package/bin/bun";
const approvedRuntimeSha256 = "10702245766b225e70bbf6235fd6b47214fd94b4760d00ffaed8ab0df57ac235";
const hash = (bytes: Uint8Array | string): string => new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
const sourceStat = await fs.lstat(runtimeSource), runtimeBytes = await fs.readFile(runtimeSource);
if (!sourceStat.isFile() || sourceStat.nlink !== 1 || sourceStat.size > 116 * 1024 * 1024
  || await fs.realpath(runtimeSource) !== runtimeSource || hash(runtimeBytes) !== approvedRuntimeSha256) {
  throw new Error("LAUNCHER_TRACER_APPROVED_RUNTIME_CHANGED");
}
const root = await fs.mkdtemp("/tmp/launcher-lock-tracer-"); await fs.chmod(root, 0o700);
const release = path.join(root, "release");
for (const name of ["release", "release/bin", "release/runtime", "release/worker", "home", "profile", "cwd",
  "config", "data", "state", "cache", "tools"]) await fs.mkdir(path.join(root, name), { mode: 0o700 });
const marker = path.join(root, "home/fixture-marker.json");
await fs.writeFile(marker, JSON.stringify({ kind: "launcher-lock-synthetic-home/1", privateData: false }), { mode: 0o600, flag: "wx" });
const targetRuntime = path.join(release, "runtime/bun");
let copyMethod = "COPYFILE_FICLONE_FORCE|EXCL", cloneFailure: string | undefined;
try { await fs.copyFile(runtimeSource, targetRuntime, constants.COPYFILE_FICLONE_FORCE | constants.COPYFILE_EXCL); }
catch (error) {
  if (!(error instanceof Error) || !("code" in error) || !["ENOTSUP", "EOPNOTSUPP", "ENOSYS", "EINVAL", "EXDEV"].includes(String(error.code))) throw error;
  cloneFailure = String(error.code);
  await fs.rm(targetRuntime, { force: true });
  const available = await fs.statfs(root, { bigint: true });
  if (available.bavail * available.bsize - BigInt(sourceStat.size) < 768n * 1024n * 1024n) throw new Error("LAUNCHER_TRACER_COPY_DISK_BUDGET");
  await fs.copyFile(runtimeSource, targetRuntime, constants.COPYFILE_EXCL); copyMethod = "SINGLE_REAL_COPY_EXCL";
}
await fs.chmod(targetRuntime, sourceStat.mode & 0o777);
const targetStat = await fs.lstat(targetRuntime), available = await fs.statfs(root, { bigint: true });
if (!targetStat.isFile() || targetStat.nlink !== 1 || await fs.realpath(targetRuntime) !== targetRuntime
  || targetStat.size !== sourceStat.size || hash(await fs.readFile(targetRuntime)) !== approvedRuntimeSha256
  || hash(await fs.readFile(runtimeSource)) !== approvedRuntimeSha256 || available.bavail * available.bsize < 768n * 1024n * 1024n) {
  throw new Error("LAUNCHER_TRACER_MATERIALIZATION_INVALID");
}
const controlPath = path.join(root, "maintenance.lock"); await fs.writeFile(controlPath, "", { mode: 0o600, flag: "wx" });
const controlStat = await fs.stat(controlPath, { bigint: true });
const control = { path: controlPath, device: String(controlStat.dev), inode: String(controlStat.ino) };
await buildControlledLauncher({ root: release, control });
const childSource = path.join(repo, "tests/delivery/fixtures/launcher-lock-child.ts");
const built = await Bun.build({ entrypoints: [childSource], target: "bun", format: "esm", outdir: path.join(release, "worker"),
  naming: "cli.js" });
if (!built.success) throw new Error("LAUNCHER_TRACER_CHILD_STATIC_BUILD_FAILED");
await fs.copyFile(path.join(repo, "compatibility/omp/fixtures/no-provider.ts"), path.join(release, "runtime/no-provider.ts"), constants.COPYFILE_EXCL);
await fs.writeFile(path.join(release, "runtime/bunfig.toml"),
  `telemetry = false\npreload = [${JSON.stringify(path.join(release, "runtime/no-provider.ts"))}]\n`, { mode: 0o600, flag: "wx" });
const probe = path.join(root, "tools/exclusive-probe"), compiler = await fs.realpath("/usr/bin/gcc");
const probeSource = path.join(repo, "tests/delivery/fixtures/maintenance-exclusive-probe.c");
const compilerArgs = ["-std=c11", "-Wall", "-Wextra", "-Werror", "-Wpedantic", "-Wconversion", "-Wshadow", "-Wformat=2",
  "-O2", "-static", probeSource, "-o", probe];
const compiled = Bun.spawnSync([compiler, ...compilerArgs], { env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" },
  cwd: root, stdout: "pipe", stderr: "pipe", timeout: 30_000 });
if (compiled.exitCode !== 0) throw new Error("LAUNCHER_TRACER_PROBE_COMPILE_FAILED:" + compiled.stderr.toString().slice(0, 4096));
const wrapper = path.join(repo, "scripts/retain-launcher-lock-tracer.py");
const files = [runtimeSource, targetRuntime, path.join(release, "bin/omp"), path.join(release, "worker/cli.js"),
  path.join(release, "runtime/bunfig.toml"), path.join(release, "runtime/no-provider.ts"), controlPath, marker, probe,
  compiler, await fs.realpath("/opt/codex/runtimes/codex-primary-runtime/dependencies/python/bin/python3"),
  path.join(repo, "compatibility/launcher/omp-entry.c"), path.join(repo, "scripts/build-controlled-launcher.ts"),
  path.join(repo, "packages/delivery/artifact.ts"), path.join(repo, "packages/delivery/resolver.ts"),
  path.join(repo, "compatibility/omp/fixtures/no-provider.ts"), childSource, probeSource, wrapper,
  path.join(repo, "scripts/prepare-launcher-lock-tracer.ts")];
const identities = await Promise.all(files.sort().map(async file => {
  const stat = await fs.lstat(file, { bigint: true });
  return { file, bytes: Number(stat.size), sha256: hash(await fs.readFile(file)), mode: Number(stat.mode & 0o777n),
    device: String(stat.dev), inode: String(stat.ino), links: Number(stat.nlink) };
}));
const fixture = { format: "omp-launcher-lock-tracer/1", scope: "mechanical-existing-C-launcher-to-real-Bun-lock-retention-only",
  root, release, control, entry: path.join(release, "bin/omp"), runtime: targetRuntime, worker: path.join(release, "worker/cli.js"),
  probe, sourceInputs: identities, syntheticHome: path.join(root, "home"), marker,
  runtimeMaterialization: { method: copyMethod, cloneFailure: cloneFailure ?? null, source: runtimeSource, target: targetRuntime,
    bytes: sourceStat.size, sourceSha256: approvedRuntimeSha256, targetSha256: approvedRuntimeSha256,
    mode: targetStat.mode & 0o777, links: targetStat.nlink, postFreeBytes: String(available.bavail * available.bsize),
    maximumBytes: 116 * 1024 * 1024, minimumFreeBytes: 768 * 1024 * 1024 },
  probeCompiler: { file: compiler, args: compilerArgs, stderrBytes: compiled.stderr.length },
  budgets: { readyMs: 5000, probeMs: 5000, eofMs: 5000, childHardDeadlineMs: 20000, retentionWarnMs: 30000,
    outputBytesPerChild: 8192, admittedChildren: 4, signals: 0 },
  executed: false, locksProbed: false, actualGlobal: "BLOCKED", privateAdmission: "BLOCKED",
  note: "Not a complete release inventory or production installation; unchanged launcher regular/nlink1/canonical member requirements remain mandatory." };
const destination = path.join(root, "fixture.json");
await fs.writeFile(destination, JSON.stringify(fixture, null, 2) + "\n", { mode: 0o600, flag: "wx" });
process.stdout.write(JSON.stringify({ fixture: destination, sha256: hash(await fs.readFile(destination)), inputs: identities.length,
  copyMethod, cloneFailure: cloneFailure ?? null, runtimeBytes: sourceStat.size,
  postFreeBytes: fixture.runtimeMaterialization.postFreeBytes, executed: false, locksProbed: false }) + "\n");
