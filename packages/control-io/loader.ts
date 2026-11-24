import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath, type FileHandle } from "node:fs/promises";
import { join } from "node:path";
import { isMainThread } from "node:worker_threads";
import type { ControlIoSelection } from "./selection.ts";
import { ControlIoError } from "./errors.ts";
import { createOwnedControlIo, type ControlScheduler, type ControlIoSystem, type IoResult, type OwnedControlIo } from "./socket.ts";

/** Supplied independently by the operator; never computed/enrolled by this loader or inferred from release.json. */
export interface OwnedControlApproval {
  readonly abi: 1;
  readonly binaryDigest: string;
  readonly sourceDigest: string;
  readonly headerDigest: string;
}
export interface OwnedControlLoad {
  /** Retain this independent lease until close succeeds, including failed loads with uncertain native disposal. */
  selection: ControlIoSelection;
  approval: OwnedControlApproval;
}
/** Controlled file boundary; production pins ordinary O_NOFOLLOW descriptors and verifies exact bytes. */
export interface PinnedControlMember { file: Pick<FileHandle, "fd" | "close">; verify(): Promise<void> }
/** External loading boundary for controlled tests; production must use the approved singleton loader below. */
export interface ControlIoLoadingSystem {
  pin(path: string, digest: string): Promise<PinnedControlMember>;
  openNative(path: string): Promise<ControlIoNativeLibrary>;
}
async function pin(path: string, digest: string): Promise<PinnedControlMember> {
  if (!/^[a-f0-9]{64}$/.test(digest) || await realpath(path) !== path) {
    throw new ControlIoError("CONTROL_IO_UNAPPROVED");
  }
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  const verify = async () => {
    const before = await file.stat({ bigint: true });
    if (!before.isFile() || before.nlink !== 1n || before.size <= 0n || before.size > 16_777_216n) {
      throw new ControlIoError("CONTROL_IO_UNAPPROVED");
    }
    const bytes = Buffer.alloc(Number(before.size));
    let offset = 0;
    while (offset < bytes.byteLength) {
      const result = await file.read(bytes, offset, bytes.byteLength - offset, offset);
      if (!result.bytesRead) throw new ControlIoError("CONTROL_IO_UNAPPROVED");
      offset += result.bytesRead;
    }
    const [after, pathname] = await Promise.all([file.stat({ bigint: true }), lstat(path, { bigint: true })]);
    for (const stat of [after, pathname]) {
      if (!stat.isFile() || stat.nlink !== 1n || stat.dev !== before.dev || stat.ino !== before.ino
        || stat.size !== before.size || stat.mtimeNs !== before.mtimeNs || stat.ctimeNs !== before.ctimeNs) {
        throw new ControlIoError("CONTROL_IO_UNAPPROVED");
      }
    }
    if (await realpath(path) !== path || createHash("sha256").update(bytes).digest("hex") !== digest) {
      throw new ControlIoError("CONTROL_IO_UNAPPROVED");
    }
  };
  try { await verify(); return { file, verify }; }
  catch (error) { await file.close(); throw error; }
}
function scheduler(): ControlScheduler {
  let next = 0;
  const timers = new Map<number, Timer>();
  return {
    schedule(callback) {
      const token = ++next;
      timers.set(token, setTimeout(() => { timers.delete(token); callback(); }, 5));
      return token;
    },
    cancel(token) { clearTimeout(timers.get(token)); timers.delete(token); },
  };
}
async function verifySelection(input: OwnedControlLoad): Promise<void> {
  try { await input.selection.verify(); }
  catch { throw new ControlIoError("CONTROL_IO_SELECTION_CHANGED"); }
}
function validate(input: OwnedControlLoad): void {
  // Must precede even importing bun:ffi; workers never acquire a native library or lease here.
  if (!isMainThread || process.platform !== "linux" || !["x64", "arm64"].includes(process.arch)
    || Bun.version !== "1.4.4") throw new ControlIoError("CONTROL_IO_UNSUPPORTED");
  if (input.approval.abi !== 1 || [input.approval.binaryDigest, input.approval.sourceDigest,
    input.approval.headerDigest].some(digest => !/^[a-f0-9]{64}$/.test(digest))) {
    throw new ControlIoError("CONTROL_IO_UNAPPROVED");
  }
  for (const variable of ["LD_PRELOAD", "LD_LIBRARY_PATH", "LD_AUDIT"]) {
    if (Object.hasOwn(process.env, variable)) throw new ControlIoError("CONTROL_IO_UNSUPPORTED");
  }
}
function verifyManifest(input: OwnedControlLoad): void {
  const release = input.selection.selected.release;
  const manifest = release.manifest;
  if (!/^[a-f0-9]{64}$/.test(release.identity) || manifest.format !== "omp-webui-release-inventory-v1"
    || manifest.stage !== "unaccepted-artifact" || manifest.platform !== process.platform || manifest.arch !== process.arch) {
    throw new ControlIoError("CONTROL_IO_UNAPPROVED");
  }
  for (const [path, digest] of [
    ["lib/libomp-control-io.so", input.approval.binaryDigest],
    ["provenance/owned-control-io.c", input.approval.sourceDigest],
    ["provenance/owned-control-io.h", input.approval.headerDigest],
  ]) {
    if (!manifest.assets.some(asset => asset.path === path && asset.kind === "file" && asset.identity === digest)) {
      throw new ControlIoError("CONTROL_IO_UNAPPROVED");
    }
  }
  // The selected exhaustive closure must at least name libc. Actual loaded mappings remain a separate OS gate.
  if (!manifest.platformDependencies.some(asset => asset.kind === "file" && /\/libc(?:-[^/]+)?\.so(?:\.\d+)*$/.test(asset.path))) {
    throw new ControlIoError("CONTROL_IO_UNAPPROVED");
  }
}
function ioResult(result: number, errno: number, operation: "read" | "write"): IoResult {
  if (result > 0) return { kind: "bytes", count: result };
  if (result === 0 && operation === "read") return { kind: "eof" };
  if (result === -1) return { kind: "blocked" };
  if (result === -2) return { kind: "interrupted" };
  if (result === -3) throw new ControlIoError("CONTROL_IO_HANDLE");
  throw new ControlIoError(operation === "read" ? "CONTROL_IO_READ_FAILED" : "CONTROL_IO_WRITE_FAILED", errno);
}
async function openNative(path: string): Promise<ControlIoNativeLibrary> {
  const { dlopen, FFIType, ptr } = await import("bun:ffi");
  const library = dlopen(path, {
    omp_control_io_abi: { args: [], returns: FFIType.u32 },
    omp_control_io_live: { args: [], returns: FFIType.u32 },
    omp_control_io_adopt: { args: [FFIType.i32, FFIType.ptr], returns: FFIType.u32 },
    omp_control_io_receive: { args: [FFIType.u32, FFIType.ptr, FFIType.u32, FFIType.ptr], returns: FFIType.i32 },
    omp_control_io_send: { args: [FFIType.u32, FFIType.ptr, FFIType.u32, FFIType.ptr], returns: FFIType.i32 },
    omp_control_io_close: { args: [FFIType.u32, FFIType.ptr], returns: FFIType.i32 },
  });
  // Public ptr(view) borrows the actual view, including its byteOffset. Keep every view strongly rooted until return.
  const borrowed = new Set<ArrayBufferView>();
  const call = (views: readonly ArrayBufferView[], operation: () => number): number => {
    for (const view of views) borrowed.add(view);
    try { return operation(); }
    finally { for (const view of views) borrowed.delete(view); }
  };
  return {
    symbols: {
      omp_control_io_abi: () => library.symbols.omp_control_io_abi(),
      omp_control_io_live: () => library.symbols.omp_control_io_live(),
      omp_control_io_adopt: (fd, result) => call([result],
        () => library.symbols.omp_control_io_adopt(fd, ptr(result))),
      omp_control_io_receive: (handle, bytes, size, diagnostic) => call([bytes, diagnostic],
        () => library.symbols.omp_control_io_receive(handle, ptr(bytes), size, ptr(diagnostic))),
      omp_control_io_send: (handle, bytes, size, diagnostic) => call([bytes, diagnostic],
        () => library.symbols.omp_control_io_send(handle, ptr(bytes), size, ptr(diagnostic))),
      omp_control_io_close: (handle, diagnostic) => call([diagnostic],
        () => library.symbols.omp_control_io_close(handle, ptr(diagnostic))),
    },
    close() {
      if (borrowed.size) throw new ControlIoError("CONTROL_IO_BUSY");
      library.close();
    },
  };
}

