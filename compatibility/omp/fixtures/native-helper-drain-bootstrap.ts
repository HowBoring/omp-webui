import { authenticateHelperDrainLaunch, type HelperDrainConfiguration } from "./native-helper-drain-launch";
import { helperDrainFailure } from "./native-helper-drain-diagnostics";

declare const HELPER_DRAIN_CONFIGURATION: HelperDrainConfiguration;
const config = HELPER_DRAIN_CONFIGURATION;
await authenticateHelperDrainLaunch(config);
const role = process.argv.at(-1);
if (role !== "--fixture-native" && role !== "--fixture-host") throw new Error("DRAIN_ROLE_REQUIRED");
// Outer launch authentication precedes every Native/Host-bearing import, including Host's maintenance FFI graph.
let phase: unknown = "bootstrap_import";
try {
  const entry: unknown = await import(`${config.stage}/launch/components/${role === "--fixture-native" ? "native" : "host"}/fixture.js`);
  phase = "bootstrap_entry";
  if (typeof entry !== "object" || entry === null || !("runHelperDrainFixture" in entry)
    || typeof entry.runHelperDrainFixture !== "function") throw new Error("DRAIN_ENTRY_CHANGED");
  phase = role === "--fixture-native" ? "native_imports" : "host_run";
  await entry.runHelperDrainFixture(config, (next: unknown) => { phase = next; });
} catch (error) {
  process.stdout.write(JSON.stringify({ event: "FIXTURE_RETAINED_FAILURE", ...helperDrainFailure(error, phase),
    pid: process.pid, generation: config.generation, scope: "TWO_PROCESS_HELPER_FIXTURE_ONLY" }) + "\n");
  process.exitCode = 1;
  // Keep original process/module/selection/handle ownership for the original retaining parent. No cleanup fallback.
  setInterval(() => {}, 1000);
}
