/** Reconstruct and verify every authored DSH source file against the fixed ordered public patch set. */
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, lstat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { z } from "zod";

const manifestPath = resolve(import.meta.dir, "../compatibility/dsh/patches.json");
const hex40 = z.string().regex(/^[a-f0-9]{40}$/);
const manifestSchema = z.object({ schemaVersion: z.literal(1), baseCommit: hex40, baseTree: hex40,
  patches: z.array(z.object({ path: z.string().regex(/^patches\/[a-z0-9-]+\.patch$/),
    sha256: z.string().regex(/^[a-f0-9]{64}$/), treeAfter: hex40 }).strict()) }).strict();
export interface DshSourceIdentity {
  baseCommit: string; sourceHead: string; sourceTree: string; mode: "baseline" | "candidate";
  patches: { path: string; sha256: string; treeAfter: string }[]; sourceSha256: string;
}
const sha256 = (value: string | Uint8Array): string => createHash("sha256").update(value).digest("hex");
function git(root: string, args: string[], index?: string): string {
  const result = Bun.spawnSync(["git", "-c", "core.hooksPath=/dev/null", "-c", "core.autocrlf=false", "-C", root, ...args], {
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null",
      ...(index === undefined ? {} : { GIT_INDEX_FILE: index }) }, maxBuffer: 64 * 1024 * 1024,
  });
  if (result.exitCode !== 0) throw new Error("DSH_SOURCE_GIT_FAILED: " + args[0]);
  return result.stdout.toString();
}
const generated = (path: string): boolean => /(^|\/)node_modules\//.test(path)
  || /^(packages\/[^/]+\/[^/]+|apps\/[^/]+|vendor\/[^/]+|native\/system\/packages\/entry)\/lib\//.test(path)
  || /^apps\/web\/dist\//.test(path) || /^native\/system\/packages\/[^/]+\/bin\//.test(path)
  || /^\.dsh-build\//.test(path) || /^tsconfig\.(client|host)\.tsbuildinfo$/.test(path);

async function declaredTree(root: string, index: string) {
  const manifest = manifestSchema.parse(JSON.parse(await readFile(manifestPath, "utf8")));
  const lock = z.object({ dsh: z.object({ commit: hex40 }) })
    .parse(JSON.parse(await readFile(resolve(import.meta.dir, "../upstreams.lock.json"), "utf8")));
  if (manifest.baseCommit !== lock.dsh.commit
    || git(root, ["rev-parse", `${manifest.baseCommit}^{tree}`]).trim() !== manifest.baseTree) {
    throw new Error("DSH_SOURCE_BASE_MISMATCH");
  }
  git(root, ["read-tree", manifest.baseCommit], index);
  for (const patch of manifest.patches) {
    const path = resolve(dirname(manifestPath), patch.path);
    if (sha256(await readFile(path)) !== patch.sha256) throw new Error("DSH_DECLARED_PATCH_HASH_MISMATCH");
    git(root, ["apply", "--cached", "--whitespace=error", path], index);
    if (git(root, ["write-tree"], index).trim() !== patch.treeAfter) throw new Error("DSH_DECLARED_PATCH_TREE_MISMATCH");
  }
  return { manifest, tree: git(root, ["write-tree"], index).trim() };
}

/** Checks the effective tracked and untracked authored tree without changing the caller's index or checkout. */
export async function verifyDshSource(root: string, required?: "baseline" | "candidate"): Promise<DshSourceIdentity> {
  root = resolve(root);
  if ((await lstat(root)).isSymbolicLink()) throw new Error("DSH_SOURCE_OWNED_CHECKOUT_REQUIRED");
  const scratch = await mkdtemp(resolve(tmpdir(), "dsh-source-"));
  try {
    const expected = await declaredTree(root, resolve(scratch, "declared-index"));
    const sourceHead = git(root, ["rev-parse", "HEAD"]).trim();
    // No arbitrary ignored startup/config/authored file may hide outside the tree comparison.
    const ignored = git(root, ["ls-files", "--others", "--ignored", "--exclude-standard", "-z"])
      .split("\0").filter(Boolean);
    if (ignored.some(path => !generated(path))) throw new Error("DSH_UNRECORDED_IGNORED_SOURCE");
    const index = resolve(scratch, "actual-index");
    git(root, ["read-tree", sourceHead], index);
    git(root, ["add", "-A", "--", "."], index);
    const sourceTree = git(root, ["write-tree"], index).trim();
    const mode = sourceTree === expected.manifest.baseTree ? "baseline"
      : sourceTree === expected.tree ? "candidate" : undefined;
    if (mode === undefined || (required !== undefined && mode !== required)) throw new Error("DSH_AUTHORED_SOURCE_MISMATCH");
    // A clean content match cannot silently float away from the fixed ancestry.
    git(root, ["merge-base", "--is-ancestor", expected.manifest.baseCommit, sourceHead]);
    const patches = mode === "candidate" ? expected.manifest.patches : [];
    return { baseCommit: expected.manifest.baseCommit, sourceHead, sourceTree, mode, patches,
      sourceSha256: sha256(JSON.stringify({ base: expected.manifest.baseCommit, sourceTree, patches })) };
  } finally { await rm(scratch, { recursive: true, force: true }); }
}

/** Apply only the complete declared set to a verified baseline; never repair or reset an unknown source tree. */
export async function prepareDshSource(root: string): Promise<DshSourceIdentity> {
  const prior = await verifyDshSource(root);
  if (prior.mode === "baseline") {
    for (const patch of manifestSchema.parse(JSON.parse(await readFile(manifestPath, "utf8"))).patches) {
      git(resolve(root), ["apply", "--whitespace=error", resolve(dirname(manifestPath), patch.path)]);
    }
  }
  return verifyDshSource(root, "candidate");
}

if (import.meta.main) {
  const root = resolve(process.argv[2] ?? "vendor/dsh");
  const identity = process.argv.includes("--apply") ? await prepareDshSource(root) : await verifyDshSource(root);
  console.info(JSON.stringify(identity));
}
