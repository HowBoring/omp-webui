import { createHash } from "node:crypto";
import { closeSync } from "node:fs";
import { lstat, readFile, realpath } from "node:fs/promises";
import { loadOwnedControlIo, type OwnedControlApproval } from "../control-io/index.ts";
import { isAbsolute, join, resolve } from "node:path";
import type { InspectedSelection } from "../delivery/coordinator.ts";
import { privateGeneration, type PrivateHello } from "./control.ts";
import type { PrivateHelperHandle } from "./controller.ts";
import { openPrivateHelperOwner } from "./owner.ts";
import { verifyHelperSelection } from "./control-io-selection.ts";
import { PrivateHelperError, helperError } from "./errors.ts";
import { retainHostMonotonic, type HostMonotonicApproval } from "./host-monotonic.ts";

export type { PrivateHelperHandle, PrivateRootExit } from "./controller.ts";

/** Independent operator approval, never derived/enrolled by this adapter from the selected release itself. */
export interface PrivateHelperApproval {
  binaryDigest: string;
  sourceDigest: string;
  controlSourceDigest: string;
  candidateSourceDigest: string;
}
export interface PrivateHelperLaunch {
  approval: PrivateHelperApproval;
  generation: string;
  cwd: string;
  /** Trusted Host construction only. No raw browser argv or executable choice. Begins --mode rpc-ui. */
  arguments: readonly string[];
  environment: Record<string, string>;
  /** Before spawn, bind generation to this Host's authenticated dispatcher peer and independently approved tuple. */
  prepareHelper(generation: string): Promise<void>;
  /** Verify dispatcher helper_status after helper active peer registration; never trust claimed PIDs as authority. */
  registerHeldHelper(hello: Readonly<PrivateHello>): Promise<void>;
}
async function verifyMember(path: string, expected: string): Promise<void> {
  try {
    if (!/^[a-f0-9]{64}$/.test(expected) || await realpath(path) !== path) {
      throw new PrivateHelperError("HELPER_ARTIFACT_UNAPPROVED");
    }
    const stat = await lstat(path);
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > 16 * 1024 * 1024) {
      throw new PrivateHelperError("HELPER_ARTIFACT_UNAPPROVED");
    }
    const digest = createHash("sha256").update(await readFile(path)).digest("hex");
    if (digest !== expected) throw new PrivateHelperError("HELPER_ARTIFACT_UNAPPROVED");
  } catch (error) { throw helperError("HELPER_ARTIFACT_UNAPPROVED", error); }
}

function validateLaunch(input: PrivateHelperLaunch): void {
  privateGeneration(input.generation);
  if (process.platform !== "linux" || !isAbsolute(input.cwd) || resolve(input.cwd) !== input.cwd
    || input.arguments[0] !== "--mode" || input.arguments[1] !== "rpc-ui" || input.arguments.length > 128) {
    throw new PrivateHelperError("HELPER_LAUNCH_UNSUPPORTED");
  }
  let bytes = 0;
  for (const argument of input.arguments) {
    bytes += Buffer.byteLength(argument) + 1;
    if (argument.includes("\0") || bytes > 16_384) throw new PrivateHelperError("HELPER_ARGUMENT_LIMIT");
  }
  let environmentBytes = 0;
  const entries = Object.entries(input.environment);
  if (entries.length > 256) throw new PrivateHelperError("HELPER_ENVIRONMENT_UNSUPPORTED");
  for (const [key, value] of entries) {
    environmentBytes += Buffer.byteLength(key) + Buffer.byteLength(value) + 2;
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || value.includes("\0") || environmentBytes > 65_536) {
      throw new PrivateHelperError("HELPER_ENVIRONMENT_UNSUPPORTED");
    }
  }
  for (const key of ["BUN_OPTIONS", "NODE_OPTIONS", "BUN_INSPECT", "LD_PRELOAD", "LD_LIBRARY_PATH", "LD_AUDIT"]) {
    if (Object.hasOwn(input.environment, key)) throw new PrivateHelperError("HELPER_ENVIRONMENT_UNSUPPORTED");
  }
}

/** One selected lifetime owns a singleton approved module reused across concurrent helper handles. */
export interface PrivateHelperOwnerInput {
  selection: InspectedSelection;
  controlIoApproval: OwnedControlApproval;
  /** Optional independent approval for a Host-local clock from this same selected release. */
  hostMonotonicApproval?: HostMonotonicApproval;
}
export interface PrivateHelperOwner {
  /** A trusted Host retirement signal can cause `HELPER_LAUNCH_RETIRED` before spawn.
   * Post-spawn startup failure returns an owning handle whose ready rejects; retain it through unresolved reap. */
  launch(input: PrivateHelperLaunch, retirement?: AbortSignal): Promise<PrivateHelperHandle>;
  /** Stop launching, await every clean COMPLETE/EOF/reap, then dispose retained native modules before releasing the lease.
   * A rejected close is sticky and retains all protection. Completion alone never unloads the module. */
  close(): Promise<void>;
}
async function verifyLaunch(input: PrivateHelperLaunch, selection: InspectedSelection): Promise<void> {
  validateLaunch(input);
  try {
    if (await realpath(input.cwd) !== input.cwd) throw new PrivateHelperError("HELPER_LAUNCH_UNSUPPORTED");
  } catch (error) { throw helperError("HELPER_LAUNCH_UNSUPPORTED", error); }
  await verifyHelperSelection(selection);
  const root = selection.selected.release.root;
  await verifyMember(join(root, "bin/omp-private-helper"), input.approval.binaryDigest);
  await verifyMember(join(root, "provenance/private-helper.c"), input.approval.sourceDigest);
  await verifyMember(join(root, "provenance/control.h"), input.approval.controlSourceDigest);
  await verifyMember(join(root, "provenance/candidates.h"), input.approval.candidateSourceDigest);
  await verifyHelperSelection(selection);
}
/** Explicit Host construction only, still outside product admission. Loads and validates before prepare or any spawn.
 * No supplied loader/test factory, Socket/fs fallback, automatic enrollment or self-derived approval is accepted. */
export function createPrivateHelperOwner(input: PrivateHelperOwnerInput): Promise<PrivateHelperOwner> {
  return openPrivateHelperOwner(input, { load: loadOwnedControlIo, verifyLaunch, retainHostMonotonic,
    spawn: (launch, selection) => Bun.spawn([
      join(selection.selected.release.root, "bin/omp-private-helper"), launch.generation, "--", ...launch.arguments,
    ], { cwd: launch.cwd, env: launch.environment, stdin: "pipe", stdout: "pipe", stderr: "pipe",
      stdio: ["pipe", "pipe", "pipe", "socket-fd"] }),
    closeControl: fd => closeSync(fd),
  });
}
