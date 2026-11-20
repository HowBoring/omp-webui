import { expect, test } from "bun:test";
import { mkdtemp, rm, rename, mkdir, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openBrowserAccess } from "../../packages/access/index.ts";
import { DirectoryGrants } from "../../packages/workspaces/grants.ts";
import { SessionIndex } from "../../packages/sessions/index.ts";
import { SessionSupervisor } from "../../packages/sessions/supervisor.ts";
import { nativeFixture } from "../catalog/fixture.ts";
import { SessionWorker } from "../../packages/compatibility/session-worker.ts";
import { resolve } from "node:path";
import { catalog, launch, selection } from "./worker.ts";
async function fixture(startup = false, workerFactory: typeof launch = launch) {
  const home = await mkdtemp(join(tmpdir(), "session-supervisor-")); await nativeFixture(home, 2);
  const cwd = join(home, "project"), dataDir = join(home, "host"), origin = "http://127.0.0.1:4321";
  const authority = openBrowserAccess({ dataDir, origin }), grants = new DirectoryGrants(dataDir), index = new SessionIndex(dataDir);
  const grant = grants.confirm(grants.preview(cwd).confirmation), discovery = await catalog(home);
  const selected = (await discovery.catalog.page()).items[0]!;
  const exchange = await authority.handle(new Request(authority.bootstrapLink(), { headers: { host: "127.0.0.1:4321" } }));
  const cookie = exchange!.headers.get("set-cookie")!.split(";")[0]!;
  const identity = authority.admit(new Request(origin + "/api/sessions", { headers: { host: "127.0.0.1:4321", cookie } }), "read");
  if (identity instanceof Response) throw new Error("synthetic authentication failed");
  const supervisor = new SessionSupervisor({ authority, grants, index, catalog: discovery.catalog, launch: directory => workerFactory(home, directory, startup) });
  authority.onRevokeAll(() => { void supervisor.revokeAll().catch(() => {}); });
  return { home, cwd, dataDir, origin, cookie, authority, grants, index, discovery, identity, selected, supervisor, grant,
    async close() { await supervisor.close(); await discovery.close(); authority.close(); grants.close(); index.close(); await rm(home, { recursive: true, force: true }); } };
}

test("simultaneous explicit opens and warm views share one actual native worker", async () => {
  const f = await fixture();
  try {
    const [first, second] = await Promise.all([f.supervisor.open(f.identity, f.selected), f.supervisor.open(f.identity, f.selected)]);
    expect(first).toMatchObject({ state: "open", registration: { nativeSessionId: "native-0000", instanceId: f.selected.instanceId } });
    expect(second.workerId).toBe(first.workerId); expect(f.supervisor.starts).toBe(1);
    expect(f.supervisor.view(f.identity, first.workerId).generation).toBe(first.generation);
    expect((await f.index.page({})).records).toHaveLength(1);
    await f.supervisor.close();
    expect(f.supervisor.exits()[0]).toMatchObject({ nativeSettled: true, queuedInputsWithdrawn: true, uiCancelled: true,
      drain: { code: 0, forced: false, stdoutEOF: true, stderrEOF: true } });
  } finally { await f.close(); }
}, 30_000);

test("revoking one overlapping root preserves the worker; revoking effective access denies then reaps it", async () => {
  const f = await fixture();
  try {
    const broader = f.grants.confirm(f.grants.preview(f.home).confirmation);
    const opened = await f.supervisor.open(f.identity, f.selected);
    f.grants.revoke(f.grant.id); await f.supervisor.permissionsChanged();
    expect(f.supervisor.view(f.identity, opened.workerId).state).toBe("open");
    f.grants.revoke(broader.id);
    expect(() => f.supervisor.view(f.identity, opened.workerId)).toThrow("SESSION_DIRECTORY_DENIED");
    await f.supervisor.permissionsChanged();
    expect(f.supervisor.exits()[0]).toMatchObject({ reason: "directory-revoked", drain: { code: 0, forced: false } });
  } finally { await f.close(); }
}, 30_000);

