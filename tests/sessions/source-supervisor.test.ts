import { expect, spyOn, test } from "bun:test";
import { z } from "zod";
import { rm, rename, mkdir } from "node:fs/promises";
import { sourceFixture } from "./source-fixture.ts";
import type { OwnedSessionConnection } from "../../packages/compatibility/session-worker.ts";
import type { DrainPolicy, DrainResult } from "../../packages/compatibility/stdio-transport.ts";

test("explicit Open retains a stable prelaunch failure when its selected cwd disappeared", async () => {
  const f = await sourceFixture();
  try {
    await rm(f.cwd, { recursive: true });
    await expect(f.supervisor.open(f.identity, f.selected)).rejects.toThrow("SESSION_CWD_CHANGED");
    expect((await f.index.page({})).records).toMatchObject([{ reference: f.selected.reference,
      attempt: { state: "failed", code: "SESSION_CWD_CHANGED" } }]);
    expect(f.supervisor.starts).toBe(0);
  } finally { await f.close(); }
});

test.each([undefined, "RPC_PROTOCOL"])("Open failure survives older idle completion with tail %s at the same clock", async protocolFailure => {
  const f = await sourceFixture(() => 1_794_787_200_000);
  const completion = Promise.withResolvers<import("../../packages/compatibility/stdio-transport.ts").DrainResult>();
  try {
    await f.supervisor.open(f.identity, f.selected);
    f.controls.retirement = { status: "pending", completion: completion.promise, stdoutEOF: false, stderrEOF: false };
    await expect(f.supervisor.create(f.identity, f.cwd)).rejects.toThrow("SESSION_IDLE_EXIT_UNCONFIRMED_PENDING_48");
    await expect(f.supervisor.open(f.identity, f.selected)).rejects.toThrow("SESSION_WORKER_DRAINING");
    expect((await f.index.page({})).records[0]?.attempt).toEqual({ state: "failed", code: "SESSION_WORKER_DRAINING" });
    expect(f.supervisor.starts).toBe(1);
    const drain = { ...f.controls.drain, ...(protocolFailure ? { protocolFailure } : {}) };
    completion.resolve(drain); await completion.promise;
    expect((await f.index.page({})).records[0]?.attempt).toEqual({ state: "failed", code: "SESSION_WORKER_DRAINING" });
    expect(f.supervisor.exits()).toMatchObject([{ workerId: expect.any(String), reason: "explicit-new", drain }]);
    // The old worker is released even though its terminal observation no longer owns the UI attempt.
    expect(await f.supervisor.open(f.identity, f.selected)).toMatchObject({ state: "open" });
    expect(f.supervisor.starts).toBe(2);
  } finally { completion.resolve(f.controls.drain); await f.close(); }
});

test("idle Switch retains the owned worker when one reader has no EOF observation", async () => {
  const f = await sourceFixture();
  const drain = { code: 0, forced: false, stderrBytes: 0, stdoutEOF: true };
  try {
    const opened = await f.supervisor.open(f.identity, f.selected);
    const start = f.controls.start;
    f.controls.start = async () => ({ ...await start(), nativeSessionId: f.other.nativeSessionId,
      binding: { ...f.other, ownership: { ...f.other.ownership, state: "held" } } });
    f.controls.retirement = { status: "closed", drain };

    await expect(f.supervisor.switchTo(f.identity, f.other)).rejects.toThrow("SESSION_WORKER_DRAINING");
    await expect(f.supervisor.switchTo(f.identity, f.other)).rejects.toThrow("SESSION_WORKER_DRAINING");
    await expect(f.supervisor.create(f.identity, f.cwd)).rejects.toThrow("SESSION_WORKER_DRAINING");
    expect(f.supervisor.hasOwnedReservation).toBe(true);
    expect(f.supervisor.starts).toBe(1);
    expect(f.index.get(opened.registration.id)?.attempt).toEqual({
      state: "outcome_unknown", code: "SESSION_IDLE_EXIT_UNCONFIRMED_PENDING_48",
    });
    expect(f.supervisor.exits()).toMatchObject([{ workerId: opened.workerId, reason: "explicit-switch", drain }]);

    await f.supervisor.close();
    expect(f.supervisor.hasOwnedReservation).toBe(false);
    expect(f.supervisor.exits().at(-1)).toMatchObject({ workerId: opened.workerId, reason: "host-shutdown",
      drain: f.controls.drain });
  } finally { await f.close(); }
});

test("a lost worker fences its view and keeps the slot until both owned readers finish", async () => {
  const f = await sourceFixture();
  const completion = Promise.withResolvers<import("../../packages/compatibility/stdio-transport.ts").DrainResult>();
  const drain = { code: 7, forced: false, stderrBytes: 12, stdoutEOF: true, stderrEOF: true };
  f.controls.retirement = { status: "pending", completion: completion.promise, stdoutEOF: false, stderrEOF: false };
  try {
    const opened = await f.supervisor.open(f.identity, f.selected);
    await f.exitWorker(drain.code);
    expect(() => f.supervisor.view(f.identity, opened.workerId)).toThrow("SESSION_MANUAL_OPEN_REQUIRED");
    expect(f.index.get(opened.registration.id)?.attempt).toEqual({
      state: "outcome_unknown", code: "SESSION_WORKER_LOST_MANUAL_OPEN_REQUIRED",
    });
    await expect(f.supervisor.open(f.identity, f.selected)).rejects.toThrow("SESSION_WORKER_DRAINING");
    await expect(f.supervisor.create(f.identity, f.cwd)).rejects.toThrow("SESSION_WORKER_DRAINING");
    await expect(f.supervisor.switchTo(f.identity, f.other)).rejects.toThrow("SESSION_WORKER_DRAINING");
    expect(f.index.get(opened.registration.id)?.attempt).toEqual({ state: "failed", code: "SESSION_WORKER_DRAINING" });
    expect(f.supervisor.starts).toBe(1);

    completion.resolve(drain); await completion.promise;
    expect(f.supervisor.exits()).toMatchObject([{ workerId: opened.workerId, drain }]);
    expect(f.index.get(opened.registration.id)?.attempt).toEqual({ state: "failed", code: "SESSION_WORKER_DRAINING" });
    const reopened = await f.supervisor.open(f.identity, f.selected);
    expect(reopened.state).toBe("open");
    expect(reopened.workerId).not.toBe(opened.workerId);
    expect(reopened.generation).not.toBe(opened.generation);
  } finally { completion.resolve(drain); await f.close(); }
});

