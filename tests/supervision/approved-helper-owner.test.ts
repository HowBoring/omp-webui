import { expect, test } from "bun:test";
import type { FileSink } from "bun";
import { createPrivateHelperOwner } from "../../packages/supervision/adapter.ts";
import { createPrivateHelperOwnerForTesting } from "../../packages/supervision/testing.ts";
import { createOwnedControlIoLoader, type ControlIoNativeLibrary } from "../../packages/control-io/testing.ts";
import type { InspectedSelection } from "../../packages/delivery/coordinator.ts";
import type { PrivateHelperProcess } from "../../packages/supervision/controller.ts";

const generation = "a".repeat(64);
function controlledChild(index: number) {
  const exited = Promise.withResolvers<number>();
  const stdin: FileSink = { write: () => 1, end: () => 0, flush: () => 0,
    start: () => {}, ref: () => {}, unref: () => {} };
  const process: PrivateHelperProcess = { pid: 41 + index, stdin,
    stdout: new ReadableStream(), stderr: new ReadableStream(), exited: exited.promise,
    stdio: [null, null, null, 17 + index] };
  const bytes: Buffer[] = [];
  return { process, reap: exited.resolve, bytes };
}

function syntheticRelease(approval: { binaryDigest: string; sourceDigest: string; headerDigest: string },
  verify: () => Promise<void>) {
  const root = "/synthetic/release";
  const release = { root, identity: "d".repeat(64), runtime: `${root}/runtime/bun`, target: `${root}/worker/cli.js`,
    launcher: `${root}/bin/omp`, verify, manifest: { format: "omp-webui-release-inventory-v1" as const,
      stage: "unaccepted-artifact" as const, platform: "linux", arch: process.arch, assets: [
        { path: "lib/libomp-control-io.so", identity: approval.binaryDigest, kind: "file" as const, mode: 0o444 },
        { path: "provenance/owned-control-io.c", identity: approval.sourceDigest, kind: "file" as const, mode: 0o444 },
        { path: "provenance/owned-control-io.h", identity: approval.headerDigest, kind: "file" as const, mode: 0o444 },
      ], platformDependencies: [
        { path: "/synthetic/libc.so.6", identity: "e".repeat(64), kind: "file" as const, mode: 0o444 },
      ] } };
  return release;
}

function fixture() {
  let leased = true, nativeOpens = 0, nativeCloses = 0, rawCloses = 0, prepares = 0;
  let abi = 1, unloadFails = false, adoptionFails = false, socketCloseFails = false, verifyFails = false;
  const children: { process: PrivateHelperProcess; reap(code: number): void; bytes: Buffer[] }[] = [];
  const approval = { abi: 1 as const, binaryDigest: "a".repeat(64), sourceDigest: "b".repeat(64),
    headerDigest: "c".repeat(64) };
  const verify = async () => { if (!leased || verifyFails) throw new Error("secret selection path"); };
  const release = syntheticRelease(approval, verify);
  const selection: InspectedSelection = { selected: { release, entry: release.launcher,
    sessionAdmission: "blocked", verify }, sessionAdmission: "blocked", verify,
    release: async () => { leased = false; } };
  const library: ControlIoNativeLibrary = { symbols: {
    omp_control_io_abi: () => abi, omp_control_io_live: () => 0,
    omp_control_io_adopt: (fd) => adoptionFails ? 0 : fd,
    omp_control_io_receive: (fd, destination) => {
      const bytes = children[fd - 17]?.bytes.shift();
      if (!bytes) return -1;
      if (bytes.length === 0) return 0;
      destination.set(bytes); return bytes.length;
    },
    omp_control_io_send: (_fd, _bytes, size) => size,
    omp_control_io_close: () => socketCloseFails ? -1 : 0,
  }, close: () => { nativeCloses++; if (unloadFails) throw new Error("unknown unload"); } };
  const load = createOwnedControlIoLoader({ pin: async () => ({ file: { fd: 10, close: async () => {} }, verify }),
    openNative: async () => { nativeOpens++; return library; } });
  const open = () => createPrivateHelperOwnerForTesting({ selection, controlIoApproval: approval }, {
    load, verifyLaunch: async () => {},
    spawn: () => {
      const child = controlledChild(children.length);
      children.push(child); return child.process;
    }, closeControl: () => { rawCloses++; },
  });
  const launch = { generation, cwd: "/synthetic", arguments: ["--mode", "rpc-ui"], environment: {},
    approval: { binaryDigest: "1".repeat(64), sourceDigest: "2".repeat(64),
      controlSourceDigest: "3".repeat(64), candidateSourceDigest: "4".repeat(64) },
    prepareHelper: async () => { prepares++; }, registerHeldHelper: async () => {} };
  return { open, launch, approval, selection, children,
    get leased() { return leased; }, get nativeOpens() { return nativeOpens; },
    get nativeCloses() { return nativeCloses; }, get rawCloses() { return rawCloses; },
    get prepares() { return prepares; },
    wrongAbi() { abi = 2; }, failUnload() { unloadFails = true; },
    failAdoption() { adoptionFails = true; }, failSocketClose() { socketCloseFails = true; },
    failVerification() { verifyFails = true; } };
}

