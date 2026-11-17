/** Explicit SOURCE-only compiler input plan. No imports from Native or public runtime modules. */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { BunPlugin } from "bun";
import { z } from "zod";
import { sha256 } from "./native-signed-probe-launch";

export const helperDrainNativeRoot = "/workspace/work/omp-webui-ticket-41/vendor/omp-ownership";
const sourceIdentity = z.strictObject({ sha256: z.string().regex(/^[a-f0-9]{64}$/),
  device: z.string().regex(/^\d+$/), inode: z.string().regex(/^[1-9]\d*$/),
  size: z.number().int().min(0).max(16_777_216), uid: z.number().int().nonnegative(),
  mode: z.number().int().min(0).max(0o777), nlink: z.number().int().min(1).max(8),
  mtime: z.string().regex(/^\d+$/), ctime: z.string().regex(/^\d+$/) });
const planSchema = z.strictObject({ status: z.literal("NOT_BUILT_NOT_RUN_NOT_APPROVAL"),
  repository: z.literal("/workspace/work/omp-webui-ticket-41-fixture-recovery"),
  nativeRoot: z.literal(helperDrainNativeRoot), nativeHead: z.literal("7c49c11aa5bbaf3f418406583096168ad5b8c6dc"),
  inputs: z.record(z.string(), sourceIdentity) });
export type HelperDrainSourcePlan = z.infer<typeof planSchema>;

/** Reject substitutions, missing inputs and source mutation. The plan itself is inventoried in the final closure. */
export async function readHelperDrainSourcePlan(repository: string): Promise<HelperDrainSourcePlan> {
  const file = `${repository}/compatibility/omp/fixtures/native-helper-drain-source-plan.json`;
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.nlink !== 1 || stat.size > 262144 || await fs.realpath(file) !== file) {
    throw new Error("DRAIN_SOURCE_PLAN_CHANGED");
  }
  const plan = planSchema.parse(JSON.parse(await fs.readFile(file, "utf8")));
  if (plan.repository !== repository) throw new Error("DRAIN_SOURCE_ROOT_CHANGED");
  for (const name of Object.keys(plan.inputs)) await assertHelperDrainSourceInput(plan, name);
  return plan;
}

/** The only authoring alias: the absent local Native ownership subtree to one exact pinned original root. */
export function helperDrainNativeAlias(repository: string, plan: HelperDrainSourcePlan): BunPlugin {
  const prefix = `${repository}/vendor/omp-ownership/packages/coding-agent/src/launch/ownership/`;
  return { name: "exact-original-native-source", setup(build) {
    build.onResolve({ filter: /vendor\/omp-ownership\/packages\/coding-agent\/src\/launch\/ownership\// }, args => {
      const requested = path.resolve(args.resolveDir, args.path);
      if (!requested.startsWith(prefix)) throw new Error("DRAIN_NATIVE_SOURCE_ALIAS");
      const suffix = requested.slice(prefix.length);
      const target = `${helperDrainNativeRoot}/packages/coding-agent/src/launch/ownership/${suffix}`;
      const file = path.extname(target) ? target : `${target}.ts`;
      if (!Object.hasOwn(plan.inputs, file)) throw new Error("DRAIN_UNLISTED_SOURCE_INPUT");
      return { path: file };
    });
  } };
}

/** Every compiler-reported resolved file must match the plan; no alternate source root or private SDK fallback. */
export async function assertHelperDrainSourceInput(plan: HelperDrainSourcePlan, file: string): Promise<string> {
  const canonical = await fs.realpath(file), expected = plan.inputs[canonical];
  if (!expected) throw new Error("DRAIN_UNLISTED_SOURCE_INPUT");
  const before = await fs.lstat(canonical, { bigint: true });
  const identity = { device: String(before.dev), inode: String(BigInt.asUintN(64, before.ino)), uid: Number(before.uid),
    size: Number(before.size), mode: Number(before.mode & 0o7777n), nlink: Number(before.nlink),
    mtime: String(before.mtimeNs), ctime: String(before.ctimeNs) };
  if (!before.isFile() || before.size > 16_777_216n
    || Object.entries(identity).some(([key, value]) => Reflect.get(expected, key) !== value)
    || sha256(await fs.readFile(canonical)) !== expected.sha256) throw new Error("DRAIN_SOURCE_INPUT_CHANGED");
  const after = await fs.lstat(canonical, { bigint: true });
  if (["dev", "ino", "mode", "nlink", "size", "uid", "mtimeNs", "ctimeNs"].some(key =>
    Reflect.get(before, key) !== Reflect.get(after, key))) throw new Error("DRAIN_SOURCE_INPUT_CHANGED");
  return canonical;
}