test.each(["incomplete", "rejected"])("a lost worker remains owned when its drain is %s", async outcome => {
  const f = await sourceFixture();
  const completion = Promise.withResolvers<import("../../packages/compatibility/stdio-transport.ts").DrainResult>();
  const drain = { code: 0, forced: false, stderrBytes: 0, stdoutEOF: true, stderrEOF: false };
  f.controls.retirement = { status: "pending", completion: completion.promise, stdoutEOF: false, stderrEOF: false };
  try {
    const opened = await f.supervisor.open(f.identity, f.selected);
    await f.exitWorker(drain.code);
    await expect(f.supervisor.open(f.identity, f.selected)).rejects.toThrow("SESSION_WORKER_DRAINING");

    if (outcome === "rejected") completion.reject(new Error("SYNTHETIC_DRAIN_FAILED"));
    else completion.resolve(drain);
    await completion.promise.catch(() => {});
    await expect(f.supervisor.open(f.identity, f.selected)).rejects.toThrow("SESSION_WORKER_DRAINING");
    expect(f.supervisor.starts).toBe(1);
    expect(f.supervisor.exits()[0]?.drain).toEqual(outcome === "rejected"
      ? { status: "unresolved", code: 0, failure: "SESSION_WORKER_DRAIN_UNAVAILABLE" }
      : drain);

    f.controls.drain = { ...drain, stderrEOF: true };
    await f.supervisor.close();
    expect(f.supervisor.exits().at(-1)).toMatchObject({
      workerId: opened.workerId, reason: "host-shutdown", drain: f.controls.drain,
    });
  } finally { completion.resolve(drain); await f.close(); }
});

function pendingLaunch(controls: { launch(): Promise<void> }) {
  const reached = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  controls.launch = async () => { reached.resolve(); await release.promise; };
  return { reached: reached.promise, release: release.resolve, reject: release.reject };
}

function shutdownClock() {
  let time = 0;
  const now = spyOn(performance, "now").mockImplementation(() => time);
  const schedule = globalThis.setTimeout;
  const deadlines = new Map<number, () => void>();
  function scheduleDeadline(handler: Bun.TimerHandler, delay?: number, ...args: unknown[]) {
    if (typeof handler !== "function" || (delay !== 30_000 && delay !== 5_000 && delay !== 35_000)) return schedule(handler, delay, ...args);
    deadlines.set(time + delay, () => handler(...args));
    return schedule(() => {}, delay).unref();
  }
  Object.defineProperty(globalThis, "setTimeout", { value: scheduleDeadline });
  return {
    async advance(to: number, deliverTimers = true) {
      time = to;
      for (const [at, resolve] of deadlines) {
        if (!deliverTimers) break;
        if (at > time) continue;
        deadlines.delete(at);
        resolve();
      }
      await new Promise<void>(resolve => setImmediate(resolve));
    },
    restore() {
      Object.defineProperty(globalThis, "setTimeout", { value: schedule });
      now.mockRestore();
    },
  };
}

test("mandatory directory revocation retains a launch past the shutdown deadline until actual owned drain", async () => {
  const f = await sourceFixture();
  const launch = pendingLaunch(f.controls);
  const drain = { code: 7, forced: true, stderrBytes: 12, stdoutEOF: true, stderrEOF: true };
  const closing = Promise.withResolvers<DrainPolicy>(), waitAndEOF = Promise.withResolvers<DrainResult>();
  let closeCalls = 0;
  f.controls.close = async policy => { closeCalls++; closing.resolve(policy); return waitAndEOF.promise; };
  const first = f.supervisor.open(f.identity, f.selected);
  void first.catch(() => {});
  const clock = shutdownClock();
  try {
    await launch.reached;
    f.grants.revoke(f.grant.id);
    const revocation = f.supervisor.permissionsChanged();
    await clock.advance(30_000);
    await clock.advance(35_000);
    await revocation;
    f.grants.confirm(f.grants.preview(f.cwd).confirmation);
    const replacement = f.supervisor.open(f.identity, f.selected);
    void replacement.catch(() => {});
    // Sample this while the original launcher is unresolved; a second launch also waits on the fixture gate.
    await clock.advance(35_000);
    expect(f.supervisor.starts).toBe(1);
    await expect(replacement).rejects.toThrow("SESSION_WORKER_DRAINING");
    expect(f.supervisor.exits()).toMatchObject([{ reason: "directory-revoked", drain: {
      status: "unresolved", failure: "SESSION_WORKER_LAUNCH_UNRESOLVED",
    } }]);
    expect(f.supervisor.exits()[0]?.drain.code).toBeUndefined();

    await clock.advance(40_000);
    f.controls.notificationCount = 3;
    launch.release();
    await expect(first).rejects.toThrow("SESSION_MANUAL_OPEN_REQUIRED");
    expect(await closing.promise).toEqual({ cooperativeMs: 0, terminationGraceMs: 0, readerGraceMs: 1_000 });
    await expect(f.supervisor.open(f.identity, f.selected)).rejects.toThrow("SESSION_WORKER_DRAINING");
    expect(f.supervisor.exits()).toHaveLength(1);
    waitAndEOF.resolve(drain);
    await clock.advance(40_000);
    expect(closeCalls).toBe(1);
    expect(f.supervisor.exits().at(-1)).toMatchObject({ reason: "directory-revoked", drain,
      notificationCount: 3, tailNotifications: 3, tailNotificationsLowerBound: true });
    expect(f.supervisor.hasOwnedReservation).toBe(false);
    expect((await f.index.page({})).records[0]?.attempt).toEqual({ state: "failed", code: "SESSION_WORKER_DRAINING" });
    expect(await f.supervisor.open(f.identity, f.selected)).toMatchObject({ state: "open" });
    expect(f.supervisor.starts).toBe(2);
  } finally {
    launch.release(); waitAndEOF.resolve(drain); await first.catch(() => {}); clock.restore(); await f.close();
  }
});

