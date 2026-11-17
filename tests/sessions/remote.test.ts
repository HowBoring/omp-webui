/** Actual HTTP + typed DSH Remote + real native catalog/worker; held native-description latency is a public boundary fixture. */
import { expect, test, setSystemTime } from "bun:test";
import { Context } from "@deepseek-ai/cordis";
import { installConnection } from "@deepseek-ai/dsh-client-connection/client";
import { apply as registry } from "@deepseek-ai/dsh-typert-registry/client";
import { apply as gateway } from "@deepseek-ai/dsh-api-gateway/client";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startSessionComponentServer } from "../../apps/host/src/session-component-server.ts";
import { sessionsContribution } from "../../packages/contracts/sessions.ts";
import { CatalogClient } from "../../packages/contracts/generated/catalog-client.ts";
import { nativeFixture } from "../catalog/fixture.ts";
import { catalog, launch } from "./worker.ts";

test("credential withdrawal after native lookup blocks startup; a different browser can read the retained failure", async () => {
  const home = await mkdtemp(join(tmpdir(), "session-http-")); await nativeFixture(home);
  const discovery = await catalog(home), reached = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const native = new CatalogClient(async command => {
    if (command.type === "describe_session") { reached.resolve(); await release.promise; return discovery.catalog.describe(command.reference); }
    if (command.type === "catalog_page") return discovery.catalog.page(command);
    return discovery.catalog.sources();
  });
  const host = await startSessionComponentServer({ dataDir: join(home, "state"), port: 0, catalog: native,
    manifest: join(home, "missing-manifest"), launcher: join(home, "missing-launcher"), launch: cwd => launch(home, cwd) });
  const origin = host.server.url.origin;
  const client = async () => {
    const exchange = await fetch(host.bootstrapLink(), { redirect: "manual" });
    const cookie = exchange.headers.get("set-cookie")!.split(";")[0]!;
    const csrf = (await (await fetch(origin + "/auth/status", { headers: { cookie } })).json()).csrf as string;
    const ctx = new Context();
    installConnection(ctx, { interactions: "none", transport: { fetch: (url, init) => fetch(new URL(url, origin), {
      ...init, headers: { cookie, origin, "x-omp-csrf": csrf, "content-type": "application/json" } }), openStream: async function* () {} } });
    registry(ctx); gateway(ctx); await ctx.remote.$mount(sessionsContribution); return { ctx, cookie, csrf };
  };
  const first = await client(), other = await client();
  try {
    const preview = await first.ctx.remote.ompSessions.preview(join(home, "project")); if (!preview.ok) throw preview.error;
    expect((await first.ctx.remote.ompSessions.confirm(preview.value.confirmation)).ok).toBe(true);
    const page = await first.ctx.remote.ompSessions.catalog({}); if (!page.ok) throw page.error;
    expect(JSON.stringify(page.value)).not.toContain("reference");
    const opening = first.ctx.remote.ompSessions.open(page.value.choices[0]!.selectionId);
    await reached.promise;
    expect((await fetch(origin + "/auth/logout", { method: "POST", headers: { cookie: first.cookie, origin, "x-omp-csrf": first.csrf } })).status).toBe(204);
    release.resolve(); expect((await opening).ok).toBe(false); expect(host.supervisor.starts).toBe(0);
    const registered = await other.ctx.remote.ompSessions.index({});
    expect(registered).toMatchObject({ ok: true, value: { records: [{ nativeSessionId: "native-0000",
      attempt: { state: "failed", code: "SESSION_AUTH_REQUIRED" } }] } });
    const forged = await fetch(origin + "/api/ompSessions/open", { method: "POST", headers: { cookie: other.cookie, origin,
      "x-omp-csrf": other.csrf, "content-type": "application/json" }, body: JSON.stringify({ type: "client-request", rpcId: "forged",
      method: "ompSessions/open", payload: { args: { selectionId: page.value.choices[0]!.selectionId, argv: ["/bin/sh"] } } }) });
    expect(forged.status).toBe(400); expect(host.supervisor.starts).toBe(0);
    setSystemTime(Date.now() + 61_000);
    expect((await other.ctx.remote.ompSessions.open(page.value.choices[0]!.selectionId)).ok).toBe(false);
    const expired = await other.ctx.remote.ompSessions.index({});
    expect(expired).toMatchObject({ ok: true, value: { records: [{ attempt: { state: "failed", code: "SESSION_SELECTION_EXPIRED" } }] } });
    expect(host.supervisor.starts).toBe(0); setSystemTime();
  } finally {
    setSystemTime(); release.resolve(); await first.ctx.fiber.dispose(); await other.ctx.fiber.dispose(); await host.stop(); await discovery.close(); await rm(home, { recursive: true, force: true });
  }
}, 30_000);
