import * as fs from "node:fs/promises";
import * as path from "node:path";

/** Finite harmless Bun target. The real C entry supplies the only maintenance lease before this module imports. */
const home = process.env.HOME;
if (!Bun.isMainThread || !home?.startsWith("/tmp/launcher-lock-tracer-") || !home.endsWith("/home")
  || JSON.stringify(process.argv.slice(2)) !== JSON.stringify(["--launcher-lock-fixture"])) {
  throw new Error("LAUNCHER_LOCK_SYNTHETIC_TARGET_REQUIRED");
}
const marker: unknown = JSON.parse(await fs.readFile(path.join(home, "fixture-marker.json"), "utf8"));
if (typeof marker !== "object" || marker === null || !("kind" in marker)
  || marker.kind !== "launcher-lock-synthetic-home/1" || !("privateData" in marker) || marker.privateData !== false) {
  throw new Error("LAUNCHER_LOCK_MARKER_REQUIRED");
}
const guard: unknown = Reflect.get(globalThis, Symbol.for("omp.s0.network-guard"));
if (typeof guard !== "object" || guard === null || !("denied" in guard) || typeof guard.denied !== "function"
  || !("dispatched" in guard) || typeof guard.dispatched !== "function") throw new Error("LAUNCHER_LOCK_GUARD_REQUIRED");
const timer: Timer = setTimeout(() => {
  process.stderr.write("LAUNCHER_LOCK_CHILD_DEADLINE\n"); process.exit(24);
}, 20_000);
try {
  process.stdout.write(JSON.stringify({ stage: "BUN_READY", pid: process.pid, executable: process.execPath,
    bunVersion: Bun.version, args: process.argv.slice(2), guardPresent: true }) + "\n");
  const input = await Bun.stdin.text();
  if (input !== "") throw new Error("LAUNCHER_LOCK_EXPECTED_STDIN_EOF_ONLY");
  const denied: unknown = guard.denied(), dispatched: unknown = guard.dispatched();
  if (!Number.isSafeInteger(denied) || !Number.isSafeInteger(dispatched)) throw new Error("LAUNCHER_LOCK_GUARD_COUNTER_INVALID");
  process.stdout.write(JSON.stringify({ stage: "BUN_EOF", pid: process.pid, guardDenied: denied,
    guardDispatched: dispatched }) + "\n");
} finally { clearTimeout(timer); }