for (const reason of ["directory-revoked", "all-browser-access-revoked", "host-shutdown"] as const)
for (const mode of ["cooperative", "stubborn"] as const) test(`real busy native ${mode} ${reason} obeys one 30+5 deadline and records actual exit`, async () => {
  let actual: SessionWorker | undefined;
  const f = await fixture(false, async (home, cwd) => {
    const selected = selection(home, cwd);
    const filtered: string[] = [];
    for (let index = 0; index < selected.argv.length; index++) {
      const arg = selected.argv[index]!;
      if (arg === "--provider" || arg === "--model") { index++; continue; }
      if (arg !== "--no-extensions" && arg !== "--no-tools") filtered.push(arg);
    }
    selected.argv = filtered;
    selected.argv.push("--model", "s1-controlled/busy", "--trusted-extension", resolve("tests/sessions/busy-provider.ts"));
    Object.assign(selected.env, { OMP_SESSION_BUSY: mode });
    actual = await SessionWorker.open(selected); return actual;
  });
  try {
    await f.supervisor.open(f.identity, f.selected);
    await Bun.write(join(f.home, "start-busy-fixture"), "synthetic controlled start after final native binding");
    for (let attempt = 0; attempt < 200; attempt++) {
      const busy = (await actual!.state()).isStreaming === true;
      const audit = Bun.file(join(f.home, "busy-fixture-audit.json"));
      if (busy && (mode === "cooperative" || (await audit.exists() && (await audit.json()).toolStarted === true))) break;
      if (attempt === 199) throw new Error("SYNTHETIC_BUSY_NOT_OBSERVED"); await Bun.sleep(10);
    }
    const warm = await f.supervisor.open(f.identity, f.selected);
    expect(f.supervisor.view(f.identity, warm.workerId).workerId).toBe(warm.workerId);
    await expect(f.supervisor.create(f.identity, f.cwd)).rejects.toThrow("SESSION_WORKER_BUSY_STOP_REQUIRED");
    const other = (await f.discovery.catalog.page()).items.find(item => item.nativeSessionId === "native-0001")!;
    await expect(f.supervisor.switchTo(f.identity, other)).rejects.toThrow("SESSION_WORKER_BUSY_STOP_REQUIRED");
    expect(f.supervisor.starts).toBe(1);
    const start = performance.now(), revokedAt = Date.now();
    if (reason === "directory-revoked") { f.grants.revoke(f.grant.id); await f.supervisor.permissionsChanged(); }
    else if (reason === "all-browser-access-revoked") { f.authority.revokeAll(); await f.supervisor.revokeAll(); }
    else await f.supervisor.close();
    const elapsed = performance.now() - start, exit = f.supervisor.exits()[0]!;
    const audit = await Bun.file(join(f.home, "busy-fixture-audit.json")).json();
    expect(audit).toMatchObject({ calls: 1, abortObserved: true, actualNetworkDispatches: 0 });
    expect(exit).toMatchObject({ reason, nativeSettled: mode === "cooperative",
      drain: { forced: mode === "stubborn", stdoutEOF: true, stderrEOF: true } });
    if (mode === "stubborn") {
      expect(elapsed).toBeGreaterThanOrEqual(34_900); expect(elapsed).toBeLessThan(37_000);
      expect(exit.drain).toMatchObject({ terminationSent: true, forceSent: true });
      expect(audit.termObserved).toBe(true); expect(audit.termAt - revokedAt).toBeGreaterThanOrEqual(29_900);
      expect(audit.termAt - revokedAt).toBeLessThan(32_000);
    } else expect(elapsed).toBeLessThan(5000);
    console.info(JSON.stringify({ scenario: `native-${mode}-${reason}`, exit, audit }));
  } finally { await f.close(); }
}, 65_000);