test("concurrent Host shutdown and revoke-all share the remaining grace for one late worker", async () => {
  const f = await sourceFixture();
  const launch = pendingLaunch(f.controls);
  const start = spyOn(f.controls, "start");
  const closeWorker = spyOn(f.controls, "close");
  f.controls.drain = { code: 0, forced: false, stderrBytes: 0, stdoutEOF: true, stderrEOF: true };
  const opening = f.supervisor.open(f.identity, f.selected);
  void opening.catch(() => {});
  const clock = shutdownClock();
  try {
    await launch.reached;
    const shutdown = f.supervisor.close(), revocation = f.supervisor.revokeAll();
    await expect(f.supervisor.open(f.identity, f.selected)).rejects.toThrow("SESSION_HOST_CLOSING");
    await clock.advance(30_000);
    await clock.advance(32_000);
    launch.release();
    await Promise.all([shutdown, revocation]);
    await expect(opening).rejects.toThrow("SESSION_HOST_CLOSING");
    expect(closeWorker).toHaveBeenCalledTimes(1);
    expect(closeWorker).toHaveBeenCalledWith({ cooperativeMs: 0, terminationGraceMs: 3_000, readerGraceMs: 1_000 });
    expect(start).not.toHaveBeenCalled();
    expect(f.supervisor.exits()).toMatchObject([{ reason: "host-shutdown", elapsedMs: 32_000, nativeSettled: false,
      queuedInputsWithdrawn: false, uiCancelled: false, drain: f.controls.drain }]);
  } finally {
    launch.release(); await opening.catch(() => {}); clock.restore(); await f.close();
  }
});

test("a launch rejected after bounded Host shutdown leaves ownership unknown with the index closed", async () => {
  const f = await sourceFixture();
  const launch = pendingLaunch(f.controls);
  const closeWorker = spyOn(f.controls, "close");
  const opening = f.supervisor.open(f.identity, f.selected);
  void opening.catch(() => {});
  const clock = shutdownClock();
  try {
    await launch.reached;
    const shutdown = f.supervisor.close();
    await clock.advance(30_000);
    await clock.advance(35_000);
    await shutdown;
    expect(f.supervisor.hasOwnedReservation).toBe(true);
    expect((await f.index.page({})).records[0]?.attempt).toEqual({
      state: "outcome_unknown", code: "SESSION_EXIT_OUTCOME_UNKNOWN",
    });
    f.index.close();
    launch.reject(new Error("STRICT_OCCUPIED"));
    await expect(opening).rejects.toThrow("STRICT_OCCUPIED");
    await clock.advance(35_000);
    expect(closeWorker).not.toHaveBeenCalled();
    expect(f.supervisor.hasOwnedReservation).toBe(true);
    expect(f.supervisor.exits()).toMatchObject([
      { reason: "host-shutdown", drain: { status: "unresolved", failure: "SESSION_WORKER_LAUNCH_UNRESOLVED" } },
      { reason: "host-shutdown", drain: { status: "unresolved", failure: "SESSION_WORKER_LAUNCH_REJECTED_UNCONFIRMED" } },
    ]);
    expect(f.supervisor.exits().at(-1)?.drain.code).toBeUndefined();
  } finally {
    launch.release(); await opening.catch(() => {}); clock.restore(); await f.close();
  }
});

test.each(["launch rejection", "close rejection", "missing EOF"])(
  "late %s retains the reservation when the overdue timer has yet to run", async outcome => {
    const f = await sourceFixture(), launch = pendingLaunch(f.controls);
    const opening = f.supervisor.open(f.identity, f.selected);
    void opening.catch(() => {});
    const clock = shutdownClock();
    try {
      await launch.reached;
      if (outcome === "close rejection") f.controls.close = async () => { throw new Error("SYNTHETIC_DRAIN_FAILED"); };
      if (outcome === "missing EOF") f.controls.drain = { code: 0, forced: false, stderrBytes: 0, stdoutEOF: true };
      f.grants.revoke(f.grant.id);
      const revocation = f.supervisor.permissionsChanged();
      void revocation.catch(() => {});
      await clock.advance(32_000, false);
      if (outcome === "launch rejection") launch.reject(new Error("STRICT_OCCUPIED"));
      else launch.release();
      await clock.advance(32_000, false);
      await revocation;
      f.grants.confirm(f.grants.preview(f.cwd).confirmation);
      expect(await f.index.page({})).toMatchObject({ records: [{ attempt: {
        state: "outcome_unknown", code: "SESSION_EXIT_OUTCOME_UNKNOWN",
      } }] });
      const replacement = f.supervisor.open(f.identity, f.selected);
      void replacement.catch(() => {});
      await clock.advance(32_000, false);
      expect(f.supervisor.starts).toBe(1);
      await expect(replacement).rejects.toThrow("SESSION_WORKER_DRAINING");
      const expectedDrain = outcome === "launch rejection"
        ? { status: "unresolved", failure: "SESSION_WORKER_LAUNCH_REJECTED_UNCONFIRMED" }
        : outcome === "close rejection" ? { status: "unresolved", failure: "SESSION_WORKER_DRAIN_UNAVAILABLE" }
          : f.controls.drain;
      expect(f.supervisor.exits()).toMatchObject([{ reason: "directory-revoked", drain: expectedDrain }]);
    } finally {
      launch.release(); await opening.catch(() => {}); clock.restore(); await f.close();
    }
  },
);

