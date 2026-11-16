/** Genuine isolated Bun/DSH/native browser proof with deterministic worker/profile cleanup. */
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startHistoryFixture } from "../apps/history-fixture/server.ts";

async function startBuiltFixture() {
  const host = Bun.spawn([process.execPath, "--no-env-file", "vendor/host-history/main.js"], {
    env: { PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin" }, stdout: "pipe", stderr: "inherit",
  });
  const profile = await mkdtemp(join(tmpdir(), "omp-history-browser-built-"));
  const deadline = setTimeout(() => host.kill("SIGTERM"), 15_000);
  const reader = host.stdout.getReader();
  let ready = "";
  try {
    while (!ready.includes("\n")) {
      const chunk = await reader.read();
      if (chunk.done) throw new Error("HISTORY_BUILT_HOST_NOT_READY");
      ready += new TextDecoder().decode(chunk.value);
      if (ready.length > 4096) throw new Error("HISTORY_BUILT_HOST_STARTUP_LIMIT");
    }
    if (!ready.includes('"sessionAdmission":"blocked"')) throw new Error("HISTORY_BUILT_HOST_NOT_READY");
  } catch (error) {
    host.kill("SIGTERM"); await host.exited; await rm(profile, { recursive: true, force: true }); throw error;
  } finally { clearTimeout(deadline); reader.releaseLock(); }
  return { profile, async stop() {
    host.kill("SIGTERM");
    const exitCode = await host.exited;
    await rm(profile, { recursive: true, force: true });
    if (exitCode !== 0) throw new Error("HISTORY_BUILT_HOST_EXIT_FAILED");
  } };
}
const fixture = process.argv.includes("--built") ? await startBuiltFixture() : await startHistoryFixture({ port: 3184 });
try {
  const browser = Bun.spawn(["python3", "-B", "tests/browser/history-browser.py"], {
    env: { PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin", HOME: fixture.profile },
    stdout: "inherit", stderr: "inherit",
  });
  if (await browser.exited !== 0) throw new Error("HISTORY_BROWSER_PROOF_FAILED");
} finally { await fixture.stop(); }