test("an occupied existing native writer retains the registered reason without launching a replacement Session", async () => {
  const f = await fixture(), external = await launch(f.home, f.cwd);
  try {
    await external.startup.start({ intent: "continue", expectedCwd: f.cwd, reference: f.selected.reference });
    await expect(f.supervisor.open(f.identity, f.selected)).rejects.toThrow("SESSION_EXTERNAL_OWNER");
    expect(f.supervisor.starts).toBe(0);
    expect((await f.index.page({})).records[0]?.attempt).toEqual({ state: "failed", code: "SESSION_EXTERNAL_OWNER" });
    await external.close({ cooperativeMs: 1000, terminationGraceMs: 500, readerGraceMs: 500 });
    const reopened = await f.supervisor.open(f.identity, f.selected);
    expect(reopened.registration.nativeSessionId).toBe("native-0000"); expect(f.supervisor.starts).toBe(1);
  } finally { await external.close({ cooperativeMs: 1000, terminationGraceMs: 500, readerGraceMs: 500 }); await f.close(); }
}, 30_000);

test("lost strict-start reply is unknown until manual observation recovers the same native identity without replay", async () => {
  const f = await fixture(true, (home, cwd, startup) => SessionWorker.open(selection(home, cwd, startup), { startTimeoutMs: 30 }));
  try {
    await expect(f.supervisor.open(f.identity, f.selected)).rejects.toThrow("RPC_REQUEST_TIMEOUT");
    expect((await f.index.page({})).records[0]?.attempt.state).toBe("outcome_unknown");
    let pending = f.supervisor.interactions(f.identity)?.pending ?? [];
    for (let attempt = 0; pending.length === 0 && attempt < 1500; attempt++) {
      await Bun.sleep(10); pending = f.supervisor.interactions(f.identity)?.pending ?? [];
    }
    expect(pending[0]?.scope).toEqual({ kind: "startup" });
    await f.supervisor.answer(f.identity, pending[0]!.generation, pending[0]!.id, { type: "value", value: "Manual observation fixture" });
    let observed;
    for (let attempt = 0; attempt < 100; attempt++) {
      try { observed = await f.supervisor.recheck(f.identity); break; } catch { await Bun.sleep(20); }
    }
    expect(observed).toMatchObject({ state: "open", registration: { nativeSessionId: "native-0000" } });
    expect(f.supervisor.starts).toBe(1);
  } finally { await f.close(); }
}, 30_000);

test("explicit New retires a confirmed idle worker and confirms a distinct identity; Switch returns to the original", async () => {
  const f = await fixture();
  try {
    const original = await f.supervisor.open(f.identity, f.selected);
    expect(f.supervisor.view(f.identity, original.workerId).workerId).toBe(original.workerId);
    expect(f.supervisor.starts).toBe(1);
    const created = await f.supervisor.create(f.identity, f.cwd);
    expect(created.registration.nativeSessionId).not.toBe(original.registration.nativeSessionId);
    expect(created.registration.instanceId).not.toBe(original.registration.instanceId);
    expect(f.supervisor.starts).toBe(2);
    expect(f.supervisor.exits()[0]).toMatchObject({ reason: "explicit-new", nativeSettled: true, drain: { code: 0, forced: false } });
    expect((await f.supervisor.switchTo(f.identity, f.selected)).registration.nativeSessionId).toBe("native-0000");
    expect(f.supervisor.starts).toBe(3);
  } finally { await f.close(); }
}, 45_000);

test("logout removes that browser's view and answer permission while another valid browser keeps the worker", async () => {
  const f = await fixture();
  try {
    const opened = await f.supervisor.open(f.identity, f.selected);
    const exchange = await f.authority.handle(new Request(f.authority.bootstrapLink(), { headers: { host: "127.0.0.1:4321" } }));
    const cookie = exchange!.headers.get("set-cookie")!.split(";")[0]!;
    const other = f.authority.admit(new Request(f.origin, { headers: { host: "127.0.0.1:4321", cookie } }), "read");
    if (other instanceof Response) throw new Error("synthetic second login failed");
    const status = await f.authority.handle(new Request(f.origin + "/auth/status", { headers: { host: "127.0.0.1:4321", cookie: f.cookie } }));
    const csrf = (await status!.json()).csrf;
    const loggedOut = await f.authority.handle(new Request(f.origin + "/auth/logout", { method: "POST", headers: {
      host: "127.0.0.1:4321", origin: f.origin, cookie: f.cookie, "x-omp-csrf": csrf } }));
    expect(loggedOut!.status).toBe(204);
    expect(() => f.supervisor.view(f.identity, opened.workerId)).toThrow("SESSION_AUTH_REQUIRED");
    expect(f.supervisor.view(other, opened.workerId).workerId).toBe(opened.workerId);
    expect(f.supervisor.exits()).toHaveLength(0); expect(f.supervisor.starts).toBe(1);
  } finally { await f.close(); }
}, 30_000);