/** Synchronous native-library boundary. Production supplies only the approved public bun:ffi symbols. */
export interface ControlIoNativeLibrary {
  symbols: {
    omp_control_io_abi(): number;
    omp_control_io_live(): number;
    omp_control_io_adopt(fd: number, result: Int32Array): number;
    omp_control_io_receive(handle: number, bytes: Uint8Array, size: number, diagnostic: Uint32Array): number;
    omp_control_io_send(handle: number, bytes: Uint8Array, size: number, diagnostic: Uint32Array): number;
    omp_control_io_close(handle: number, diagnostic: Uint32Array): number;
  };
  close(): void;
}
function nativeDisposer(
  library: ControlIoNativeLibrary, members: PinnedControlMember[], release: () => void,
): () => Promise<void> {
  let disposed = false;
  let disposalFailure: ControlIoError | undefined;
  return async () => {
    if (disposalFailure) throw disposalFailure;
    if (disposed) return;
    if (library.symbols.omp_control_io_live() !== 0) throw new ControlIoError("CONTROL_IO_BUSY");
    disposed = true;
    try { library.close(); }
    catch { disposalFailure = new ControlIoError("CONTROL_IO_LOAD_FAILED"); throw disposalFailure; }
    const results = await Promise.allSettled(members.map(member => member.file.close()));
    if (results.some(result => result.status === "rejected")) {
      disposalFailure ??= new ControlIoError("CONTROL_IO_LOAD_FAILED");
    }
    if (disposalFailure) throw disposalFailure;
    release();
  };
}
function nativeSystem(
  library: ControlIoNativeLibrary, members: PinnedControlMember[], release: () => void,
): ControlIoSystem {
  const diagnostic = new Uint32Array(1);
  const adoptResult = new Int32Array(2);
  return {
    adopt(fd) {
      const handle = library.symbols.omp_control_io_adopt(fd, adoptResult);
      if (!handle) throw new ControlIoError(adoptResult[0] === -6 ? "CONTROL_IO_LIMIT" : "CONTROL_IO_ADOPT_FAILED",
        adoptResult[1]);
      return handle;
    },
    receive(handle, bytes) {
      const result = library.symbols.omp_control_io_receive(handle, bytes, bytes.byteLength, diagnostic);
      return ioResult(result, diagnostic[0] ?? 0, "read");
    },
    send(handle, bytes) {
      const result = library.symbols.omp_control_io_send(handle, bytes, bytes.byteLength, diagnostic);
      return ioResult(result, diagnostic[0] ?? 0, "write");
    },
    close(handle) {
      if (library.symbols.omp_control_io_close(handle, diagnostic) !== 0) {
        throw new ControlIoError("CONTROL_IO_CLOSE_UNCERTAIN", diagnostic[0]);
      }
    },
    dispose: nativeDisposer(library, members, release),
  };
}

