import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, openSync, statfsSync } from "node:fs";
import { join } from "node:path";
import { isMainThread } from "node:worker_threads";
import type { InspectedSelection } from "../delivery/coordinator.ts";
import { ReleaseObservation, canonical, readRange } from "../delivery/observation.ts";
import { claimSelection, matchesSelectionClaim } from "./selection-claim.ts";

type ClockErrorCode = "HOST_MONOTONIC_UNSUPPORTED" | "HOST_MONOTONIC_UNAPPROVED" | "HOST_MONOTONIC_SELECTION_CHANGED"
  | "HOST_MONOTONIC_UNAVAILABLE" | "HOST_MONOTONIC_ABI" | "HOST_MONOTONIC_BUSY" | "HOST_MONOTONIC_LOAD_FAILED"
  | "HOST_MONOTONIC_CLOSED" | "HOST_MONOTONIC_DISPOSAL_UNCERTAIN";

export class HostMonotonicError extends Error {
  constructor(readonly code: ClockErrorCode) {
    super(code); this.name = "HostMonotonicError";
  }
}

/** Independent approval of the exact fixed artifacts. The observer never enrolls an inventory or computes approval. */
export interface HostMonotonicApproval {
  readonly abi: 1;
  readonly binaryDigest: string;
  readonly sourceDigest: string;
}
interface HostMonotonicInput {
  /** Borrowed from a caller retaining maintenance through observation and any uncertain disposal. */
  selection: InspectedSelection;
  approval: HostMonotonicApproval;
}
/** A Host-local reader that borrows the exact selection through awaited disposal. */
export interface RetainedHostMonotonic {
  read(): bigint;
  close(): Promise<void>;
}
interface ClockNative {
  abi(): number;
  milliseconds(): bigint;
  close(): void;
}
type TimeNamespaceName = "time" | "time_for_children";
interface ClockSystem {
  isSupportedRuntime(): boolean;
  namespace(name: TimeNamespaceName): string;
  openNative(path: string): Promise<ClockNative>;
}
type Pin = Awaited<ReturnType<ReleaseObservation["pin"]>>;
interface Lifetime {
  selection: InspectedSelection;
  pins: Pin[];
  native?: ClockNative;
}

const binary = "lib/libomp-shutdown-clock.so";
const source = "provenance/shutdown-clock.c";
const maximumBinaryBytes = 16_777_216;
const maximumSourceBytes = 1_048_576;
const clockFailure = 0xffff_ffff_ffff_ffffn;
const digestPattern = /^[a-f0-9]{64}$/;

function isSupportedRuntime(): boolean {
  return isMainThread && process.platform === "linux" && ["x64", "arm64"].includes(process.arch)
    && process.versions.bun === "1.4.4" && ["LD_PRELOAD", "LD_LIBRARY_PATH", "LD_AUDIT"]
      .every(name => !Object.hasOwn(process.env, name));
}

function approvedMembers(selection: InspectedSelection, approval: HostMonotonicApproval) {
  const { identity, manifest, root } = selection.selected.release;
  try { canonical(root); }
  catch { throw new HostMonotonicError("HOST_MONOTONIC_UNAPPROVED"); }
  const members = [
    { path: join(root, binary), name: binary, digest: approval.binaryDigest, maximum: maximumBinaryBytes },
    { path: join(root, source), name: source, digest: approval.sourceDigest, maximum: maximumSourceBytes },
  ] as const;
  if (root === "/" || approval.abi !== 1 || !digestPattern.test(identity) || manifest.format !== "omp-webui-release-inventory-v1"
    || manifest.stage !== "unaccepted-artifact" || manifest.platform !== process.platform || manifest.arch !== process.arch
    || members.some(member => !digestPattern.test(member.digest) || !manifest.assets.some(asset =>
      asset.path === member.name && asset.kind === "file" && asset.identity === member.digest))
    || !manifest.platformDependencies.some(asset =>
      asset.kind === "file" && /\/libc(?:-[^/]+)?\.so(?:\.\d+)*$/.test(asset.path))) {
    throw new HostMonotonicError("HOST_MONOTONIC_UNAPPROVED");
  }
  return members;
}

