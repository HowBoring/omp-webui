/** Install before dynamic imports: this fixture can only compose public Client/Host source. */
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const previous = { cwd: process.cwd(), env: { ...process.env } };
export const top = mkdtempSync(join(tmpdir(), "interaction-broker-"));
for (const part of ["home", "profile", "cwd", "tmp"]) mkdirSync(join(top, part));
for (const key of Object.keys(process.env)) delete process.env[key];
Object.assign(process.env, { HOME: join(top, "home"), XDG_CONFIG_HOME: join(top, "profile"),
  PI_CODING_AGENT_DIR: join(top, "profile"), TMPDIR: join(top, "tmp"), BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0" });
process.chdir(join(top, "cwd"));
const guardPath = new URL("../../compatibility/omp/fixtures/no-provider.ts", import.meta.url).href;
await import(guardPath);
const deny = (): never => { throw new Error("BROKER_FIXTURE_RUNTIME_FORBIDDEN"); };
Bun.plugin({ name: "interaction-broker-no-native-runtime", setup(build) {
  build.onResolve({ filter: /(?:@oh-my-pi|pi-coding-agent|bun:ffi|node:(?:child_process|net|tls|http|https|http2|dgram))/ }, deny);
} });
const original = { fetch: globalThis.fetch, WebSocket: globalThis.WebSocket, spawn: Bun.spawn,
  spawnSync: Bun.spawnSync, serve: Bun.serve, connect: Bun.connect, listen: Bun.listen };
Object.assign(globalThis, { fetch: deny, WebSocket: deny });
Object.assign(Bun, { spawn: deny, spawnSync: deny, serve: deny, connect: deny, listen: deny });
export function restoreFixture() {
  Object.assign(globalThis, { fetch: original.fetch, WebSocket: original.WebSocket });
  Object.assign(Bun, { spawn: original.spawn, spawnSync: original.spawnSync, serve: original.serve,
    connect: original.connect, listen: original.listen });
  process.chdir(previous.cwd);
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, previous.env);
  rmSync(top, { recursive: true, force: true });
}
