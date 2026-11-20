/** Explicit isolated acceptance executable. Product/default Host never imports this file. */
import { resolve, join } from "node:path";
import { startContinuationFixtureServer } from "./continuation-fixture-server.ts";
import { ContinuationFixture } from "../../../packages/continuation/fixture.ts";
import { CatalogTransport } from "../../../packages/compatibility/catalog-transport.ts";
import { StrictTransport } from "../../../packages/compatibility/strict-transport.ts";
import { inspectDiagnostics } from "../../../packages/compatibility/diagnostics.ts";
import { inspectInstallation } from "../../../packages/compatibility/installation.ts";
const selection = { manifest: resolve("vendor/omp-candidate/installation.json"), launcher: resolve("vendor/omp-candidate/omp") };
const diagnostic = await inspectDiagnostics(selection);
if (diagnostic.status !== "verified-blocked") throw new Error(diagnostic.code);
const verified = await inspectInstallation(selection);
const home = resolve("vendor/continuation-profile"), cwd = join(home, "project");
const guard = resolve("compatibility/omp/fixtures/no-provider.ts");
const env = { HOME: home, TMPDIR: home, PATH: "/usr/bin:/bin", BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0",
  PI_CODING_AGENT_DIR: join(home, ".omp/agent"), XDG_CONFIG_HOME: join(home, "config"),
  XDG_CACHE_HOME: join(home, "cache"), XDG_DATA_HOME: join(home, "data"),
  PI_NOTIFICATIONS: "off", NO_COLOR: "1", OPENAI_API_KEY: "synthetic-unused-no-provider-calls" };
const catalog = await CatalogTransport.open({ argv: [verified.runtime, "--no-env-file", "--preload", guard,
  verified.target, "--rpc-catalog"], cwd: home, env });
const fixture = new ContinuationFixture({ catalog: catalog.catalog, cwd, indexFile: join(home, "host-index/registrations.json"),
  async launch(selected) {
    // This one fixed scenario drops a result at the public stdio boundary. Browser input never chooses argv or paths.
    const lost = selected?.nativeSessionId === "native-0003";
    return StrictTransport.open({ argv: [verified.runtime, "--no-env-file", "--preload", guard,
      ...(lost ? ["--preload", resolve("tests/continuation/native-faults.ts")] : []), verified.target,
      "--mode", "rpc-ui", "--strict-start", "--offline", "--provider", "openai", "--model", "gpt-4o",
      "--no-extensions", "--no-skills", "--no-rules", "--no-tools", "--no-context-files"], cwd,
      env: { ...env, ...(lost ? { OMP_STRICT_FIXTURE_HOME: home, OMP_STRICT_FAULT: "drop-start-result",
        OMP_STRICT_FAULT_TARGET: join(home, "wire-only-fault") } : {}) }, timeoutMs: 10_000, readyTimeoutMs: 3000 }, lost ? { startTimeoutMs: 150 } : {});
  },
});
await fixture.restore();
const host = await startContinuationFixtureServer({ ...selection, fixture, port: 3185 });
console.info(`Isolated strict continuation fixture: ${host.server.url}`);
for (const signal of ["SIGTERM", "SIGINT"] as const) process.once(signal, () => {
  void host.stop().then(() => catalog.close()).then(() => process.exit(0));
});
