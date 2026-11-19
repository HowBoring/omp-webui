import { mkdir, cp, lstat, rm, symlink } from "node:fs/promises";
import { resolve } from "node:path";
import { ompBase, sourceGit, ompPatches, authoredPaths, temporaryPaths } from "./omp-source.ts";

const omp = resolve("vendor/omp");
const runtime = resolve("vendor/omp-runtime");
const run = async (argv: string[]): Promise<void> => {
  const child = Bun.spawn(argv, { stdout: "inherit", stderr: "inherit" });
  if (await child.exited !== 0) throw new Error("Compatibility preparation failed");
};
await mkdir("vendor", { recursive: true });
if (!await Bun.file(resolve(omp, ".git/HEAD")).exists()) {
  await run(["git", "init", omp]);
  sourceGit(omp, "remote", "add", "origin", "https://github.com/can1357/oh-my-pi.git");
  await run(["git", "-C", omp, "fetch", "--depth=1", "origin", ompBase]);
  sourceGit(omp, "checkout", "--detach", ompBase);
}
if (sourceGit(omp, "rev-parse", "HEAD").trim() !== ompBase) throw new Error("Wrong OMP source base");
if (process.argv.includes("--reset")) {
  // Only the owned ignored checkout and known generated/new source files are reset.
  sourceGit(omp, "reset", "--hard", ompBase);
  for (const file of [...authoredPaths,...temporaryPaths].filter(file => file !== "node_modules")) {
    const tracked = sourceGit(omp,"ls-files","--",file).trim();
    if (!tracked) await rm(resolve(omp,file),{force:true});
  }
}
for (const patch of ompPatches) {
  const check = Bun.spawnSync(["git","-C",omp,"apply","--reverse","--check",resolve("compatibility/omp",patch)]);
  if (check.exitCode !== 0) {
    sourceGit(omp,"apply","--check",resolve("compatibility/omp",patch));
    sourceGit(omp,"apply",resolve("compatibility/omp",patch));
  }
}
if (process.argv.includes("--source-only")) {
  console.info("Fixed ordered source patches prepared; existing dependency cache was not modified.");
  process.exit(0);
}
await mkdir(runtime, { recursive: true });
await cp("package.json", resolve(runtime, "package.json"));
await cp("bun.lock", resolve(runtime, "bun.lock"));
await run([process.execPath, "--no-env-file", "install", "--cwd", runtime,
  "--frozen-lockfile", "--ignore-scripts", "--linker", "hoisted"]);
const dependencyLink = resolve(omp, "node_modules");
try {
  if (!(await lstat(dependencyLink)).isSymbolicLink()) throw new Error("Refusing to replace OMP dependencies directory");
  await rm(dependencyLink);
} catch (error) {
  if (error instanceof Error && error.message.startsWith("Refusing")) throw error;
}
await symlink("../omp-runtime/node_modules", dependencyLink);
// The patched workspace utils package is the single source of the new bounded-stream helpers.
const publishedUtils = resolve(runtime, "node_modules/@oh-my-pi/pi-utils");
await rm(publishedUtils, { recursive: true, force: true });
await symlink(resolve(omp, "packages/utils"), publishedUtils);
console.info("Fixed OMP source patch and isolated frozen dependency installation prepared.");
