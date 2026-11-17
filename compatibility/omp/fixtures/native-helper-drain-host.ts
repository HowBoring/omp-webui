import * as fs from "node:fs/promises";
import { z } from "zod";
import type { HelperDrainConfiguration } from "./native-helper-drain-launch";
import { HelperDrainHostGate } from "./native-helper-drain-gate";
import { boundedHelperOutput, drainFact, parentCommand } from "./native-helper-drain-io";
import type { PrivateHelperHandle } from "../../../../omp-webui-ticket-41-controlio-public-adapter/packages/supervision/adapter.ts";

/** Actual Host public adapter and Native public client. No mechanical dispatcher or fabricated ACK/status. */
export async function runHelperDrainFixture(config: HelperDrainConfiguration): Promise<void> {
  const { loadOwnershipTerminalApproval } = await import("../../../vendor/omp-ownership/packages/coding-agent/src/launch/ownership/approval");
  const { captureLauncherMaintenanceHandoff } = await import("../../../vendor/omp-ownership/packages/coding-agent/src/launch/ownership/maintenance-handoff");
  const { connectApprovedOwnershipClient } = await import("../../../vendor/omp-ownership/packages/coding-agent/src/launch/ownership/uds-client");
  // The public module delegates selection.verify; use this tree's reviewed bounded-alias production inspector.
  const { inspectCoordinatedSelection } = await import("../../../packages/delivery/coordinator.ts");
  const { createPrivateHelperOwner } = await import("../../../../omp-webui-ticket-41-controlio-public-adapter/packages/supervision/adapter.ts");
  const handoff = captureLauncherMaintenanceHandoff(process.argv.slice(2));
  if (handoff.arguments.join(",") !== "--fixture-host") throw new Error("DRAIN_HOST_ARGUMENTS");
  const approval = await loadOwnershipTerminalApproval(config.anchor);
  if (!approval.helperFence) throw new Error("DRAIN_V4_REQUIRED");
  const guard = handoff.claim(approval);
  const original = await inspectCoordinatedSelection({ root: approval.releaseRoot,
    entry: `${approval.releaseRoot}/bin/omp`, expectedIdentity: approval.controlIo.inventory.sha256,
    control: approval.control });
  let released = false;
  const selection = { ...original, release: async () => { await original.release(); released = true; } };
  for (const list of [selection.selected.release.manifest.assets, selection.selected.release.manifest.platformDependencies]) {
    for (const member of list) Object.freeze(member);
    Object.freeze(list);
  }
  Object.freeze(selection.selected.release.manifest); Object.freeze(selection.selected.release);
  Object.freeze(selection.selected); Object.freeze(selection);
  const owner = await createPrivateHelperOwner({ selection, controlIoApproval: { abi: 1,
    binaryDigest: approval.controlIo.sha256, sourceDigest: approval.controlIo.source.sha256,
    headerDigest: approval.controlIo.header.sha256 } });
  const client = connectApprovedOwnershipClient(approval);
  let handle: PrivateHelperHandle | undefined;
  const gate = new HelperDrainHostGate({ generation: config.generation, client,
    originalHelperPid: () => handle?.helperPid,
    registered: hello => drainFact("HOST_REGISTERED_HELD", { pid: process.pid, ...hello, startReleased: false }),
    continueStart: () => parentCommand(`START ${config.generation}`) });
  const provenance = async (name: string): Promise<string> => new Bun.CryptoHasher("sha256")
    .update(await fs.readFile(`${approval.releaseRoot}/provenance/${name}`)).digest("hex");
  handle = await owner.launch({ generation: config.generation, approval: { binaryDigest: approval.helper.sha256,
    sourceDigest: await provenance("private-helper.c"), controlSourceDigest: await provenance("control.h"),
    candidateSourceDigest: await provenance("candidates.h") }, cwd: `${config.stage}/cwd`,
    arguments: ["--mode", "rpc-ui", "identity"], environment: {},
    prepareHelper: generation => gate.prepareHelper(generation), registerHeldHelper: hello => gate.registerHeldHelper(hello) });
  const stdout = boundedHelperOutput(handle.stdout), stderr = boundedHelperOutput(handle.stderr);
  const hello = await handle.ready;
  const output = z.strictObject({ kind: z.literal("root"), pid: z.number().int().positive(), parent: z.number().int().positive() })
    .parse(JSON.parse(await stdout));
  if (output.pid !== hello.nativePid || output.parent !== handle.helperPid || await stderr !== "") throw new Error("DRAIN_WORKER_IDENTITY");
  await handle.completed;
  if (await handle.helperExited !== 0 || !handle.control.helperReportedComplete || released) throw new Error("DRAIN_HOST_INCOMPLETE");
  drainFact("HOST_CLEAN_REAP_EOF", { pid: process.pid, generation: config.generation,
    helperPid: handle.helperPid, helperExit: 0, decodedControlTailClean: true });
  await owner.close();
  client.close(); guard.assertCurrent();
  if (!released) throw new Error("DRAIN_HOST_LEASE_RETAINED");
  drainFact("HOST_CLOSED", { pid: process.pid, generation: config.generation,
    moduleCloseAwaitedBeforeLeaseRelease: true, nativeTerminalAuthorityInferred: false });
}