test("unapproved loading refuses owner creation before helper preparation or spawn", async () => {
  const f = fixture(); f.approval.binaryDigest = "f".repeat(64);
  await expect(f.open()).rejects.toMatchObject({ code: "CONTROL_IO_UNAPPROVED" });
  expect([f.prepares, f.children.length, f.nativeOpens]).toEqual([0, 0, 0]);
  expect(f.leased).toBe(false);
});

async function ready(f: ReturnType<typeof fixture>, index: number) {
  const child = f.children[index];
  if (!child) throw new Error("missing controlled child");
  child.bytes.push(Buffer.from(`HELLO ${generation} ${child.process.pid} 123 ${child.process.pid + 100} 124\n`));
}
function complete(f: ReturnType<typeof fixture>, index: number, rootExitCode = 0) {
  const child = f.children[index];
  if (!child) throw new Error("missing controlled child");
  child.bytes.push(Buffer.from(`ROOT_EXIT ${generation} ${rootExitCode} 0\nCOMPLETE ${generation}\n`), Buffer.alloc(0));
  child.reap(0);
}

test("concurrent helpers reuse one approved module and retain selection until explicit awaited close", async () => {
  const f = fixture(); const owner = await f.open();
  const [a, b] = await Promise.all([owner.launch(f.launch), owner.launch(f.launch)]);
  await ready(f, 0); await ready(f, 1);
  await Promise.all([a.ready, b.ready]);
  expect([f.nativeOpens, f.prepares, f.children.length]).toEqual([1, 2, 2]);
  complete(f, 0, 19); await a.completed;
  expect(await a.rootExit).toEqual({ kind: "rootExit", generation, exitCode: 19, signal: 0 });
  expect([f.nativeCloses, f.leased]).toEqual([0, true]);
  let closed = false;
  const closing = owner.close().then(() => { closed = true; });
  await Promise.resolve(); expect(closed).toBe(false);
  await expect(owner.launch(f.launch)).rejects.toMatchObject({ code: "CONTROL_IO_CLOSED" });
  complete(f, 1); await b.completed; await closing;
  expect([f.nativeCloses, f.leased, f.rawCloses]).toEqual([1, false, 0]);
  await owner.close(); expect(f.nativeCloses).toBe(1);
});

test("failed validation refuses preparation and spawn and safely releases its selected lifetime", async () => {
  const f = fixture(); f.wrongAbi();
  await expect(f.open()).rejects.toMatchObject({ code: "CONTROL_IO_ABI" });
  expect([f.prepares, f.children.length, f.nativeCloses, f.leased]).toEqual([0, 0, 1, false]);
});

test("uncertain failed loading retains the selection even without returning an owner", async () => {
  const f = fixture(); f.wrongAbi(); f.failUnload();
  await expect(f.open()).rejects.toMatchObject({ code: "CONTROL_IO_DISPOSAL_UNCERTAIN" });
  expect([f.prepares, f.children.length, f.nativeCloses, f.leased]).toEqual([0, 0, 1, true]);
});

test("adoption failure returns the owning startup handle and closes the untransferred fd exactly once", async () => {
  const f = fixture(); f.failAdoption(); const owner = await f.open();
  const handle = await owner.launch(f.launch);
  await expect(handle.ready).rejects.toMatchObject({ code: "HELPER_CONTROL_UNAVAILABLE" });
  expect(handle.helperPid).toBe(41);
  handle.disconnectControl(); handle.disconnectControl(); expect(f.rawCloses).toBe(1);
  let closed = false;
  const closing = owner.close().then(() => { closed = true; }); void closing.catch(() => {});
  await Promise.resolve(); expect([closed, f.leased, f.nativeCloses]).toEqual([false, true, 0]);
  f.children[0]?.reap(74);
  expect(await handle.helperExited).toBe(74);
  await expect(closing).rejects.toMatchObject({ code: "PRIVATE_DOMAIN_UNRESOLVED" });
  await expect(owner.close()).rejects.toMatchObject({ code: "PRIVATE_DOMAIN_UNRESOLVED" });
  expect([f.nativeCloses, f.leased, f.rawCloses]).toEqual([0, true, 1]);
});

