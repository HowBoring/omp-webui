import { authenticateProbeLaunch, type ProbeConfiguration } from "./native-signed-probe-launch";

declare const NATIVE_SIGNED_PROBE_CONFIGURATION: ProbeConfiguration;
const config = NATIVE_SIGNED_PROBE_CONFIGURATION;
if (!Object.hasOwn(globalThis, Symbol.for("omp.s0.network-guard"))) throw new Error("PROBE_PREIMPORT_GUARD_MISSING");
await authenticateProbeLaunch(config);
// The entire outer launch closure was authenticated before this first Native-bearing module import.
const module: unknown = await import(`${config.stage}/launch/components/native/probe.js`);
if (typeof module !== "object" || module === null || !("runNativeSignedProbe" in module)
  || typeof module.runNativeSignedProbe !== "function") throw new Error("PROBE_ENTRY_CHANGED");
await module.runNativeSignedProbe(config);
