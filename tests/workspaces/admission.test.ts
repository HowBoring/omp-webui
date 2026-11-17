import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startWorkspaceComponentServer } from "../../apps/host/src/workspace-component-server.ts";
import { CatalogClient } from "../../packages/contracts/generated/catalog-client.ts";

// Complementary real HTTP/DSH envelope boundary fault test; catalog is an explicit public RPC fault fixture.
test("credential revocation during a pending confirmation body prevents mutation and forged source arguments are refused", async () => {
  const home = await mkdtemp(join(tmpdir(), "omp-workspace-admit-"));
  const root = join(home, "project"); await mkdir(root);
  const host = await startWorkspaceComponentServer({ dataDir: join(home, "state"), port: 0,
    manifest: join(home, "absent-manifest"), launcher: join(home, "absent-launcher"),
    catalog: new CatalogClient(async () => { throw new Error("PUBLIC_RPC_FAULT_FIXTURE_NO_NATIVE_READS"); }) });
  const origin = host.server.url.origin;
  async function login() {
    const exchange = await fetch(host.bootstrapLink(), { redirect: "manual" });
    const cookie = exchange.headers.get("set-cookie")!.split(";")[0]!;
    const response = await fetch(`${origin}/auth/status`, { headers: { cookie } });
    const status = await response.json() as { csrf: string };
    return { cookie, csrf: status.csrf };
  }
  function call(method: string, args: Record<string, unknown>, browser: { cookie: string; csrf: string }) {
    return fetch(`${origin}/api/ompWorkspaces/${method}`, { method: "POST", headers: { cookie: browser.cookie,
      origin, "x-omp-csrf": browser.csrf, "content-type": "application/json" }, body: JSON.stringify({
      type: "client-request", rpcId: "admission-fixture", method: `ompWorkspaces/${method}`, payload: { args },
    }) });
  }
  try {
    const first = await login(), other = await login();
    const preview = await (await call("preview", { path: root }, first)).json() as {
      result: { value: { confirmation: string } };
    };
    const tail = Promise.withResolvers<void>();
    const body = new ReadableStream<Uint8Array>({ async start(controller) {
      controller.enqueue(new TextEncoder().encode('{"type":"client-request",'));
      await tail.promise;
      controller.enqueue(new TextEncoder().encode(JSON.stringify({ rpcId: "pending", method: "ompWorkspaces/confirm",
        payload: { args: { confirmation: preview.result.value.confirmation } } }).slice(1)));
      controller.close();
    } });
    const pending = fetch(`${origin}/api/ompWorkspaces/confirm`, { method: "POST", headers: {
      cookie: first.cookie, origin, "x-omp-csrf": first.csrf, "content-type": "application/json",
    }, body });
    const logout = await fetch(`${origin}/auth/logout`, { method: "POST", headers: {
      cookie: first.cookie, origin, "x-omp-csrf": first.csrf,
    } });
    expect(logout.status).toBe(204); tail.resolve();
    expect((await pending).status).toBe(401);
    const listed = await (await call("grants", {}, other)).json() as { result: { value: unknown[] } };
    expect(listed.result.value).toEqual([]);
    expect((await call("preview", { path: root, sources: ["/"] }, other)).status).toBe(400);
    const missing = await call("preview", { path: join(home, "missing") }, other);
    expect(missing.status).toBe(200);
    expect(await missing.json()).toMatchObject({ rpcId: "admission-fixture",
      result: { ok: false, error: { code: "ENOENT", details: {} } } });
    expect((await fetch(`${origin}/api/session/open`, { headers: { cookie: other.cookie } })).status).toBe(501);
  } finally { await host.stop(); await rm(home, { recursive: true, force: true }); }
});
