/** Build-time enrollment for this explicit synthetic Chat component's assets, separate from the product gate. */
import { resolve } from "node:path";
import { writeInstallationManifest } from "../packages/compatibility/manifest.ts";
import { compatibilityBuild } from "../packages/contracts/generated/identity.ts";
const manifest = await writeInstallationManifest({ root: process.cwd(), path: resolve("vendor/chat/installation.json"),
  launcher: "vendor/omp-candidate/omp", target: "vendor/omp-candidate/cli.js", runtime: process.execPath,
  trees: ["vendor/dsh-chat", "vendor/host-chat", "apps/chat", "apps/host/src/chat-component-main.ts",
    "apps/host/src/chat-component-runtime.ts", "apps/host/src/chat-view-admission.ts",
    "apps/host/src/chat-request-body.ts", "apps/host/src/session-remote-dispatch.ts",
    "apps/host/src/session-component-server.ts", "packages/chat", "packages/drafts", "packages/contracts",
    "packages/access", "packages/workspaces", "packages/sessions", "packages/projection", "packages/compatibility",
    "compatibility/omp/fixtures/history-network-guard.js", "compatibility/omp/fixtures/live-provider.ts"],
  patch: compatibilityBuild.patchSha256, schema: compatibilityBuild.schemaSha256 });
console.info(JSON.stringify({ stage: "S2-isolated-chat-assets", assets: manifest.assets.length, normalProductAdmission: "blocked" }));