test("replaced native instance retains the selected identity and failure without any worker or sibling", async () => {
  const f = await fixture();
  try {
    const file = join(f.home, ".omp/agent/sessions/bucket/native-0000.jsonl");
    await rename(file, file + ".selected"); await copyFile(file + ".selected", file);
    await expect(f.supervisor.open(f.identity, f.selected)).rejects.toThrow("SESSION_NATIVE_REPLACED");
    expect(f.supervisor.starts).toBe(0);
    expect((await f.index.page({})).records[0]).toMatchObject({ nativeSessionId: "native-0000", instanceId: f.selected.instanceId,
      attempt: { state: "failed", code: "SESSION_NATIVE_REPLACED" } });
  } finally { await f.close(); }
}, 30_000);

test("replacing the actual cwd under an overlapping parent grant immediately denies the surviving worker", async () => {
  const f = await fixture();
  try {
    f.grants.confirm(f.grants.preview(f.home).confirmation);
    const opened = await f.supervisor.open(f.identity, f.selected);
    await rename(f.cwd, f.cwd + ".selected"); await mkdir(f.cwd);
    expect(() => f.supervisor.view(f.identity, opened.workerId)).toThrow("SESSION_CWD_CHANGED");
    await f.supervisor.permissionsChanged();
    expect(f.supervisor.exits()[0]?.reason).toBe("directory-revoked");
  } finally { await f.close(); }
}, 30_000);

test("repeated Open rechecks native ownership and makes an active instance replacement explicit without a second worker", async () => {
  const f = await fixture();
  try {
    await f.supervisor.open(f.identity, f.selected);
    const file = join(f.home, ".omp/agent/sessions/bucket/native-0000.jsonl");
    await rename(file, file + ".selected"); await copyFile(file + ".selected", file);
    await expect(f.supervisor.open(f.identity, f.selected)).rejects.toThrow();
    expect((await f.index.page({})).records[0]).toMatchObject({ instanceId: f.selected.instanceId,
      nativeSessionId: "native-0000", attempt: { state: "outcome_unknown" } });
    expect(f.supervisor.starts).toBe(1);
  } finally { await f.close(); }
}, 30_000);

test("logout during admitted native startup withdraws that browser while another browser can finish the same worker", async () => {
  const f = await fixture(true);
  try {
    const opening = f.supervisor.open(f.identity, f.selected);
    void opening.catch(() => {});
    let pending = f.supervisor.interactions(f.identity)?.pending ?? [];
    for (let attempt = 0; pending.length === 0 && attempt < 1500; attempt++) {
      await Bun.sleep(10); pending = f.supervisor.interactions(f.identity)?.pending ?? [];
    }
    expect(pending[0]?.scope).toEqual({ kind: "startup" });
    const exchange = await f.authority.handle(new Request(f.authority.bootstrapLink(), { headers: { host: "127.0.0.1:4321" } }));
    const cookie = exchange!.headers.get("set-cookie")!.split(";")[0]!;
    const other = f.authority.admit(new Request(f.origin, { headers: { host: "127.0.0.1:4321", cookie } }), "read");
    if (other instanceof Response) throw new Error("synthetic second login failed");
    const status = await f.authority.handle(new Request(f.origin + "/auth/status", { headers: { host: "127.0.0.1:4321", cookie: f.cookie } }));
    const csrf = (await status!.json()).csrf;
    await f.authority.handle(new Request(f.origin + "/auth/logout", { method: "POST", headers: {
      host: "127.0.0.1:4321", origin: f.origin, cookie: f.cookie, "x-omp-csrf": csrf } }));
    await f.supervisor.answer(other, pending[0]!.generation, pending[0]!.id, { type: "value", value: "Other authorized browser" });
    await expect(opening).rejects.toThrow("SESSION_AUTH_REQUIRED");
    expect(await f.supervisor.recheck(other)).toMatchObject({ state: "open", registration: { nativeSessionId: "native-0000" } });
    expect(f.supervisor.exits()).toHaveLength(0); expect(f.supervisor.starts).toBe(1);
  } finally { await f.close(); }
}, 30_000);