test.each(["missing EOF", "rejected close"])("%s retains a worker delivered at 29,999ms", async outcome => {
  const f = await sourceFixture(), launch = pendingLaunch(f.controls);
  const closing = Promise.withResolvers<DrainPolicy>(), completion = Promise.withResolvers<DrainResult>();
  const partial = { code: 0, forced: false, stderrBytes: 0, stdoutEOF: true };
  f.controls.close = async policy => { closing.resolve(policy); return completion.promise; };
  const opening = f.supervisor.open(f.identity, f.selected);
  void opening.catch(() => {});
  const clock = shutdownClock();
  try {
    await launch.reached;
    f.grants.revoke(f.grant.id);
    const revocation = f.supervisor.permissionsChanged();
    void revocation.catch(() => {});
    await clock.advance(29_999);
    launch.release();
    expect(await closing.promise).toEqual({ cooperativeMs: 1, terminationGraceMs: 5_000, readerGraceMs: 1_000 });
    f.grants.confirm(f.grants.preview(f.cwd).confirmation);
    await expect(f.supervisor.open(f.identity, f.selected)).rejects.toThrow("SESSION_WORKER_DRAINING");
    const [latest] = (await f.index.page({})).records;
    if (outcome === "missing EOF") completion.resolve(partial);
    else completion.reject(new Error("SYNTHETIC_DRAIN_FAILED"));
    await revocation;
    expect(f.supervisor.hasOwnedReservation).toBe(true);
    expect(f.index.get(latest!.id)).toEqual(latest);
    await expect(f.supervisor.open(f.identity, f.selected)).rejects.toThrow("SESSION_WORKER_DRAINING");
    expect(f.supervisor.starts).toBe(1);
    const drain = outcome === "missing EOF" ? partial : { status: "unresolved", failure: "SESSION_WORKER_DRAIN_UNAVAILABLE" };
    expect(f.supervisor.exits()).toMatchObject([{ reason: "directory-revoked", tailNotificationsLowerBound: true, drain }]);
  } finally {
    launch.release(); completion.resolve(partial); await opening.catch(() => {}); clock.restore(); await f.close();
  }
});

test("a launch delivered after the force deadline cannot hold the bounded shutdown observation", async () => {
  const f = await sourceFixture(), launch = pendingLaunch(f.controls);
  const completion = Promise.withResolvers<DrainResult>();
  const drain = { code: 7, forced: true, stderrBytes: 12, stdoutEOF: true, stderrEOF: true };
  f.controls.close = () => completion.promise;
  const opening = f.supervisor.open(f.identity, f.selected);
  void opening.catch(() => {});
  const clock = shutdownClock();
  let shutdownObserved = false;
  try {
    await launch.reached;
    const shutdown = f.supervisor.close().then(() => { shutdownObserved = true; });
    await clock.advance(36_000, false);
    launch.release();
    await clock.advance(36_000, false);
    expect(shutdownObserved).toBe(true);
    await shutdown;
    expect(f.supervisor.exits()).toMatchObject([{ reason: "host-shutdown", drain: {
      status: "unresolved", failure: "SESSION_WORKER_LAUNCH_UNRESOLVED",
    } }]);
    f.index.close();
    completion.resolve(drain);
    await clock.advance(36_000, false);
    expect(f.supervisor.exits().at(-1)).toMatchObject({ reason: "host-shutdown", drain });
    expect(f.supervisor.hasOwnedReservation).toBe(false);
  } finally {
    launch.release(); completion.resolve(drain); await opening.catch(() => {}); clock.restore(); await f.close();
  }
});

