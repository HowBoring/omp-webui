import { expect, test } from "bun:test";
import type { FileSink } from "bun";
import { SessionWorker } from "../../packages/compatibility/session-worker.ts";
import { createPrivateHelperOwner } from "../../packages/supervision/adapter.ts";
import { createPrivateHelperOwnerForTesting, type PrivateHelperOwnerSystem } from "../../packages/supervision/testing.ts";
import { createOwnedControlIoLoader, type ControlIoNativeLibrary } from "../../packages/control-io/testing.ts";
import type { InspectedSelection } from "../../packages/delivery/coordinator.ts";
import { HostMonotonicError, type HostMonotonicApproval } from "../../packages/supervision/host-monotonic.ts";
import type { PrivateHelperHandle, PrivateHelperProcess } from "../../packages/supervision/controller.ts";
import { sourceFixture } from "../sessions/source-fixture.ts";

const generation = "a".repeat(64);
const clockApproval = { abi: 1 as const, binaryDigest: "e".repeat(64), sourceDigest: "f".repeat(64) };
function controlledChild(index: number) {
  const exited = Promise.withResolvers<number>();
  const stdin: FileSink = { write: () => 1, end: () => 0, flush: () => 0,
    start: () => {}, ref: () => {}, unref: () => {} };
  const stdout = new TransformStream<Uint8Array, Uint8Array>();
  const stderr = new TransformStream<Uint8Array, Uint8Array>();
  const process: PrivateHelperProcess = { pid: 41 + index, stdin,
    stdout: stdout.readable, stderr: stderr.readable, exited: exited.promise, stdio: [null, null, null, 17 + index] };
  const bytes: Buffer[] = [];
  const closeOutput = () => Promise.all([stdout.writable.close(), stderr.writable.close()]);
  return { process, reap: exited.resolve, bytes, closeOutput };
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

function fixture({ verifyLaunch = async () => {}, afterSpawn = () => {} } = {}) {
  let leased = true, nativeOpens = 0, nativeCloses = 0, rawCloses = 0, prepares = 0;
  let abi = 1, unloadFails = false, adoptionFails = false, socketCloseFails = false, verifyFails = false;
  const children: ReturnType<typeof controlledChild>[] = [];
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
  const open = (hostMonotonicApproval?: HostMonotonicApproval,
    retainHostMonotonic?: PrivateHelperOwnerSystem["retainHostMonotonic"]) =>
    createPrivateHelperOwnerForTesting({
      selection, controlIoApproval: approval, ...(hostMonotonicApproval && { hostMonotonicApproval }),
    }, {
      load, verifyLaunch, ...(retainHostMonotonic && { retainHostMonotonic }),
      spawn: () => {
        const child = controlledChild(children.length);
        children.push(child); afterSpawn(); return child.process;
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

test("a previously retired launch refuses verification, preparation and spawn", async () => {
  let verified = false;
  const f = fixture({ verifyLaunch: async () => { verified = true; } });
  const owner = await f.open();
  const signal = AbortSignal.abort(new Error("private retirement reason"));
  await expect(owner.launch(f.launch, signal)).rejects.toMatchObject({
    code: "HELPER_LAUNCH_RETIRED", message: "HELPER_LAUNCH_RETIRED", causeCode: undefined,
  });
  expect([verified, f.prepares, f.children.length]).toEqual([false, 0, 0]);
  await owner.close();
});

test("retirement during launch verification prevents dispatcher preparation and spawn", async () => {
  const verificationStarted = Promise.withResolvers<void>();
  const verification = Promise.withResolvers<void>();
  const f = fixture({ verifyLaunch: () => { verificationStarted.resolve(); return verification.promise; } });
  const owner = await f.open();
  const retirement = new AbortController();
  const launched = owner.launch(f.launch, retirement.signal);
  await verificationStarted.promise;
  retirement.abort();
  verification.resolve();
  await expect(launched).rejects.toMatchObject({ code: "HELPER_LAUNCH_RETIRED" });
  expect([f.prepares, f.children.length]).toEqual([0, 0]);
  await owner.close();
});

test("a trusted pre-spawn refusal releases the Supervisor reservation", async () => {
  const verificationStarted = Promise.withResolvers<void>();
  const verification = Promise.withResolvers<void>();
  const f = fixture({ verifyLaunch: () => { verificationStarted.resolve(); return verification.promise; } });
  const owner = await f.open();
  const offered = Promise.withResolvers<{ retirement: AbortSignal; launch: Promise<PrivateHelperHandle> }>();
  const session = await sourceFixture(Date.now, (cwd, retirement) => {
    const launch = owner.launch({ ...f.launch, cwd }, retirement);
    offered.resolve({ retirement, launch });
    return launch.then(handle => SessionWorker.attachOwned(handle));
  });
  const opening = session.supervisor.open(session.identity, session.selected);
  void opening.catch(() => {});
  try {
    const { retirement, launch } = await offered.promise;
    await verificationStarted.promise;
    expect(retirement?.aborted).toBe(false);

    const shutdown = session.supervisor.close();
    expect(retirement?.aborted).toBe(true);
    verification.resolve();
    await expect(launch).rejects.toMatchObject({ code: "HELPER_LAUNCH_RETIRED" });
    await expect(opening).rejects.toThrow("SESSION_OPEN_OUTCOME_UNKNOWN");
    await shutdown;
    expect([f.prepares, f.children.length]).toEqual([0, 0]);
    expect(session.supervisor.hasOwnedReservation).toBe(false);
    expect(session.supervisor.exits()).toEqual([{ workerId: expect.any(String), reason: "host-shutdown",
      elapsedMs: expect.any(Number), nativeSettled: false, queuedInputsWithdrawn: false, uiCancelled: false,
      drain: { status: "not-launched" }, notificationCount: 0, tailNotifications: 0 }]);
    expect((await session.index.page({})).records[0]?.attempt).toEqual({
      state: "outcome_unknown", code: "SESSION_EXIT_OUTCOME_UNKNOWN",
    });
  } finally {
    verification.resolve();
    const { launch } = await offered.promise;
    if (await launch.catch(() => undefined)) {
      await ready(f, 0);
      complete(f, 0);
      await f.children[0]?.closeOutput();
    }
    await session.close();
    await owner.close();
  }
});

test.each(["different signal", "reused signal"] as const)(
  "a refusal from a second owner invocation with a %s retains the original spawned reservation", async kind => {
    const f = fixture();
    f.failAdoption();
    const owner = await f.open();
    const spawned = Promise.withResolvers<{ retirement: AbortSignal; handle: PrivateHelperHandle }>();
    const delivery = Promise.withResolvers<never>();
    const session = await sourceFixture(Date.now, async (cwd, retirement) => {
      const handle = await owner.launch({ ...f.launch, cwd }, retirement);
      spawned.resolve({ retirement, handle });
      return delivery.promise;
    });
    const opening = session.supervisor.open(session.identity, session.selected);
    void opening.catch(() => {});
    try {
      const { retirement, handle } = await spawned.promise;
      await expect(handle.ready).rejects.toMatchObject({ code: "HELPER_CONTROL_UNAVAILABLE" });
      const shutdown = session.supervisor.close();
      expect(retirement.aborted).toBe(true);
      const signal = kind === "reused signal" ? retirement : AbortSignal.abort();
      const retry = owner.launch(f.launch, signal).catch((error: unknown) => {
        delivery.reject(error);
        throw error;
      });
      await expect(retry).rejects.toMatchObject({ code: "HELPER_LAUNCH_RETIRED" });
      await expect(opening).rejects.toThrow("SESSION_OPEN_OUTCOME_UNKNOWN");
      await shutdown;
      expect([f.prepares, f.children.length]).toEqual([1, 1]);
      expect(session.supervisor.hasOwnedReservation).toBe(true);
      expect(session.supervisor.exits()).toMatchObject([{ drain: {
        status: "unresolved", failure: "SESSION_WORKER_LAUNCH_REJECTED_UNCONFIRMED",
      } }]);
    } finally {
      delivery.reject(new Error("SYNTHETIC_LAUNCH_REJECTED"));
      await session.close();
      f.children[0]?.reap(74);
      await expect(owner.close()).rejects.toMatchObject({ code: "PRIVATE_DOMAIN_UNRESOLVED" });
    }
  },
);

test("retirement during dispatcher preparation prevents final verification and spawn", async () => {
  const f = fixture();
  const owner = await f.open();
  let verified = false;
  f.selection.verify = async () => { verified = true; };
  const preparationStarted = Promise.withResolvers<void>();
  const preparation = Promise.withResolvers<void>();
  const retirement = new AbortController();
  const launched = owner.launch({ ...f.launch, prepareHelper: () => {
    preparationStarted.resolve();
    return preparation.promise;
  } }, retirement.signal);
  await preparationStarted.promise;
  retirement.abort();
  preparation.resolve();
  await expect(launched).rejects.toMatchObject({ code: "HELPER_LAUNCH_RETIRED" });
  expect([verified, f.children.length]).toEqual([false, 0]);
  await owner.close();
});

test("retirement during final selection verification prevents spawn after completed preparation", async () => {
  const f = fixture();
  const owner = await f.open();
  const verificationStarted = Promise.withResolvers<void>();
  const verification = Promise.withResolvers<void>();
  f.selection.verify = () => { verificationStarted.resolve(); return verification.promise; };
  const retirement = new AbortController();
  const launched = owner.launch(f.launch, retirement.signal);
  await verificationStarted.promise;
  retirement.abort();
  verification.resolve();
  await expect(launched).rejects.toMatchObject({ code: "HELPER_LAUNCH_RETIRED" });
  expect([f.prepares, f.children.length]).toEqual([1, 0]);
  await owner.close();
});

test("retirement after spawn preserves the original handle and waits for its completion", async () => {
  const retirement = new AbortController();
  const f = fixture({ afterSpawn: () => retirement.abort() });
  const owner = await f.open();
  const handle = await owner.launch(f.launch, retirement.signal);
  expect(retirement.signal.aborted).toBe(true);
  const child = f.children[0];
  if (!child) throw new Error("missing controlled child");
  expect(handle.helperPid).toBe(child.process.pid);
  expect(handle.stdout).toBe(child.process.stdout);
  expect(handle.stderr).toBe(child.process.stderr);
  await ready(f, 0);
  await handle.ready;

  const closing = owner.close();
  await Promise.resolve();
  expect([f.leased, f.nativeCloses]).toEqual([true, 0]);
  complete(f, 0);
  await closing;
  expect(await handle.helperExited).toBe(0);
  expect([f.leased, f.nativeCloses, f.children.length]).toEqual([false, 1, 1]);
});

test("concurrent helpers reuse one approved module and retain selection until explicit awaited close", async () => {
  const f = fixture(); const owner = await f.open();
  const [a, b] = await Promise.all([owner.launch(f.launch), owner.launch(f.launch)]);
  await ready(f, 0); await ready(f, 1);
  await Promise.all([a.ready, b.ready]);
  expect([f.nativeOpens, f.prepares, f.children.length]).toEqual([1, 2, 2]);
  expect(a.readHostMonotonic).toBeUndefined();
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

test("the original helper handles share an optional Host clock while their owner retains selection", async () => {
  const f = fixture();
  const clockOpens: InspectedSelection[] = [];
  let closed = 0;
  const owner = await f.open(clockApproval, async ({ selection, approval }) => {
    clockOpens.push(selection);
    expect(selection).toBe(f.selection);
    expect(approval).toEqual(clockApproval);
    return { read: () => 9_007_199_254_740_993n, close: async () => { closed++; } };
  });
  const [first, second] = await Promise.all([owner.launch(f.launch), owner.launch(f.launch)]);
  try {
    await ready(f, 0); await ready(f, 1);
    await Promise.all([first.ready, second.ready]);
    expect(first.readHostMonotonic?.()).toBe(9_007_199_254_740_993n);
    expect(second.readHostMonotonic?.()).toBe(9_007_199_254_740_993n);
    expect(clockOpens).toHaveLength(1);
    const closing = owner.close();
    complete(f, 0); await first.completed;
    expect([closed, f.nativeCloses, f.leased]).toEqual([0, 0, true]);
    complete(f, 1); await closing;
    expect([closed, f.nativeCloses, f.leased]).toEqual([1, 1, false]);
  } finally {
    complete(f, 0); complete(f, 1);
    await owner.close();
  }
});

test("a bounded clock refusal rolls back loaded control I/O before releasing selection", async () => {
  const f = fixture();
  await expect(f.open(clockApproval, async () => { throw new HostMonotonicError("HOST_MONOTONIC_UNAPPROVED"); }))
    .rejects.toMatchObject({ code: "HOST_MONOTONIC_UNAPPROVED" });
  expect([f.nativeOpens, f.nativeCloses, f.leased, f.prepares, f.children.length]).toEqual([1, 1, false, 0, 0]);
});

test("failure to verify the assembled selection disposes the clock before control I/O", async () => {
  const f = fixture();
  let closes = 0;
  await expect(f.open(clockApproval, async () => {
    f.failVerification();
    return { read: () => 0n, async close() {
      expect([f.nativeCloses, f.leased]).toEqual([0, true]);
      closes++;
    } };
  })).rejects.toMatchObject({ code: "HELPER_SELECTION_UNVERIFIED" });
  expect([closes, f.nativeCloses, f.leased, f.prepares, f.children.length]).toEqual([1, 1, false, 0, 0]);
});

test("uncertain clock setup parks the loaded control I/O and original lease before any launch", async () => {
  const f = fixture();
  await expect(f.open(clockApproval, async () => {
    throw new HostMonotonicError("HOST_MONOTONIC_DISPOSAL_UNCERTAIN");
  })).rejects.toMatchObject({ code: "HOST_MONOTONIC_DISPOSAL_UNCERTAIN" });
  await expect(f.open()).rejects.toMatchObject({ code: "CONTROL_IO_BUSY" });
  expect([f.nativeOpens, f.nativeCloses, f.leased, f.prepares, f.children.length]).toEqual([1, 0, true, 0, 0]);
});

test("uncertain control I/O rollback retains selection after a safe clock refusal", async () => {
  const f = fixture();
  f.failUnload();
  await expect(f.open(clockApproval, async () => { throw new HostMonotonicError("HOST_MONOTONIC_UNAPPROVED"); }))
    .rejects.toMatchObject({ code: "CONTROL_IO_LOAD_FAILED" });
  await expect(f.open()).rejects.toMatchObject({ code: "CONTROL_IO_BUSY" });
  expect([f.nativeOpens, f.nativeCloses, f.leased, f.prepares, f.children.length]).toEqual([1, 1, true, 0, 0]);
});

test("uncertain retained clock disposal parks the owner and is never retried", async () => {
  const f = fixture();
  let closes = 0;
  const owner = await f.open(clockApproval, async () => ({
    read: () => 0n,
    async close() { closes++; throw new HostMonotonicError("HOST_MONOTONIC_DISPOSAL_UNCERTAIN"); },
  }));
  const closing = owner.close();
  await expect(closing).rejects.toMatchObject({ code: "HOST_MONOTONIC_DISPOSAL_UNCERTAIN" });
  expect(owner.close()).toBe(closing);
  await expect(owner.launch(f.launch)).rejects.toMatchObject({ code: "CONTROL_IO_CLOSED" });
  await expect(f.open()).rejects.toMatchObject({ code: "CONTROL_IO_BUSY" });
  expect([closes, f.nativeCloses, f.leased, f.prepares, f.children.length]).toEqual([1, 0, true, 0, 0]);
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
