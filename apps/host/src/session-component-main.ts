/** Explicit synthetic S1 executable. The normal Host never imports this component. */
import { resolve, join } from "node:path";
import { z } from "zod";
import { openBrowserAccess } from "../../../packages/access/index.ts";
import { CatalogTransport } from "../../../packages/compatibility/catalog-transport.ts";
import { SessionWorker } from "../../../packages/compatibility/session-worker.ts";
import { startSessionComponentServer } from "./session-component-server.ts";
const home = resolve("vendor/sessions-fixture"), dataDir = resolve("vendor/sessions-access");
const port = 3187;
if (process.argv.includes("--print-bootstrap")) {
  const authority = openBrowserAccess({ dataDir, origin: `http://127.0.0.1:${port}` });
  console.info(authority.bootstrapLink()); authority.close(); process.exit(0);
}
if (process.argv.includes("--revoke-all")) {
  throw new Error("Use the running fixture's trusted local operator control; offline credential removal cannot stop its worker.");
}
z.strictObject({ kind: z.literal("S1-synthetic-session-fixture"), privateData: z.literal(false) })
  .parse(await Bun.file(join(home, "fixture-marker.json")).json());
const env = { HOME: home, PATH: "/usr/bin:/bin", TMPDIR: home, PI_CODING_AGENT_DIR: join(home, ".omp/agent"),
  XDG_CONFIG_HOME: join(home, "config"), XDG_CACHE_HOME: join(home, "cache"), XDG_DATA_HOME: join(home, "data"),
  BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0", OPENAI_API_KEY: "synthetic-unused-no-provider-calls", NO_COLOR: "1", PI_NOTIFICATIONS: "off" };
const prefix = [process.execPath, "--no-env-file", "--preload", resolve("compatibility/omp/fixtures/no-provider.ts"), resolve("vendor/omp-candidate/cli.js")];
const catalog = await CatalogTransport.open({ argv: [...prefix, "--rpc-catalog"], env, cwd: home, readyTimeoutMs: 10_000 });
const host = await startSessionComponentServer({ manifest: resolve("vendor/omp-candidate/session-installation.json"),
  launcher: resolve("vendor/omp-candidate/omp"), port, dataDir, catalog: catalog.catalog,
  launch: cwd => SessionWorker.open({ argv: [...prefix, "--mode", "rpc-ui", "--strict-start", "--offline", "--provider", "openai", "--model", "gpt-4o",
    "--no-skills", "--no-rules", "--no-tools", "--no-context-files", "--extension", resolve("tests/continuation/startup-extension.ts")],
    env, cwd, readyTimeoutMs: 20_000 }) });
console.info(JSON.stringify({ stage: "S1-isolated-sessions", sessionAdmission: "blocked", origin: host.server.url.origin }));
process.on("SIGUSR1", () => { void host.revokeAll().catch(() => {}); });
let closing = false;
for (const signal of ["SIGTERM", "SIGINT"] as const) process.once(signal, () => {
  if (closing) return; closing = true; void host.stop().then(() => catalog.close()).then(() => process.exit(0));
});