test("mandatory shutdown retains the root exit's failed index observation during passive drain", async () => {
  const f = await sourceFixture();
  const retirement = Promise.withResolvers<import("../../packages/compatibility/stdio-transport.ts").GracefulDrainResult>();
  const drain = { code: 7, forced: false, stderrBytes: 12, stdoutEOF: true, stderrEOF: true };
  f.controls.retirement = retirement.promise;
  f.controls.drain = drain;
  let replaced = false;
  try {
    const opened = await f.supervisor.open(f.identity, f.selected);
    await rename(f.dataDir, f.dataDir + ".original"); replaced = true; await mkdir(f.dataDir);
    await f.exitWorker(drain.code);
    await rm(f.dataDir, { recursive: true }); await rename(f.dataDir + ".original", f.dataDir); replaced = false;
    expect(f.index.get(opened.registration.id)?.attempt).toEqual({ state: "open" });

    const shutdown = f.supervisor.close();
    retirement.reject(new Error("SYNTHETIC_RETIREMENT_FAILED"));
    await retirement.promise.catch(() => {});
    await shutdown;
    const exits = f.supervisor.exits();
    const mandatory = exits.find(exit => exit.reason === "host-shutdown");
    expect(mandatory).toMatchObject({ workerId: opened.workerId, indexFailure: "SESSION_ATTEMPT_UNAVAILABLE", drain });
    const passive = exits.find(exit => exit.reason === "worker-lost");
    expect(passive).toMatchObject({ workerId: opened.workerId, indexFailure: "SESSION_ATTEMPT_UNAVAILABLE" });
    expect(passive?.drain).toEqual({ status: "unresolved", code: 7, failure: "SESSION_WORKER_DRAIN_UNAVAILABLE" });
    expect(exits).toHaveLength(2);
    expect(f.index.get(opened.registration.id)?.attempt.state).toBe("outcome_unknown");
  } finally {
    retirement.resolve({ status: "closed", drain });
    if (replaced) { await rm(f.dataDir, { recursive: true, force: true }); await rename(f.dataDir + ".original", f.dataDir); }
    await f.close();
  }
});

test("Host shutdown can proceed after close rejects and records only the observed root exit", async () => {
  const f = await sourceFixture();
  const readers = Promise.withResolvers<DrainResult>();
  f.controls.retirement = { status: "pending", completion: readers.promise, stdoutEOF: false, stderrEOF: false };
  f.controls.close = async () => { throw new Error("SYNTHETIC_DRAIN_FAILED"); };
  try {
    const opened = await f.supervisor.open(f.identity, f.selected);
    await f.exitWorker(7);
    await f.supervisor.close();
    expect(f.supervisor.hasOwnedReservation).toBe(true);
    expect(f.supervisor.exits()).toMatchObject([{ workerId: opened.workerId, reason: "host-shutdown",
      drain: { status: "unresolved", code: 7, failure: "SESSION_WORKER_DRAIN_UNAVAILABLE" } }]);
    expect(f.index.get(opened.registration.id)?.attempt).toEqual({
      state: "outcome_unknown", code: "SESSION_WORKER_LOST_MANUAL_OPEN_REQUIRED",
    });
    f.index.close();
  } finally { readers.resolve(f.controls.drain); await f.close(); }
});

test("zero exit with a failed final protocol tail persists an unknown shutdown outcome", async () => {
  const f = await sourceFixture();
  try {
    const opened = await f.supervisor.open(f.identity, f.selected);
    f.controls.drain = { ...f.controls.drain, protocolFailure: "RPC_PROTOCOL" };
    await f.supervisor.close();
    expect(f.index.get(opened.registration.id)?.attempt).toEqual({ state: "outcome_unknown", code: "SESSION_EXIT_OUTCOME_UNKNOWN" });
    expect(f.supervisor.exits()[0]?.drain).toMatchObject({ code: 0, forced: false, protocolFailure: "RPC_PROTOCOL" });
  } finally { await f.close(); }
});

test("retired startup completion preserves a newer refused Open after the worker slot is released", async () => {
  const f = await sourceFixture(() => 1_794_787_200_000);
  const reached = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  let first: Promise<unknown> | undefined;
  try {
    const start = f.controls.start;
    f.controls.start = async () => { reached.resolve(); await release.promise; return start(); };
    first = f.supervisor.open(f.identity, f.selected); void first.catch(() => {});
    await reached.promise;
    f.grants.revoke(f.grant.id); await f.supervisor.permissionsChanged();
    expect(f.controls.closed).toBe(true);
    await expect(f.supervisor.open(f.identity, f.selected)).rejects.toThrow("SESSION_DIRECTORY_DENIED");
    release.resolve(); await expect(first).rejects.toThrow("SESSION_OPEN_RETIRED_OUTCOME_UNKNOWN");
    expect((await f.index.page({})).records[0]?.attempt).toEqual({ state: "failed", code: "SESSION_DIRECTORY_DENIED" });
    expect(f.supervisor.starts).toBe(1);
    expect(f.supervisor.exits()).toMatchObject([{ reason: "directory-revoked" }, { reason: "open-failed" }]);
  } finally { release.resolve(); await first?.catch(() => {}); await f.close(); }
});

test("idle completion records actual cleanup even when the index cannot save its outcome", async () => {
  const f = await sourceFixture();
  const completion = Promise.withResolvers<import("../../packages/compatibility/stdio-transport.ts").DrainResult>();
  let replaced = false;
  try {
    await f.supervisor.open(f.identity, f.selected);
    f.controls.retirement = { status: "pending", completion: completion.promise, stdoutEOF: false, stderrEOF: false };
    await expect(f.supervisor.create(f.identity, f.cwd)).rejects.toThrow("SESSION_IDLE_EXIT_UNCONFIRMED_PENDING_48");
    await rename(f.dataDir, f.dataDir + ".original"); replaced = true; await mkdir(f.dataDir);
    completion.resolve(f.controls.drain); await completion.promise;
    expect(f.supervisor.exits()).toMatchObject([{ reason: "explicit-new", indexFailure: "SESSION_ATTEMPT_UNAVAILABLE",
      drain: { code: 0, forced: false } }]);
    await rm(f.dataDir, { recursive: true }); await rename(f.dataDir + ".original", f.dataDir); replaced = false;
    expect(await f.supervisor.open(f.identity, f.selected)).toMatchObject({ state: "open" });
    expect(f.supervisor.starts).toBe(2);
  } finally {
    completion.resolve(f.controls.drain);
    if (replaced) { await rm(f.dataDir, { recursive: true }); await rename(f.dataDir + ".original", f.dataDir); }
    await f.close();
  }
});

