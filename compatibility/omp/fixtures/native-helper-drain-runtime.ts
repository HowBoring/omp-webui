/** TEST HARNESS only. This runtime is not owner-global OMP or a selectable browser/Native backend. */
import * as fs from "node:fs/promises";
import { constants } from "node:fs";
import { createHash } from "node:crypto";
import { z } from "zod";

const unsigned = z.string().regex(/^(?:0|[1-9]\d{0,19})$/)
  .refine(value => BigInt(value) <= 18446744073709551615n);
export const helperDrainRuntime = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("staged-runtime/1") }),
  z.strictObject({ kind: z.literal("root-platform-runtime/1"),
    path: z.literal("/workspace/work/rpc-public-module-probe/tooling/bun/package/bin/bun"),
    device: unsigned, inode: unsigned.refine(value => value !== "0"),
    sha256: z.literal("10702245766b225e70bbf6235fd6b47214fd94b4760d00ffaed8ab0df57ac235"),
    size: z.literal(107308936), uid: z.number().int().min(0).max(4294967295), mode: z.literal(0o755) }),
]);
export type HelperDrainRuntime = z.infer<typeof helperDrainRuntime>;
type ExternalRuntime = Extract<HelperDrainRuntime, { kind: "root-platform-runtime/1" }>;
interface RuntimeStat {
  device: string; inode: string; size: number; uid: number; mode: number; nlink: number;
  regular: boolean; mtime: string; ctime: string;
}
export interface HelperDrainRuntimeObservation {
  path: string; realpath: string; before: RuntimeStat; after: RuntimeStat; sha256: string;
}

/** Public pure authentication seam. Observations in production come only from the bounded no-follow reader below. */
export function assertHelperDrainRuntimeIdentity(input: ExternalRuntime,
  observed: HelperDrainRuntimeObservation): void {
  const runtime = helperDrainRuntime.parse(input);
  if (runtime.kind !== "root-platform-runtime/1") throw new Error("DRAIN_RUNTIME_VARIANT");
  const expected = { device: runtime.device, inode: runtime.inode, size: runtime.size, uid: runtime.uid,
    mode: runtime.mode, nlink: 1, regular: true };
  if (observed.path !== runtime.path || observed.realpath !== runtime.path || observed.sha256 !== runtime.sha256
    || Object.entries(expected).some(([key, value]) => Reflect.get(observed.before, key) !== value)
    || Object.keys(observed.before).some(key =>
      Reflect.get(observed.before, key) !== Reflect.get(observed.after, key))) {
    throw new Error("DRAIN_RUNTIME_CHANGED");
  }
}
function snapshot(stat: import("node:fs").BigIntStats): RuntimeStat {
  return { device: String(stat.dev), inode: String(stat.ino), size: Number(stat.size), uid: Number(stat.uid),
    mode: Number(stat.mode & 0o7777n), nlink: Number(stat.nlink), regular: stat.isFile(),
    mtime: String(stat.mtimeNs), ctime: String(stat.ctimeNs) };
}

/** Bound the regular file before reading; reject aliases and recheck descriptor and path afterward. */
export async function readHelperDrainRuntime(input: ExternalRuntime): Promise<void> {
  const runtime = helperDrainRuntime.parse(input);
  if (runtime.kind !== "root-platform-runtime/1") throw new Error("DRAIN_RUNTIME_VARIANT");
  const before = snapshot(await fs.lstat(runtime.path, { bigint: true })), realpath = await fs.realpath(runtime.path);
  assertHelperDrainRuntimeIdentity(runtime, { path: runtime.path, realpath, before,
    after: before, sha256: runtime.sha256 });
  if (runtime.uid !== process.getuid?.()) throw new Error("DRAIN_RUNTIME_OWNER");
  const handle = await fs.open(runtime.path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    assertHelperDrainRuntimeIdentity(runtime, { path: runtime.path, realpath, before,
      after: snapshot(await handle.stat({ bigint: true })), sha256: runtime.sha256 });
    const hash = createHash("sha256"); let size = 0;
    for await (const bytes of handle.createReadStream({ autoClose: false })) {
      size += bytes.length;
      if (size > runtime.size) throw new Error("DRAIN_RUNTIME_LIMIT");
      hash.update(bytes);
    }
    const observed = { path: runtime.path, realpath: await fs.realpath(runtime.path), before,
      after: snapshot(await handle.stat({ bigint: true })), sha256: hash.digest("hex") };
    assertHelperDrainRuntimeIdentity(runtime, observed);
    assertHelperDrainRuntimeIdentity(runtime, { ...observed,
      after: snapshot(await fs.lstat(runtime.path, { bigint: true })) });
  } finally { await handle.close(); }
}
export interface HelperDrainExecution {
  execPath: string; executable: { path: string; device: string; inode: string }; uid: number; version: string;
  execArgv: readonly string[]; argv: readonly string[];
}

/** Exact C launcher argv/config/handoff binding; no Root operator, role or browser argument selects a runtime. */
export function assertHelperDrainExecution(stage: string, runtime: HelperDrainRuntime,
  observed: HelperDrainExecution): void {
  const selected = helperDrainRuntime.parse(runtime);
  const file = selected.kind === "root-platform-runtime/1" ? selected.path : `${stage}/launch/runtime/bun`;
  const handoff = observed.argv[2] ?? "";
  if (!/^\/tmp\/native-helper-drain-[A-Za-z0-9-]+$/.test(stage)
    || observed.execPath !== file || observed.executable.path !== file || observed.version !== "1.4.4"
    || (selected.kind === "root-platform-runtime/1" && (observed.uid !== selected.uid
      || observed.executable.device !== selected.device || observed.executable.inode !== selected.inode))
    || JSON.stringify(observed.execArgv)
      !== JSON.stringify(["--no-env-file", `--config=${stage}/launch/runtime/bunfig.toml`])
    || observed.argv.length !== 4 || observed.argv[0] !== file || observed.argv[1] !== `${stage}/launch/worker/cli.js`
    || !/^--omp-maintenance-handoff=1:(?:[3-9]|[1-9]\d{1,9})$/.test(handoff)
    || Number(handoff.slice("--omp-maintenance-handoff=1:".length)) > 2147483647
    || !["--fixture-native", "--fixture-host"].includes(observed.argv[3] ?? "")) {
    throw new Error("DRAIN_EXECUTION_CHANGED");
  }
}