async function verifySelection(selection: InspectedSelection): Promise<void> {
  try { await selection.verify(); }
  catch { throw new HostMonotonicError("HOST_MONOTONIC_SELECTION_CHANGED"); }
}

type ApprovedMember = ReturnType<typeof approvedMembers>[number];

async function verifyPin(pin: Pin, member: ApprovedMember): Promise<void> {
  try {
    await pin.verify();
    const bytes = await readRange(pin.file, pin.size, 0, pin.size, member.maximum);
    if (bytes.length && createHash("sha256").update(bytes).digest("hex") === member.digest) {
      await pin.verify();
      return;
    }
  } catch { /* Bound path, descriptor and filesystem failures to the approval refusal. */ }
  throw new HostMonotonicError("HOST_MONOTONIC_UNAPPROVED");
}

async function pinApproved(observation: ReleaseObservation, pins: Pin[], member: ApprovedMember): Promise<Pin> {
  const pin = await observation.pin(member.path, member.maximum)
    .catch(() => { throw new HostMonotonicError("HOST_MONOTONIC_UNAPPROVED"); });
  pins.push(pin);
  await verifyPin(pin, member);
  return pin;
}

function hostNamespace(system: ClockSystem): string {
  try {
    const own = system.namespace("time");
    if (own && own === system.namespace("time_for_children")) return own;
  } catch { throw new HostMonotonicError("HOST_MONOTONIC_UNAVAILABLE"); }
  throw new HostMonotonicError("HOST_MONOTONIC_UNAVAILABLE");
}

function verifyAbi(native: ClockNative, system: ClockSystem, namespace: string): void {
  if (hostNamespace(system) !== namespace) throw new HostMonotonicError("HOST_MONOTONIC_UNAVAILABLE");
  if (native.abi() !== 1) throw new HostMonotonicError("HOST_MONOTONIC_ABI");
}

function readSample(native: ClockNative, system: ClockSystem, namespace: string): bigint {
  verifyAbi(native, system, namespace);
  const sample = native.milliseconds();
  if (typeof sample !== "bigint" || sample < 0n || sample >= clockFailure || hostNamespace(system) !== namespace) {
    throw new HostMonotonicError("HOST_MONOTONIC_UNAVAILABLE");
  }
  return sample;
}

async function dispose(lifetime: Lifetime): Promise<void> {
  try { lifetime.native?.close(); }
  catch { throw new HostMonotonicError("HOST_MONOTONIC_DISPOSAL_UNCERTAIN"); }
  const closures = await Promise.allSettled(lifetime.pins.map(pin => pin.file.close()));
  if (closures.some(result => result.status === "rejected")) throw new HostMonotonicError("HOST_MONOTONIC_DISPOSAL_UNCERTAIN");
}

function loadFailure(error: unknown): HostMonotonicError {
  return error instanceof HostMonotonicError ? error : new HostMonotonicError("HOST_MONOTONIC_LOAD_FAILED");
}

