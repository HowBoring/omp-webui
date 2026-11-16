import { resolve } from "node:path";
import { SessionWorker } from "../../packages/compatibility/session-worker.ts";
import { CatalogTransport } from "../../packages/compatibility/catalog-transport.ts";
import { isolatedRuntimeArgs } from "../continuation/worker.ts";
export function selection(home: string, cwd: string, startup = false) {
  const args = startup ? isolatedRuntimeArgs.filter(arg => arg !== "--no-extensions")
    .concat(["--extension", resolve("tests/continuation/startup-extension.ts")]) : isolatedRuntimeArgs;
  return { argv: [process.execPath, "--no-env-file", "--preload", resolve("compatibility/omp/fixtures/no-provider.ts"),
    resolve("vendor/omp-candidate/cli.js"), "--mode", "rpc-ui", "--strict-start", ...args], cwd,
    env: { HOME: home, PATH: "/usr/bin:/bin", BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0", TMPDIR: home,
      PI_CODING_AGENT_DIR: resolve(home, ".omp/agent"), XDG_CONFIG_HOME: resolve(home, "config"),
      XDG_CACHE_HOME: resolve(home, "cache"), XDG_DATA_HOME: resolve(home, "data"),
      OPENAI_API_KEY: "synthetic-unused-no-provider-calls", NO_COLOR: "1", PI_NOTIFICATIONS: "off" }, readyTimeoutMs: 20_000 };
}
export function launch(home: string, cwd: string, startup = false) { return SessionWorker.open(selection(home, cwd, startup)); }
export function catalog(home: string) {
  return CatalogTransport.open({ argv: [process.execPath, "--no-env-file", "--preload",
    resolve("compatibility/omp/fixtures/no-provider.ts"), resolve("vendor/omp-candidate/cli.js"), "--rpc-catalog"],
    env: { HOME: home, PATH: "/usr/bin:/bin", BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0" }, readyTimeoutMs: 10_000 });
}
