/** Product Host entry. It serves the UI only for the independently enrolled installation. */
import { homedir } from "node:os";
import { resolve, join } from "node:path";
import { openBrowserAccess } from "../../../packages/access/index.ts";
import { configuredOrigin } from "../../../packages/access/trust.ts";
import { CatalogTransport } from "../../../packages/compatibility/catalog-transport.ts";
import { SessionWorker } from "../../../packages/compatibility/session-worker.ts";
import { admitProduct } from "../../../packages/compatibility/product-admission.ts";
import { startSessionComponentServer } from "./session-component-server.ts";

const manifest = process.env.OMP_WEB_MANIFEST;
const launcher = process.env.OMP_WEB_LAUNCHER;
const expectedIdentity = process.env.OMP_WEB_MANIFEST_SHA256;
if (manifest === undefined || launcher === undefined) {
  throw new Error("Select enrolled OMP_WEB_MANIFEST and OMP_WEB_LAUNCHER in Host startup configuration");
}
if (expectedIdentity === undefined) {
  throw new Error("Select an independently enrolled OMP_WEB_MANIFEST_SHA256 in Host startup configuration");
}
const port = Number(process.env.OMP_WEB_PORT ?? "3180");
if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("Invalid OMP_WEB_PORT");
const origin = configuredOrigin(process.env.OMP_WEB_ORIGIN ?? `http://localhost:${port}`);
const dataDir = resolve(process.env.OMP_WEB_DATA_DIR ?? join(homedir(), ".local/share/omp-webui"));
const assets = resolve(process.env.OMP_WEB_ASSETS ?? "vendor/dsh-product");
const env: Record<string, string> = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));

const admission = await admitProduct({ manifest: resolve(manifest), launcher: resolve(launcher), expectedIdentity });
if (admission.status !== "admitted" || admission.verified === undefined) {
  if (process.argv.includes("--print-bootstrap")) {
    console.error(JSON.stringify({ code: "PRODUCT_BOOTSTRAP_BLOCKED", reason: admission.code,
      missingCapabilities: admission.missingCapabilities }));
    process.exit(1);
  }
  const blocked = Bun.serve({
    hostname: "127.0.0.1", port,
    fetch(request) {
      const path = new URL(request.url).pathname;
      if (path === "/healthz") {
        return Response.json({ service: "omp-webui-host", status: "blocked", stage: "product",
          sessionAdmission: "blocked", code: admission.code, missingCapabilities: admission.missingCapabilities });
      }
      if (path.startsWith("/api/")) {
        return Response.json({ error: { code: "PRODUCT_ADMISSION_BLOCKED", reason: admission.code } }, { status: 503 });
      }
      return new Response("Product admission blocked", { status: 503 });
    },
  });
  console.info(JSON.stringify({ stage: "product", sessionAdmission: "blocked", code: admission.code,
    missingCapabilities: admission.missingCapabilities, origin: origin.origin }));
  const stopBlocked = async () => { await blocked.stop(true); process.exit(0); };
  for (const signal of ["SIGTERM", "SIGINT"] as const) process.once(signal, () => { void stopBlocked(); });
} else {
  const verified = admission.verified;
  if (process.argv.includes("--print-bootstrap")) {
    const authority = openBrowserAccess({ dataDir, origin: origin.origin });
    console.info(authority.bootstrapLink()); authority.close(); process.exit(0);
  }
  const prefix = [verified.runtime, verified.target];
  const catalog = await CatalogTransport.open({ argv: [...prefix, "--rpc-catalog"], env, cwd: process.cwd(),
    readyTimeoutMs: 20_000 });
  const host = await startSessionComponentServer({
    manifest: resolve(manifest), launcher: resolve(launcher), expectedIdentity, assets, port, dataDir,
    origin: origin.origin, catalog: catalog.catalog, chat: true, product: true,
    launch: cwd => SessionWorker.open({ argv: [...prefix, "--mode", "rpc-ui", "--strict-start"], env, cwd,
      readyTimeoutMs: 60_000 }),
  });
  console.info(JSON.stringify({ stage: "product", sessionAdmission: "admitted", origin: host.server.url.origin,
    runtime: admission.identity?.runtime, installation: admission.identity?.installationSha256 }));
  process.on("SIGUSR1", () => { void host.revokeAll().catch(() => {}); });
  async function stop(): Promise<void> {
    const hostStopped = await host.stop().then(() => true, () => false);
    const catalogClosed = await catalog.close().then(() => true, () => false);
    const failed = !hostStopped || !catalogClosed;
    if (!failed && !host.supervisor.hasOwnedReservation) process.exit(0);
    console.error(JSON.stringify({ stage: "product", shutdown: failed ? "failed" : "worker-ownership-unresolved",
      hostStopped, catalogClosed }));
    process.exitCode = 1;
  }
  let closing = false;
  for (const signal of ["SIGTERM", "SIGINT"] as const) process.once(signal, () => {
    if (closing) return;
    closing = true;
    void stop();
  });
}
