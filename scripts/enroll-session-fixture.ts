/** Build-time enrollment for this explicit synthetic component's assets, separate from the normal product gate. */
import { resolve } from "node:path";
import { writeInstallationManifest } from "../packages/compatibility/manifest.ts";
import { compatibilityBuild } from "../packages/contracts/generated/identity.ts";
const manifest = await writeInstallationManifest({ root: process.cwd(), path: resolve("vendor/omp-candidate/session-installation.json"),
  launcher: "vendor/omp-candidate/omp", target: "vendor/omp-candidate/cli.js", runtime: process.execPath,
  trees: ["vendor/dsh-sessions", "vendor/host-sessions", "apps/sessions", "apps/host/src/session-component-server.ts",
    "packages/sessions", "packages/contracts", "packages/access", "packages/workspaces", "packages/compatibility",
    "compatibility/omp/fixtures/no-provider.ts", "tests/continuation/startup-extension.ts"],
  patch: compatibilityBuild.patchSha256, schema: compatibilityBuild.schemaSha256 });
console.info(JSON.stringify({ stage: "S1-isolated-synthetic-assets", assets: manifest.assets.length, normalProductAdmission: "blocked" }));
