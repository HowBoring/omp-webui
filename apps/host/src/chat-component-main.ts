/** Explicit synthetic S2 executable. The normal Host never imports this Chat component. */
import { join, resolve } from "node:path";
import { z } from "zod";
import { openBrowserAccess } from "../../../packages/access/index.ts";
import { CatalogTransport } from "../../../packages/compatibility/catalog-transport.ts";
import { SessionWorker } from "../../../packages/compatibility/session-worker.ts";
import { startSessionComponentServer } from "./session-component-server.ts";

const attachments = process.env.OMP_CHAT_ATTACHMENTS === "1";
const performance = process.env.OMP_CHAT_PERFORMANCE === "1";
const home = resolve(process.env.OMP_CHAT_FIXTURE_HOME ?? (attachments ? "vendor/chat-attachment-fixture" : "vendor/chat-fixture")),
  dataDir = resolve(process.env.OMP_CHAT_FIXTURE_DATA ?? "vendor/chat-access"),
  port = Number(process.env.OMP_CHAT_PORT ?? process.env.OMP_CHAT_FIXTURE_PORT ?? 3188);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("OMP_CHAT_PORT must be a TCP port");
if (process.argv.includes("--print-bootstrap")) {
  const authority = openBrowserAccess({ dataDir, origin: `http://127.0.0.1:${port}` });
  console.info(authority.bootstrapLink()); authority.close(); process.exit(0);
}
const marker = z.strictObject({
  kind: z.enum(["S2-synthetic-chat-fixture", "S5-native-performance-corpus"]),
  privateData: z.literal(false),
}).parse(await Bun.file(join(home, "fixture-marker.json")).json());
if (performance !== (marker.kind === "S5-native-performance-corpus")) throw new Error("OMP_CHAT_MARKER_MODE_MISMATCH");
const scenario = process.env.OMP_CHAT_FIXTURE_SCENARIO, delay = process.env.OMP_CHAT_FIXTURE_DELAY_MS;
const tools = process.env.OMP_CHAT_FIXTURE_TOOLS;
const fixtureEnv = { ...(scenario === undefined ? {} : { OMP_LIVE_FIXTURE_SCENARIO: scenario }),
  ...(delay === undefined ? {} : { OMP_LIVE_FIXTURE_DELAY_MS: delay }),
  ...(tools === undefined ? {} : { OMP_LIVE_FIXTURE_TOOLS: tools }) };
const env = { HOME: home, PATH: "/usr/bin:/bin", TMPDIR: home,
  PI_CODING_AGENT_DIR: attachments ? join(home, ".omp/agent") : home,
  ...(attachments || performance ? {} : { OMP_HISTORY_FIXTURE_PROFILE: home }),
  XDG_CONFIG_HOME: join(home, "config"), XDG_CACHE_HOME: join(home, "cache"),
  XDG_DATA_HOME: join(home, "data"), BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0", OPENAI_API_KEY: "synthetic-unused-no-provider-calls",
  NO_COLOR: "1", PI_NOTIFICATIONS: "off", ...fixtureEnv };
const candidate = resolve(process.env.OMP_CHAT_CANDIDATE ?? "vendor/omp-candidate/cli.js");
const launcher = resolve(process.env.OMP_CHAT_LAUNCHER ?? "vendor/omp-candidate/omp");
const prefix = [process.execPath, "--no-env-file", "--preload",
  resolve(attachments || performance ? "compatibility/omp/fixtures/no-provider.ts" : "compatibility/omp/fixtures/history-network-guard.js"), candidate];
const catalog = await CatalogTransport.open({ argv: [...prefix, "--rpc-catalog"], env, cwd: home, readyTimeoutMs: 10_000 });
const host = await startSessionComponentServer({ manifest: resolve("vendor/chat/installation.json"),
  assets: resolve("vendor/dsh-chat"),
  launcher, port, dataDir, catalog: catalog.catalog, chat: true,
  launch: cwd => SessionWorker.open({ argv: [...prefix, "--mode", "rpc-ui", "--strict-start", "--offline",
    "--model", attachments ? "attachment-controlled/literal" : "s0-controlled/deterministic-live",
    "--no-lsp", "--no-skills", "--no-rules", "--no-spotlight", "--no-judge",
    ...(attachments ? ["--trusted-extension", resolve("compatibility/omp/fixtures/attachment-provider.ts")]
      : ["--trusted-extension", resolve("compatibility/omp/fixtures/live-provider.ts")])], env, cwd, readyTimeoutMs: 20_000 }) });
console.info(JSON.stringify({ stage: performance ? "S5-performance-chat" : "S2-isolated-chat", chatAdmission: "component-only", productAdmission: "blocked",
  origin: host.server.url.origin }));
process.on("SIGUSR1", () => { void host.revokeAll().catch(() => {}); });
async function stop(): Promise<void> {
  const hostStopped = await host.stop().then(() => true, () => false);
  const catalogClosed = await catalog.close().then(() => true, () => false);
  const failed = !hostStopped || !catalogClosed;
  if (!failed && !host.supervisor.hasOwnedReservation) process.exit(0);
  console.error(JSON.stringify({ stage: performance ? "S5-performance-chat" : "S2-isolated-chat",
    shutdown: failed ? "failed" : "worker-ownership-unresolved", hostStopped, catalogClosed }));
  process.exitCode = 1;
}
let closing = false;
for (const signal of ["SIGTERM", "SIGINT"] as const) process.once(signal, () => {
  if (closing) return;
  closing = true;
  void stop();
});