test("root revocation cancels genuine unbound startup UI and retains an honest unpublished open outcome", async () => {
  const f = await fixture(true);
  try {
    const opening = f.supervisor.open(f.identity, f.selected); void opening.catch(() => {});
    let pending = f.supervisor.interactions(f.identity)?.pending ?? [];
    for (let attempt = 0; pending.length === 0 && attempt < 1500; attempt++) {
      await Bun.sleep(10); pending = f.supervisor.interactions(f.identity)?.pending ?? [];
    }
    expect(pending[0]?.scope).toEqual({ kind: "startup" });
    f.grants.revoke(f.grant.id); await f.supervisor.permissionsChanged();
    await expect(opening).rejects.toThrow("SESSION_OPEN_RETIRED_OUTCOME_UNKNOWN");
    expect((await f.index.page({})).records[0]).toMatchObject({ nativeSessionId: "native-0000", attempt: { state: "outcome_unknown" } });
    expect(f.supervisor.exits()[0]).toMatchObject({ reason: "directory-revoked", uiCancelled: true,
      drain: { forced: false, stdoutEOF: true, stderrEOF: true } });
    const code = f.supervisor.exits()[0]?.drain.code;
    expect(code === 0 || code === 1).toBe(true);
  } finally { await f.close(); }
}, 45_000);

test("real public Stop commands withdraw busy native work and reach joint quiescence", async () => {
  let actual: SessionWorker | undefined;
  const f = await fixture(false, async (home, cwd) => {
    const selected = selection(home, cwd);
    const filtered: string[] = [];
    for (let index = 0; index < selected.argv.length; index++) {
      const arg = selected.argv[index]!;
      if (arg === "--provider" || arg === "--model") { index++; continue; }
      if (arg !== "--no-extensions" && arg !== "--no-tools") filtered.push(arg);
    }
    selected.argv = filtered;
    selected.argv.push("--model", "s1-controlled/busy", "--trusted-extension", resolve("tests/sessions/busy-provider.ts"));
    Object.assign(selected.env, { OMP_SESSION_BUSY: "cooperative" });
    actual = await SessionWorker.open(selected); return actual;
  });
  try {
    await f.supervisor.open(f.identity, f.selected);
    await Bun.write(join(f.home, "start-busy-fixture"), "synthetic controlled start after final native binding");
    for (let attempt = 0; attempt < 200; attempt++) {
      if ((await actual!.state()).isStreaming === true) break;
      if (attempt === 199) throw new Error("SYNTHETIC_BUSY_NOT_OBSERVED"); await Bun.sleep(10);
    }
    const mark = f.supervisor.exits().length;
    expect(await actual!.control("abort_branch_summary")).toBeUndefined();
    expect(await actual!.control("abort_and_restore_queue")).toMatchObject({ steering: [], followUp: [] });
    for (let attempt = 0; attempt < 200; attempt++) {
      const state = await actual!.state();
      if (state.isSettled === true && state.isStreaming !== true) {
        expect(state).toMatchObject({ queuedMessageCount: 0, queuedMessages: { steering: [], followUp: [] } });
        break;
      }
      if (attempt === 199) throw new Error("NATIVE_STOP_NOT_SETTLED"); await Bun.sleep(10);
    }
    await f.supervisor.close();
    expect(f.supervisor.exits()[mark]).toMatchObject({ nativeSettled: true, drain: { code: 0, forced: false } });
  } finally { await f.close(); }
}, 45_000);