test("an oversized adapter code remains bounded and its unknown worker is available for manual observation", async () => {
  const f = await sourceFixture();
  try {
    f.controls.start = async () => { throw new Error("STRICT_" + "A".repeat(200)); };
    await expect(f.supervisor.open(f.identity, f.selected)).rejects.toThrow("SESSION_OPEN_OUTCOME_UNKNOWN");
    expect((await f.index.page({})).records[0]?.attempt).toEqual({ state: "outcome_unknown", code: "SESSION_OPEN_OUTCOME_UNKNOWN" });
    expect(f.controls.closed).toBe(false);
    expect(await f.supervisor.recheck(f.identity)).toMatchObject({ state: "open" });
    expect(f.supervisor.starts).toBe(1);
  } finally { await f.close(); }
});


test("a failed attempt write cannot bypass cleanup of a definitely refused owned worker", async () => {
  const f = await sourceFixture();
  try {
    f.controls.start = async () => {
      await rename(f.dataDir, f.dataDir + ".original"); await mkdir(f.dataDir);
      throw new Error("STRICT_OCCUPIED");
    };
    await expect(f.supervisor.open(f.identity, f.selected)).rejects.toThrow("SESSION_ATTEMPT_UNAVAILABLE");
    expect(f.controls.closed).toBe(true);
    expect(f.supervisor.exits()).toMatchObject([{ reason: "open-failed", indexFailure: "SESSION_ATTEMPT_UNAVAILABLE", drain: { code: 0 } }]);
  } finally { await rm(f.dataDir, { recursive: true }); await rename(f.dataDir + ".original", f.dataDir); await f.close(); }
});

test("an index outage retains an unknown owned worker for manual observation after storage recovers", async () => {
  const f = await sourceFixture();
  let restored = false;
  try {
    f.controls.start = async () => {
      await rename(f.dataDir, f.dataDir + ".original"); await mkdir(f.dataDir);
      throw new Error("RPC_REQUEST_TIMEOUT");
    };
    await expect(f.supervisor.open(f.identity, f.selected)).rejects.toThrow("SESSION_ATTEMPT_UNAVAILABLE");
    expect(f.controls.closed).toBe(false); expect(f.supervisor.exits()).toEqual([]);
    await rm(f.dataDir, { recursive: true }); await rename(f.dataDir + ".original", f.dataDir); restored = true;
    expect(await f.supervisor.recheck(f.identity)).toMatchObject({ state: "open" });
    expect(f.supervisor.starts).toBe(1);
  } finally {
    if (!restored) { await rm(f.dataDir, { recursive: true }); await rename(f.dataDir + ".original", f.dataDir); }
    await f.close();
  }
});

test("a replaced directory is a durable prelaunch refusal without a worker", async () => {
  const f = await sourceFixture();
  try {
    await rename(f.cwd, f.cwd + ".selected"); await mkdir(f.cwd);
    await expect(f.supervisor.open(f.identity, f.selected)).rejects.toThrow("SESSION_DIRECTORY_DENIED");
    expect((await f.index.page({})).records[0]?.attempt).toEqual({ state: "failed", code: "SESSION_DIRECTORY_DENIED" });
    expect(f.supervisor.starts).toBe(0);
    expect(f.supervisor.exits()).toMatchObject([{ reason: "open-failed", drain: { status: "not-launched" } }]);
    expect(f.supervisor.exits()[0]?.drain.code).toBeUndefined();
    expect(f.supervisor.hasOwnedReservation).toBe(false);
  } finally { await f.close(); }
});

test("shared startup retains root UI and one generation when one waiting browser logs out", async () => {
  const f = await sourceFixture(), reached = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  try {
    const other = await f.browser(), originalStart = f.controls.start;
    f.controls.start = async () => {
      f.emit({ type: "extension_ui_request", id: "root-ui", method: "input", title: "Synthetic startup" });
      reached.resolve(); await release.promise; return originalStart();
    };
    const first = f.supervisor.open(f.identity, f.selected); void first.catch(() => {});
    await reached.promise;
    const second = f.supervisor.open(other.identity, f.selected);
    expect(f.supervisor.interactions(other.identity)?.pending[0]?.scope).toEqual({ kind: "startup" });
    const status = await f.authority.handle(new Request(f.origin + "/auth/status", { headers: { host: "127.0.0.1:4321", cookie: f.cookie } }));
    const { csrf } = z.object({ csrf: z.string() }).parse(await status!.json());
    const logout = await f.authority.handle(new Request(f.origin + "/auth/logout", { method: "POST", headers: {
      host: "127.0.0.1:4321", origin: f.origin, cookie: f.cookie, "x-omp-csrf": csrf } }));
    expect(logout?.status).toBe(204);
    const card = f.supervisor.interactions(other.identity)!.pending[0]!;
    expect(await f.supervisor.answer(other.identity, card.generation, card.id, { type: "value", value: "Synthetic answer" }))
      .toEqual({ status: "answered" });
    release.resolve();
    await expect(first).rejects.toThrow("SESSION_AUTH_REQUIRED");
    const view = await second, warm = await f.supervisor.open(other.identity, f.selected);
    expect(view.state).toBe("open"); expect(warm.workerId).toBe(view.workerId); expect(warm.generation).toBe(view.generation);
    expect(f.supervisor.starts).toBe(1); expect(f.supervisor.exits()).toEqual([]);
    expect(() => f.supervisor.view(f.identity, view.workerId)).toThrow("SESSION_AUTH_REQUIRED");
  } finally { release.resolve(); await f.close(); }
});

