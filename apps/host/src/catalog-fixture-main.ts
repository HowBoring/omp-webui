/** Explicit isolated acceptance executable; the product/default Host never imports it. */
import { resolve,join } from "node:path";
import { startCatalogFixtureServer } from "./catalog-fixture-server.ts";
import { CatalogTransport } from "../../../packages/compatibility/catalog-transport.ts";
import { inspectDiagnostics } from "../../../packages/compatibility/diagnostics.ts";
import { inspectInstallation } from "../../../packages/compatibility/installation.ts";
const selection = {manifest:resolve(process.env.OMP_CATALOG_FIXTURE_MANIFEST ?? "vendor/omp-candidate/installation.json"),launcher:resolve("vendor/omp-candidate/omp")};
const diagnostic = await inspectDiagnostics(selection);
if (diagnostic.status !== "verified-blocked") throw new Error(diagnostic.code);
const verified = await inspectInstallation(selection);
const home = resolve(process.env.OMP_CATALOG_FIXTURE_HOME ?? "vendor/catalog-fixture");
const port = Number(process.env.OMP_CATALOG_FIXTURE_PORT ?? 3181);
const sources = process.env.OMP_CATALOG_SOURCES
  ? JSON.parse(process.env.OMP_CATALOG_SOURCES) as string[]
  : [join(home,"custom"),join(home,".omp/agent/sessions/bucket-0000"),join(home,"missing-source")];
const client = await CatalogTransport.open({argv:[verified.runtime,"--no-env-file",verified.target,"--rpc-catalog"],cwd:home,
  env:{HOME:home,TMPDIR:home,BUN_RUNTIME_TRANSPILER_CACHE_PATH:"0",
    OMP_CATALOG_SOURCES:JSON.stringify(sources)}});
const host = await startCatalogFixtureServer({...selection,catalog:client.catalog,port});
console.info(`Isolated synthetic catalog fixture: ${host.server.url}`);
for (const signal of ["SIGTERM","SIGINT"] as const) process.once(signal,()=>{
  void host.stop().then(()=>client.close()).then(()=>process.exit(0));
});
