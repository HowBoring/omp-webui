import * as fs from "node:fs/promises";
import type { ProbeConfiguration } from "./native-signed-probe-launch";
import { checkEmptyOwnershipDispatcher } from "./native-signed-probe-checks";

/** Explicit fixture only. Ordinary Native dispatcher entry remains unavailable. Never prepares or launches a helper. */
export async function runNativeSignedProbe(config: ProbeConfiguration): Promise<void> {
  if (!Object.hasOwn(globalThis, Symbol.for("omp.s0.network-guard"))) throw new Error("PROBE_PREIMPORT_GUARD_MISSING");
  const { loadOwnershipControlApproval } = await import("../../../vendor/omp-ownership/packages/coding-agent/src/launch/ownership/approval");
  const { captureLauncherMaintenanceHandoff } = await import("../../../vendor/omp-ownership/packages/coding-agent/src/launch/ownership/maintenance-handoff");
  const { selectOwnershipControlRelease } = await import("../../../vendor/omp-ownership/packages/coding-agent/src/launch/ownership/selected-control-release");
  const { LinuxOwnershipServer } = await import("../../../vendor/omp-ownership/packages/coding-agent/src/launch/ownership/server");
  const { connectApprovedOwnershipClient } = await import("../../../vendor/omp-ownership/packages/coding-agent/src/launch/ownership/uds-client");
  const handoff = captureLauncherMaintenanceHandoff(process.argv.slice(2));
  if (handoff.arguments.length) throw new Error("PROBE_UNEXPECTED_ARGUMENTS");
  const approval = await loadOwnershipControlApproval(config.anchor), guard = handoff.claim(approval);
  const selection = await selectOwnershipControlRelease(approval, guard);
  const server = await LinuxOwnershipServer.open(approval, config.key, selection);
  try {
    await checkEmptyOwnershipDispatcher(() => connectApprovedOwnershipClient(approval));
    if ((await fs.readdir(approval.fenceDirectory.path)).length) throw new Error("PROBE_CREATED_FENCE");
    process.stdout.write(JSON.stringify({ stage: "PROBE_READY", pid: process.pid,
      emptyScopesBeforeAndAfter: true, signedMissingInspection: true, prepareInvoked: false }) + "\n");
    // Only the original retaining controller closes this stdin. No timeout/signal is disposal authority.
    for await (const bytes of Bun.stdin.stream()) if (bytes.length) throw new Error("PROBE_UNEXPECTED_STDIN");
  } finally { await server.close(); }
  guard.assertCurrent(); // Generation disposal must not unlock/close the process-owned C descriptor.
  let released = false;
  try { selection.assertCurrent(); } catch { released = true; }
  if (!released) throw new Error("PROBE_SELECTION_NOT_RELEASED");
  if ((await fs.readdir(approval.fenceDirectory.path)).length) throw new Error("PROBE_RETAINED_FENCE");
  process.stdout.write(JSON.stringify({ stage: "PROBE_CLOSED", pid: process.pid, awaitedServerClose: true,
    selectionRejectsAfterClose: true, inheritedCGuardStillCurrent: true, prepareInvoked: false }) + "\n");
}