function pendingOwnedConnection() {
  const ready = Promise.withResolvers<Awaited<OwnedSessionConnection["ready"]>>();
  const completed = Promise.withResolvers<void>();
  const rootExit = Promise.withResolvers<Awaited<OwnedSessionConnection["rootExit"]>>();
  const output = Promise.withResolvers<Awaited<OwnedSessionConnection["output"]>>();
  const cutoffs: number[] = [];
  const connection: OwnedSessionConnection = {
    ready: ready.promise, rootExit: rootExit.promise, completed: completed.promise, output: output.promise,
    interactionCleanup: Promise.resolve([]),
    beginCleanup(cutoff) { cutoffs.push(cutoff); return undefined; },
  };
  for (const deferred of [ready, completed, rootExit, output]) void deferred.promise.catch(() => {});
  return { connection, ready, completed, rootExit, output, cutoffs };
}

test("reentrant retirement aborts the reserved owned launch and shares its unconfirmed rejection", async () => {
  const delivery = Promise.withResolvers<OwnedSessionConnection>();
  const reentered = Promise.withResolvers<{ aborted: boolean | undefined; shutdown: Promise<void> }>();
  let abortCount = 0, repeated: Promise<void> | undefined;
  const f = await sourceFixture(Date.now, (_cwd, signal): Promise<OwnedSessionConnection> => {
    signal?.addEventListener("abort", () => { ++abortCount; repeated = f.supervisor.close(); });
    const shutdown = f.supervisor.revokeAll();
    reentered.resolve({ aborted: signal?.aborted, shutdown });
    return delivery.promise;
  });
  const opening = f.supervisor.open(f.identity, f.selected);
  void opening.catch(() => {});
  try {
    const { aborted, shutdown } = await reentered.promise;
    expect(aborted).toBe(true);
    expect(abortCount).toBe(1);
    expect(f.supervisor.hasOwnedReservation).toBe(true);

    delivery.reject(new Error("HELPER_LAUNCH_RETIRED"));
    await expect(opening).rejects.toThrow("SESSION_OPEN_OUTCOME_UNKNOWN");
    await Promise.all([shutdown, repeated, f.supervisor.close()]);
    expect(abortCount).toBe(1);
    expect(f.supervisor.starts).toBe(1);
    expect(f.supervisor.hasOwnedReservation).toBe(true);
    expect(f.supervisor.exits()).toMatchObject([{ reason: "all-browser-access-revoked",
      drain: { status: "unresolved", failure: "SESSION_WORKER_LAUNCH_REJECTED_UNCONFIRMED" } }]);
  } finally {
    delivery.reject(new Error("SYNTHETIC_LAUNCH_REJECTED"));
    await opening.catch(() => {});
    await f.close();
  }
});

test("shutdown fences the retained connection while readiness is pending and waits for domain completion and both EOFs", async () => {
  const owned = pendingOwnedConnection();
  const launched: string[] = [];
  const cutoffsAtAbort: number[] = [];
  let retirement: AbortSignal | undefined;
  const f = await sourceFixture(Date.now, (cwd, signal) => {
    launched.push(cwd);
    retirement = signal;
    signal?.addEventListener("abort", () => { cutoffsAtAbort.push(...owned.cutoffs); });
    return owned.connection;
  });
  const clock = shutdownClock();
  const opening = f.supervisor.open(f.identity, f.selected);
  void opening.catch(() => {});
  try {
    await clock.advance(100);
    expect(launched).toEqual([f.cwd]);
    expect(retirement?.aborted).toBe(false);
    const shutdown = f.supervisor.close();
    expect(retirement?.aborted).toBe(true);
    expect(cutoffsAtAbort).toEqual([30_100]);
    expect(owned.cutoffs).toEqual([30_100]);
    expect(f.supervisor.starts).toBe(1);
    expect(f.supervisor.hasOwnedReservation).toBe(true);
    owned.ready.reject(new Error("RPC_SESSION_RETIRED"));
    owned.rootExit.resolve({ kind: "rootExit", generation: "owned-generation", exitCode: 0, signal: 0 });
    await clock.advance(150);
    expect(f.supervisor.exits()).toMatchObject([{ drain: {
      status: "owned-unresolved", domain: "pending", rootExit: { exitCode: 0, signal: 0 },
    } }]);
    expect(f.supervisor.hasOwnedReservation).toBe(true);
    owned.completed.resolve();
    await clock.advance(200);
    expect(f.supervisor.exits()).toMatchObject([{ drain: {
      status: "owned-unresolved", domain: "completed", rootExit: { exitCode: 0, signal: 0 },
    } }]);
    expect(f.supervisor.exits()[0]?.drain).not.toHaveProperty("output");
    expect(f.supervisor.hasOwnedReservation).toBe(true);
    owned.output.resolve({ stdoutEOF: true, stderrEOF: true, stderrBytes: 12, observedTailNotifications: 2 });
    await shutdown;
    await expect(opening).rejects.toThrow("SESSION_OPEN_OUTCOME_UNKNOWN");
    expect(f.supervisor.hasOwnedReservation).toBe(false);
    expect(f.supervisor.exits()).toMatchObject([{ reason: "host-shutdown", tailNotifications: 2,
      drain: { status: "owned-completed", rootExit: { exitCode: 0, signal: 0 },
        output: { stdoutEOF: true, stderrEOF: true } } }]);
    expect((await f.index.page({})).records[0]?.attempt).toEqual({
      state: "outcome_unknown", code: "SESSION_EXIT_OUTCOME_UNKNOWN",
    });
  } finally {
    owned.ready.reject(new Error("RPC_SESSION_RETIRED"));
    owned.completed.resolve();
    owned.output.resolve({ stdoutEOF: true, stderrEOF: true, stderrBytes: 0, observedTailNotifications: 0 });
    await opening.catch(() => {});
    await clock.advance(35_100);
    clock.restore();
    await f.close();
  }
});

