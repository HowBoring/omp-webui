import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { digest } from "../packages/compatibility/installation.ts";

export const ompBase = "7c49c11aa5bbaf3f418406583096168ad5b8c6dc";
export const authoredPaths = ["src/cli.ts", "src/cli-runtime.ts", "src/modes/rpc/preflight.ts",
  "src/modes/rpc/wire/commands.ts", "src/modes/rpc/wire/frames.ts", "CHANGELOG.md"]
  .map(path => `packages/coding-agent/${path}`);
const generatedPaths = ["packages/coding-agent/src/modes/rpc/wire/rpc-wire.generated.ts",
  "packages/coding-agent/src/modes/rpc/wire/rpc-wire.schema.json", "sdk/go/omp-rpc/wire.go",
  "sdk/python/omp-rpc/src/omp_rpc/_wire.py", "sdk/rust/omp-rpc/src/wire.rs"];
const temporaryPaths = ["node_modules", "packages/coding-agent/src/modes/rpc/preflight.generated.ts",
  "packages/coding-agent/src/modes/rpc/preflight-validator.generated.js"];

export function sourceGit(omp: string, ...argv: string[]): string {
  const result = Bun.spawnSync(["git", "-C", omp, ...argv], { env: { PATH: process.env.PATH ?? "/usr/bin:/bin" } });
  if (result.exitCode !== 0) throw new Error("OMP_SOURCE_GIT_FAILED");
  return result.stdout.toString();
}

/** Refuse undeclared consumed source before importing or executing any upstream generator. */
export async function verifySource(omp: string): Promise<{ patchText: string; sourceSha256: string }> {
  if (sourceGit(omp, "rev-parse", "HEAD").trim() !== ompBase) throw new Error("OMP_SOURCE_BASE_MISMATCH");
  const expected = await readFile(resolve("compatibility/omp/0001-safe-preflight.patch"), "utf8");
  const allowed = new Set([...authoredPaths, ...generatedPaths]);
  for (const file of sourceGit(omp, "diff", "HEAD", "--name-only").trim().split("\n").filter(Boolean)) {
    if (!allowed.has(file)) throw new Error("OMP_UNRECORDED_SOURCE_CHANGE");
  }
  for (const file of sourceGit(omp, "ls-files", "--others").trim().split("\n").filter(Boolean)) {
    if (!temporaryPaths.includes(file) && !authoredPaths.includes(file)) throw new Error("OMP_UNRECORDED_SOURCE_FILE");
  }
  // Intent-to-add exposes authored new files to the ordinary diff without staging their contents.
  sourceGit(omp, "add", "-N", ...authoredPaths);
  const actual = sourceGit(omp, "diff", "HEAD", "--", ...authoredPaths);
  if (actual !== expected) throw new Error("OMP_AUTHORED_PATCH_MISMATCH");
  return { patchText: expected, sourceSha256: digest(ompBase + "\n" + expected) };
}
