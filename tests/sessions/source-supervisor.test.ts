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

test("Open during pending idle retirement retains its prelaunch reason", async () => {
  const f = await sourceFixture(), completion = Promise.withResolvers<import("../../packages/compatibility/stdio-transport.ts").DrainResult>();
  try {
    await f.supervisor.open(f.identity, f.selected);
    f.controls.retirement = { status: "pending", completion: completion.promise, stdoutEOF: false, stderrEOF: false };
    await expect(f.supervisor.create(f.identity, f.cwd)).rejects.toThrow("SESSION_IDLE_EXIT_UNCONFIRMED_PENDING_48");
    await expect(f.supervisor.open(f.identity, f.selected)).rejects.toThrow("SESSION_WORKER_DRAINING");
    expect((await f.index.page({})).records[0]?.attempt).toEqual({ state: "failed", code: "SESSION_WORKER_DRAINING" });
    expect(f.supervisor.starts).toBe(1);
  } finally { completion.resolve(f.controls.drain); await f.close(); }
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
