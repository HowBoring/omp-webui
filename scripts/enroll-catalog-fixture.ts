/** Build-time enrollment for the isolated catalog fixture used by performance evidence. */
import { resolve } from "node:path";
import { writeInstallationManifest } from "../packages/compatibility/manifest.ts";
import { runtimeMappings } from "../packages/compatibility/runtime-mappings.ts";
import { compatibilityBuild } from "../packages/contracts/generated/identity.ts";

const manifest = await writeInstallationManifest({
  root: process.cwd(), path: resolve("vendor/catalog/installation.json"),
  launcher: "vendor/omp-candidate/omp", target: "vendor/omp-candidate/cli.js", runtime: process.execPath,
  trees: ["vendor/dsh-catalog", "vendor/host-catalog", "apps/host/src/catalog-fixture-main.ts",
    "apps/host/src/catalog-fixture-server.ts", "packages/contracts", "packages/compatibility"],
  patch: compatibilityBuild.patchSha256, schema: compatibilityBuild.schemaSha256,
  runtimeDependencies: (await runtimeMappings(process.pid)).filter(path => path !== process.execPath),
});
console.info(JSON.stringify({ stage: "S5-catalog-fixture-assets", assets: manifest.assets.length, productAdmission: "blocked" }));
