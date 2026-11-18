import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startSessionComponentServer } from "../../apps/host/src/session-component-server.ts";
import { CatalogClient } from "../../packages/contracts/generated/catalog-client.ts";
import type { CatalogDescriptor } from "../../packages/contracts/generated/omp-wire.ts";

test("the isolated Session carrier lists the durable registration from an explicit refused Open", async () => {
  const home = await mkdtemp(join(tmpdir(), "workspace-session-index-")), dataDir = join(home, "state");
  const now = "2026-01-01T00:00:00Z";
  const item: CatalogDescriptor = { reference: "opaque-reference", sourceId: "source", instanceId: "instance",
    nativeSessionId: "native", title: "Cached title", cwd: { status: "unknown" }, aliases: [],
    createdAt: now, modifiedAt: now, observedAt: now, ownership: { state: "free", observedAt: now } };
  const catalog = new CatalogClient(async command => {
    if (command.type === "catalog_page") return { status: "complete", snapshot: "synthetic", observedAt: now,
      expiresAt: "2099-01-01T00:00:00Z", examined: 1, failures: [], items: [item] };
    if (command.type === "describe_session" && command.reference === item.reference) return { status: "verified", observedAt: now,
      item: { ...item, instanceId: "replacement", title: "Unrelated title", ownership: { state: "held", observedAt: now } } };
    throw new Error("UNEXPECTED_PUBLIC_RPC");
  });
  const host = await startSessionComponentServer({ catalog, dataDir, port: 0,
    manifest: join(home, "absent-manifest"), launcher: join(home, "absent-launcher"),
    async launch() { throw new Error("UNEXPECTED_NATIVE_LAUNCH"); } });
  try {
    const origin = host.server.url.origin;
    const exchange = await fetch(host.bootstrapLink(), { redirect: "manual" });
    const cookie = exchange.headers.get("set-cookie")!.split(";")[0]!;
    const { csrf } = await (await fetch(`${origin}/auth/status`, { headers: { cookie } })).json() as { csrf: string };
    const headers = { cookie, origin, "x-omp-csrf": csrf, "content-type": "application/json" };
    const call = (method: string, args: object) => fetch(`${origin}/api/${method}`, { method: "POST", headers,
      body: JSON.stringify({ type: "client-request", rpcId: "index-fixture", method, payload: { args } }) });
    const catalogReply = await (await call("ompSessions/catalog", { options: {} })).json() as {
      result: { value: { choices: { selectionId: string }[] } };
    };
    const firstPage = await call("ompWorkspaces/registered", { options: {} });
    expect(firstPage.status).toBe(200);
    expect(await firstPage.json()).toMatchObject({
      rpcId: "index-fixture", result: { ok: true, value: { items: [] } } });
    const { selectionId } = catalogReply.result.value.choices[0]!;
    expect(await (await call("ompSessions/open", { selectionId })).json()).toMatchObject({
      result: { ok: false, error: { code: "SESSION_CWD_UNKNOWN" } } });
    expect(await (await call("ompWorkspaces/registered", { options: {} })).json()).toMatchObject({
      rpcId: "index-fixture", result: { ok: true, value: { items: [{ nativeSessionId: "native", nativeStatus: "replaced",
        title: "Cached title", directory: { status: "unknown" }, ownership: { state: "unknown" },
        admission: "blocked_pending_41_44" }] } },
    });
    expect((await call("ompWorkspaces/page", { options: {} })).status).toBe(501);
  } finally { await host.stop(); await rm(home, { recursive: true, force: true }); }
});
