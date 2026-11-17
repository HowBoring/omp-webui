import * as fs from "node:fs/promises";
import type { HelperDrainPhase } from "./native-helper-drain-diagnostics";
import type { HelperDrainConfiguration } from "./native-helper-drain-launch";
import { drainFact, parentCommand } from "./native-helper-drain-io";

/** Explicit fixture entry. Ordinary Native entry/broker backend stay unavailable. */
export async function runHelperDrainFixture(config: HelperDrainConfiguration,
  reportPhase: (phase: HelperDrainPhase) => void = () => {}): Promise<void> {
  reportPhase("native_imports");
  const { loadOwnershipControlApproval } = await import("../../../vendor/omp-ownership/packages/coding-agent/src/launch/ownership/approval");
  const { captureLauncherMaintenanceHandoff } = await import("../../../vendor/omp-ownership/packages/coding-agent/src/launch/ownership/maintenance-handoff");
  const { selectOwnershipControlRelease } = await import("../../../vendor/omp-ownership/packages/coding-agent/src/launch/ownership/selected-control-release");
  const { LinuxOwnershipServer } = await import("../../../vendor/omp-ownership/packages/coding-agent/src/launch/ownership/server");
  reportPhase("native_handoff");
  const handoff = captureLauncherMaintenanceHandoff(process.argv.slice(2));
  if (handoff.arguments.join(",") !== "--fixture-native") throw new Error("DRAIN_NATIVE_ARGUMENTS");
  reportPhase("native_approval");
  const approval = await loadOwnershipControlApproval(config.anchor);
  if (!approval.helperFence) throw new Error("DRAIN_V4_REQUIRED");
  reportPhase("native_claim");
  const guard = handoff.claim(approval);
  reportPhase("native_selection");
  const selection = await selectOwnershipControlRelease(approval, guard);
  reportPhase("native_server_open");
  const server = await LinuxOwnershipServer.open(approval, config.replyKey, selection);
  drainFact("NATIVE_READY", { pid: process.pid, generation: config.generation });
  reportPhase("native_wait_close");
  await parentCommand(`CLOSE ${config.generation}`);
  reportPhase("native_close");
  const closed = server.close(); // Stops admission synchronously; do not await before allowing Host START.
  drainFact("NATIVE_DRAINING", { pid: process.pid, generation: config.generation });
  await closed;
  reportPhase("native_disposal");
  guard.assertCurrent();
  let released = false;
  try { selection.assertCurrent(); } catch { released = true; }
  if (!released || (await fs.readdir(approval.fenceDirectory.path)).length
    || (await fs.readdir(approval.helperFence.directory.path)).length) throw new Error("DRAIN_NATIVE_CLOSE_INCOMPLETE");
  drainFact("NATIVE_CLOSED", { pid: process.pid, generation: config.generation,
    awaitedServerClose: true, selectionReleased: true, inheritedCGuardCurrent: true,
    hostReceiptOrReapObserved: false });
}
