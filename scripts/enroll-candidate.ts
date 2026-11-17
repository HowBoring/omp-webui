import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { runtimeMappings } from "../packages/compatibility/runtime-mappings.ts";
import { writeInstallationManifest } from "../packages/compatibility/manifest.ts";
import { compatibilityBuild } from "../packages/contracts/generated/identity.ts";
const sourceTrees = (await readdir("vendor/omp")).filter(name => name !== ".git").map(name => `vendor/omp/${name}`);
const manifest = await writeInstallationManifest({
  root: process.cwd(), path: resolve("vendor/omp-candidate/installation.json"),
  launcher: "vendor/omp-candidate/omp", target: "vendor/omp-candidate/cli.js", runtime: process.execPath,
  trees: ["vendor/omp-candidate", "vendor/dsh-diagnostics", "vendor/host-diagnostics",
    ...(process.argv.includes("--workspace-component") ? ["vendor/dsh-workspaces", "vendor/host-workspaces", "packages/access", "packages/workspaces"] : []),
    ...(process.argv.includes("--catalog-fixture") ? ["vendor/dsh-catalog","vendor/host-catalog"]:[]),
    ...(process.argv.includes("--continuation-fixture") ? ["vendor/dsh-continuation", "vendor/host-continuation", "packages/continuation", "tests/continuation/native-faults.ts", "compatibility/omp/fixtures/no-provider.ts"] : []),
    "apps/host/src", "packages/contracts", "packages/compatibility", "upstreams.lock.json",
    "package.json", "bun.lock", "tsconfig.json", "vendor/omp-runtime/package.json", "vendor/omp-runtime/bun.lock", ...sourceTrees],
  patch: compatibilityBuild.patchSha256, schema: compatibilityBuild.schemaSha256,
  runtimeDependencies: (await runtimeMappings(process.pid)).filter(path => path !== process.execPath),
});
console.info(JSON.stringify({ format: manifest.format, assets: manifest.assets.length }));
