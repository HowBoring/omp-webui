import { expect, test } from "bun:test";
import { z } from "zod";
import { rm, rename, mkdir } from "node:fs/promises";
import { sourceFixture } from "./source-fixture.ts";

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

test.each(["incomplete", "rejected"])("a lost worker remains owned after a %s drain", async outcome => {
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

    f.controls.drain = { ...drain, stderrEOF: true };
    await f.supervisor.close();
    expect(f.supervisor.exits().at(-1)).toMatchObject({
      workerId: opened.workerId, reason: "host-shutdown", drain: f.controls.drain,
    });
  } finally { completion.resolve(drain); await f.close(); }
});

test("zero exit with a failed final protocol tail persists an unknown shutdown outcome", async () => {
  const f = await sourceFixture();
  try {
    const opened = await f.supervisor.open(f.identity, f.selected);
    f.controls.drain = { code: 0, forced: false, stderrBytes: 0, protocolFailure: "RPC_PROTOCOL" };
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
