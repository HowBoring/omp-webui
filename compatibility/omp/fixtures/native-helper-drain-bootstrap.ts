import { authenticateHelperDrainLaunch, type HelperDrainConfiguration } from "./native-helper-drain-launch";

declare const HELPER_DRAIN_CONFIGURATION: HelperDrainConfiguration;
const config = HELPER_DRAIN_CONFIGURATION;
await authenticateHelperDrainLaunch(config);
const role = process.argv.at(-1);
if (role !== "--fixture-native" && role !== "--fixture-host") throw new Error("DRAIN_ROLE_REQUIRED");
// Outer launch authentication precedes every Native/Host-bearing import, including Host's maintenance FFI graph.
const entry: unknown = await import(`${config.stage}/launch/components/${role === "--fixture-native" ? "native" : "host"}/fixture.js`);
if (typeof entry !== "object" || entry === null || !("runHelperDrainFixture" in entry)
  || typeof entry.runHelperDrainFixture !== "function") throw new Error("DRAIN_ENTRY_CHANGED");
try { await entry.runHelperDrainFixture(config); }
catch (error) {
  const code = error instanceof Error && /^[A-Z_]{1,64}$/.test(error.message) ? error.message : "DRAIN_UNRESOLVED";
  process.stdout.write(JSON.stringify({ event: "FIXTURE_RETAINED_FAILURE", code, pid: process.pid,
    generation: config.generation,
    scope: "TWO_PROCESS_HELPER_FIXTURE_ONLY" }) + "\n");
  process.exitCode = 1;
  // Keep original process/module/selection/handle ownership for the original retaining parent. No cleanup fallback.
  setInterval(() => {}, 1000);
}
