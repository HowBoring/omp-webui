/** Explicit synthetic acceptance executable. The default Host never imports this component. */
import { resolve, join } from "node:path";
import { startWorkspaceComponentServer } from "./workspace-component-server.ts";
import { CatalogTransport } from "../../../packages/compatibility/catalog-transport.ts";
import { inspectDiagnostics } from "../../../packages/compatibility/diagnostics.ts";
import { inspectInstallation } from "../../../packages/compatibility/installation.ts";
import { openBrowserAccess } from "../../../packages/access/index.ts";
const dataDir = resolve("vendor/workspace-access"), port = 3182;
if (process.argv.includes("--print-bootstrap")) {
  const access = openBrowserAccess({ dataDir, origin: `http://127.0.0.1:${port}` });
  console.log(access.bootstrapLink()); access.close(); process.exit(0);
}
const selection = { manifest: resolve("vendor/omp-candidate/installation.json"), launcher: resolve("vendor/omp-candidate/omp") };
const diagnostic = await inspectDiagnostics(selection);
if (diagnostic.status !== "verified-blocked") throw new Error(diagnostic.code);
const verified = await inspectInstallation(selection);
const home = resolve("vendor/workspace-fixture");
const child = await CatalogTransport.open({ argv: [verified.runtime, "--no-env-file", verified.target, "--rpc-catalog"], cwd: home,
  env: { HOME: home, TMPDIR: home, BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0",
    OMP_CATALOG_SOURCES: JSON.stringify([join(home, "custom"), join(home, "missing-source")]) } });
const { syntheticIndex } = await import("../../../packages/workspaces/fixture-index.ts");
const index = await syntheticIndex(join(home, "index-metadata.json"));
const host = await startWorkspaceComponentServer({ ...selection, catalog: child.catalog, dataDir, port, index });
console.info(`Synthetic Workspace component listening at ${host.server.url.origin}`);
for (const signal of ["SIGTERM", "SIGINT"] as const) process.once(signal, () => {
  void host.stop().then(() => child.close()).then(() => process.exit(0));
});