interface NativeLifetime {
  selection: ControlIoSelection;
  members: PinnedControlMember[];
  native: ControlIoNativeLibrary | undefined;
}
/** Controlled external loading boundary. Custom systems provide no production approval or native provenance. */
export function createOwnedControlIoLoader(
  system: ControlIoLoadingSystem,
): (input: OwnedControlLoad) => Promise<OwnedControlIo> {
  // Retain the objects themselves: FileHandle/lease finalizers must not drop protection after uncertain unload.
  let reserved: NativeLifetime | undefined;
  return async (input) => {
    input = { selection: input.selection, approval: Object.freeze({ ...input.approval }) };
    validate(input);
    if (reserved) throw new ControlIoError("CONTROL_IO_BUSY");
    const members: PinnedControlMember[] = [];
    const lifetime: NativeLifetime = { selection: input.selection, members, native: undefined };
    reserved = lifetime;
    let native: ControlIoNativeLibrary | undefined;
    try {
      await verifySelection(input);
      verifyManifest(input);
      const root = input.selection.selected.release.root;
      const binary = await system.pin(join(root, "lib/libomp-control-io.so"), input.approval.binaryDigest);
      members.push(binary);
      members.push(await system.pin(join(root, "provenance/owned-control-io.c"), input.approval.sourceDigest));
      members.push(await system.pin(join(root, "provenance/owned-control-io.h"), input.approval.headerDigest));
      await verifySelection(input);
      // Linux descriptor pathname binds the loaded inode to the approved bytes, including across rename races.
      native = await system.openNative(`/proc/self/fd/${binary.file.fd}`);
      lifetime.native = native;
      if (native.symbols.omp_control_io_abi() !== input.approval.abi) throw new ControlIoError("CONTROL_IO_ABI");
      for (const member of members) await member.verify();
      await verifySelection(input);
      const library = native;
      return createOwnedControlIo(nativeSystem(library, members, () => { reserved = undefined; }), scheduler());
    } catch (error) {
      try { native?.close(); reserved = undefined; }
      catch { throw new ControlIoError("CONTROL_IO_DISPOSAL_UNCERTAIN"); }
      for (const member of members) await member.file.close().catch(() => undefined);
      throw error instanceof ControlIoError ? error : new ControlIoError("CONTROL_IO_LOAD_FAILED");
    }
  };
}

/** Explicit source-unproven operator seam. Never called by import, product admission, a worker or a self-enroller. */
export const loadOwnedControlIo = createOwnedControlIoLoader({ pin, openNative });