test("a connection delivered after the shutdown observation is fenced with the original cutoff", async () => {
  const owned = pendingOwnedConnection(), delivery = Promise.withResolvers<OwnedSessionConnection>();
  let retirement: AbortSignal | undefined;
  const f = await sourceFixture(Date.now, (_cwd, signal) => { retirement = signal; return delivery.promise; });
  const clock = shutdownClock();
  const opening = f.supervisor.open(f.identity, f.selected);
  void opening.catch(() => {});
  try {
    await clock.advance(0);
    expect(retirement?.aborted).toBe(false);
    const shutdown = f.supervisor.close();
    expect(retirement?.aborted).toBe(true);
    await clock.advance(35_000);
    await shutdown;
    expect(f.supervisor.exits()).toMatchObject([{ reason: "host-shutdown",
      drain: { status: "unresolved", failure: "SESSION_WORKER_LAUNCH_UNRESOLVED" } }]);
    expect(f.supervisor.hasOwnedReservation).toBe(true);
    f.index.close();

    await clock.advance(40_000);
    delivery.resolve(owned.connection);
    await clock.advance(40_000);
    expect(owned.cutoffs).toEqual([30_000]);
    expect(retirement?.aborted).toBe(true);
    owned.ready.reject(new Error("RPC_STARTUP_FAILED"));
    await expect(opening).rejects.toThrow("SESSION_OPEN_OUTCOME_UNKNOWN");
    owned.rootExit.resolve({ kind: "rootExit", generation: "owned-generation", exitCode: 0, signal: 15 });
    owned.output.resolve({ stdoutEOF: true, stderrEOF: true, stderrBytes: 0, observedTailNotifications: 1 });
    await clock.advance(40_000);
    expect(f.supervisor.exits()).toMatchObject([{ reason: "host-shutdown", tailNotifications: 1, drain: {
      status: "owned-unresolved", domain: "pending", rootExit: { exitCode: 0, signal: 15 },
      output: { stdoutEOF: true, stderrEOF: true },
    } }]);
    expect(f.supervisor.hasOwnedReservation).toBe(true);

    owned.completed.resolve();
    await clock.advance(40_000);
    expect(f.supervisor.hasOwnedReservation).toBe(false);
    expect(f.supervisor.exits().at(-1)).toMatchObject({ reason: "host-shutdown", tailNotifications: 1, drain: {
      status: "owned-completed", rootExit: { exitCode: 0, signal: 15 },
    } });
    expect(f.supervisor.starts).toBe(1);
  } finally {
    delivery.resolve(owned.connection);
    owned.ready.reject(new Error("RPC_SESSION_RETIRED"));
    owned.completed.resolve();
    owned.output.resolve({ stdoutEOF: true, stderrEOF: true, stderrBytes: 0, observedTailNotifications: 0 });
    await opening.catch(() => {});
    await clock.advance(40_000);
    clock.restore();
    await f.close();
  }
});

test.each(["incomplete EOF", "failed domain", "failed output"] as const)("an owned launch with %s keeps the retired slot", async outcome => {
  const owned = pendingOwnedConnection();
  const f = await sourceFixture(Date.now, () => owned.connection);
  const opening = f.supervisor.open(f.identity, f.selected);
  void opening.catch(() => {});
  try {
    await new Promise<void>(resolve => setImmediate(resolve));
    owned.ready.reject(new Error("RPC_STARTUP_FAILED"));
    await expect(opening).rejects.toThrow("SESSION_OPEN_OUTCOME_UNKNOWN");
    const rootExit = { kind: "rootExit", generation: "owned-generation", exitCode: 0, signal: 0 } as const;
    if (outcome === "failed output") owned.rootExit.reject(new Error("PRIVATE_ROOT_EXIT_UNOBSERVED"));
    else owned.rootExit.resolve(rootExit);
    if (outcome === "failed domain") owned.completed.reject(new Error("PRIVATE_DOMAIN_UNRESOLVED"));
    else owned.completed.resolve();
    const output = { stdoutEOF: true, stderrEOF: outcome === "failed domain", stderrBytes: 0, observedTailNotifications: 0 };
    if (outcome === "failed output") owned.output.reject(new Error("RPC_PIPE_ATTACH_FAILED"));
    else owned.output.resolve(output);
    await new Promise<void>(resolve => setImmediate(resolve));
    await expect(f.supervisor.open(f.identity, f.selected)).rejects.toThrow("SESSION_WORKER_DRAINING");
    expect(f.supervisor.starts).toBe(1);
    expect(f.supervisor.hasOwnedReservation).toBe(true);
    expect(f.supervisor.exits()).toMatchObject([{ reason: "open-failed", drain: {
      status: "owned-unresolved", domain: outcome === "failed domain" ? "unresolved" : "completed",
      ...(outcome === "failed output" ? { rootExitUnobserved: true, outputUnavailable: true }
        : { rootExit: { exitCode: 0, signal: 0 }, output }),
    } }]);
  } finally {
    owned.ready.reject(new Error("RPC_SESSION_RETIRED"));
    owned.completed.resolve();
    owned.output.resolve({ stdoutEOF: true, stderrEOF: true, stderrBytes: 0, observedTailNotifications: 0 });
    await opening.catch(() => {});
    await f.close();
  }
});