/** Controlled OS seam. Injected implementations convey no production authorization. */
export function createHostMonotonicSources(system: ClockSystem) {
  // An uncertain unload parks this reservation, with the native object, pins and borrowed selection intact.
  let reserved: Lifetime | undefined;
  function use(input: HostMonotonicInput, mode: "observe"): Promise<bigint>;
  function use(input: HostMonotonicInput, mode: "retain", ownerToken?: symbol): Promise<RetainedHostMonotonic>;
  async function use({ selection, approval }: HostMonotonicInput, mode: "observe" | "retain", ownerToken?: symbol) {
    if (reserved) throw new HostMonotonicError("HOST_MONOTONIC_BUSY");
    const claim = ownerToken === undefined ? claimSelection(selection) : undefined;
    const token = ownerToken ?? claim?.token;
    if (token === undefined || !matchesSelectionClaim(selection, token)) {
      throw new HostMonotonicError("HOST_MONOTONIC_BUSY");
    }
    const lifetime: Lifetime = { selection, pins: [] };
    reserved = lifetime;
    let closing: Promise<void> | undefined;
    const close = (): Promise<void> => {
      if (closing) return closing;
      const closed = Promise.withResolvers<void>();
      closing = closed.promise;
      closed.resolve(dispose(lifetime).then(() => {
        reserved = undefined;
        claim?.release();
      }));
      return closing;
    };
    let retained = false;
    try {
      if (!system.isSupportedRuntime()) throw new HostMonotonicError("HOST_MONOTONIC_UNSUPPORTED");
      const [binaryMember, sourceMember] = approvedMembers(selection, approval);
      const namespace = hostNamespace(system);
      const observation = new ReleaseObservation();
      await verifySelection(lifetime.selection);
      const binaryPin = await pinApproved(observation, lifetime.pins, binaryMember);
      const sourcePin = await pinApproved(observation, lifetime.pins, sourceMember);
      await verifySelection(lifetime.selection);
      if (hostNamespace(system) !== namespace) throw new HostMonotonicError("HOST_MONOTONIC_UNAVAILABLE");
      const native = lifetime.native = await system.openNative(`/proc/self/fd/${binaryPin.file.fd}`);
      await verifyPin(binaryPin, binaryMember);
      await verifyPin(sourcePin, sourceMember);
      await verifySelection(lifetime.selection);
      const read = (): bigint => {
        if (closing) throw new HostMonotonicError("HOST_MONOTONIC_CLOSED");
        try { return readSample(native, system, namespace); }
        catch (error) { throw loadFailure(error); }
      };
      if (mode === "observe") {
        const sample = read();
        await verifySelection(selection);
        return sample;
      }
      verifyAbi(native, system, namespace);
      await verifySelection(selection);
      retained = true;
      return { read, close };
    } catch (error) { throw loadFailure(error); }
    finally { if (!retained) await close(); }
  }
  return {
    observe: (input: HostMonotonicInput) => use(input, "observe"),
    retain: (input: HostMonotonicInput, ownerToken?: symbol) => use(input, "retain", ownerToken),
  };
}

export function createHostMonotonicObserver(system: ClockSystem): (input: HostMonotonicInput) => Promise<bigint> {
  return createHostMonotonicSources(system).observe;
}

function namespaceIdentity(name: TimeNamespaceName): string {
  const fd = openSync(`/proc/self/ns/${name}`, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd, { bigint: true });
    const nsfsMagic = 0x6e736673n;
    if (!stat.isFile() || statfsSync(`/proc/self/fd/${fd}`, { bigint: true }).type !== nsfsMagic) {
      throw new HostMonotonicError("HOST_MONOTONIC_UNAVAILABLE");
    }
    return `${stat.dev}:${stat.ino}`;
  } finally { closeSync(fd); }
}

async function openNative(path: string): Promise<ClockNative> {
  const { dlopen, FFIType } = await import("bun:ffi");
  const library = dlopen(path, {
    omp_shutdown_clock_abi: { args: [], returns: FFIType.u32 },
    omp_shutdown_clock_milliseconds: { args: [], returns: FFIType.u64 },
  });
  return {
    abi: library.symbols.omp_shutdown_clock_abi,
    milliseconds: library.symbols.omp_shutdown_clock_milliseconds,
    close: () => library.close(),
  };
}

const production = createHostMonotonicSources({ isSupportedRuntime, namespace: namespaceIdentity, openNative });

/** One Host-local sample only. This operation confers no cross-process time or shutdown authority. */
export const observeHostMonotonic = production.observe;

/** @internal The owner holds maintenance protection even if loading or closing leaves disposal uncertain. */
export async function retainHostMonotonic(input: HostMonotonicInput, ownerToken: symbol): Promise<RetainedHostMonotonic> {
  if (typeof ownerToken !== "symbol") throw new HostMonotonicError("HOST_MONOTONIC_BUSY");
  return production.retain(input, ownerToken);
}