test("uncertain module close after clean completion retains selection and never retries unload", async () => {
  const f = fixture(); const owner = await f.open(); const handle = await owner.launch(f.launch);
  await ready(f, 0); await handle.ready; complete(f, 0); await handle.completed;
  f.failUnload();
  await expect(owner.close()).rejects.toMatchObject({ code: "CONTROL_IO_LOAD_FAILED" });
  await expect(owner.close()).rejects.toMatchObject({ code: "CONTROL_IO_LOAD_FAILED" });
  expect([f.leased, f.nativeCloses, f.rawCloses]).toEqual([true, 1, 0]);
});


test("production owner cannot substitute a supplied controlled loader for independent approval", async () => {
  const f = fixture(); let usedTestLoader = false;
  // JS callers may attach extra properties; the production constructor selects only its private real OS adapter.
  const unapproved = { ...f.selection, selected: { ...f.selection.selected,
    release: { ...f.selection.selected.release, manifest: {
      ...f.selection.selected.release.manifest, assets: [],
    } } } };
  const input = { selection: unapproved, controlIoApproval: f.approval,
    load: async () => { usedTestLoader = true; throw new Error("test factory is not approval"); } };
  await expect(createPrivateHelperOwner(input)).rejects.toMatchObject({ code: "CONTROL_IO_UNAPPROVED" });
  expect([usedTestLoader, f.prepares, f.children.length, f.leased]).toEqual([false, 0, 0, false]);
});

test("a second owner cannot release the maintenance protection of an already loaded owner", async () => {
  const f = fixture(); const owner = await f.open();
  await expect(f.open()).rejects.toMatchObject({ code: "CONTROL_IO_BUSY" });
  expect(f.leased).toBe(true);
  await owner.close(); expect([f.leased, f.nativeCloses]).toEqual([false, 1]);
});


test("uncertain socket closure retains the owning module and lease after the helper is reaped", async () => {
  const f = fixture(); const owner = await f.open(); const handle = await owner.launch(f.launch);
  await ready(f, 0); await handle.ready; f.failSocketClose(); complete(f, 0);
  await expect(handle.completed).rejects.toMatchObject({ code: "PRIVATE_DOMAIN_UNRESOLVED" });
  expect(await handle.helperExited).toBe(0);
  await expect(owner.close()).rejects.toMatchObject({ code: "PRIVATE_DOMAIN_UNRESOLVED" });
  expect([f.nativeCloses, f.rawCloses, f.leased]).toEqual([0, 0, true]);
});

test("preparation refuses disposal and held registration retains protection until completion", async () => {
  const f = fixture(); const owner = await f.open();
  const preparing = Promise.withResolvers<void>(); const registration = Promise.withResolvers<void>();
  const launched = owner.launch({ ...f.launch, prepareHelper: () => preparing.promise,
    registerHeldHelper: () => registration.promise });
  await expect(owner.close()).rejects.toMatchObject({ code: "CONTROL_IO_BUSY" });
  expect([f.leased, f.nativeCloses, f.children.length]).toEqual([true, 0, 0]);
  preparing.resolve(); const handle = await launched; await ready(f, 0);
  const closing = owner.close();
  expect([f.leased, f.nativeCloses]).toEqual([true, 0]);
  registration.resolve(); await handle.ready; complete(f, 0); await closing;
  expect([f.leased, f.nativeCloses]).toEqual([false, 1]);
});


test("selection failure after preparation refuses spawn with bounded Host diagnostics", async () => {
  const f = fixture(); const owner = await f.open();
  const error: unknown = await owner.launch({ ...f.launch, prepareHelper: async () => f.failVerification() })
    .catch((failure: unknown) => failure);
  expect(error).toMatchObject({ code: "HELPER_SELECTION_UNVERIFIED", causeCode: "UNCLASSIFIED" });
  expect(String(error)).toBe("PrivateHelperError: HELPER_SELECTION_UNVERIFIED");
  expect(f.children.length).toBe(0);
  await owner.close(); expect(f.leased).toBe(false);
});
