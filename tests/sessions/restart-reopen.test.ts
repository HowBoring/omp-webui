/**
 * Actual Host restart over the real native fixture: the previous Host observed the worker exit as
 * unconfirmed, the new Host keeps that attempt and refuses reads with the typed manual-open marker,
 * and only an explicit public Open starts a new worker whose follow carries the real native history.
 */
import { expect, test } from "bun:test";
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
import { SessionIndex } from "../../packages/sessions/index.ts";
import { nativeFixture } from "../catalog/fixture.ts";
import { catalog, launch } from "./worker.ts";

test("an unconfirmed attempt reopens only after an explicit Open and then carries real history", async () => {
  const home = await mkdtemp(join(tmpdir(), "session-restart-reopen-")); await nativeFixture(home);
  const discovery = await catalog(home);
  const native = new CatalogClient(async command => {
    if (command.type === "describe_session") return discovery.catalog.describe(command.reference);
    if (command.type === "catalog_page") return discovery.catalog.page(command);
    return discovery.catalog.sources();
  });
  const start = () => startSessionComponentServer({ dataDir: join(home, "state"), port: 0, catalog: native,
    manifest: join(home, "missing-manifest"), launcher: join(home, "missing-launcher"), launch: cwd => launch(home, cwd) });
  const client = async (host: Awaited<ReturnType<typeof start>>) => {
    const origin = host.server.url.origin;
    const exchange = await fetch(host.bootstrapLink(), { redirect: "manual" });
    const cookie = exchange.headers.get("set-cookie")!.split(";")[0]!;
    const csrf = (await (await fetch(origin + "/auth/status", { headers: { cookie } })).json()).csrf as string;
    const ctx = new Context();
    installConnection(ctx, { interactions: "none", transport: { fetch: (url, init) => fetch(new URL(url, origin), {
      ...init, headers: { cookie, origin, "x-omp-csrf": csrf, "content-type": "application/json" } }), openStream: async function* () {} } });
    registry(ctx); gateway(ctx); await ctx.remote.$mount(sessionsContribution);
    return { ctx, origin, cookie, csrf };
  };
  const follow = async (host: Awaited<ReturnType<typeof start>>, cookie: string, sessionId: string) => {
    const url = new URL("api/remote.mux", host.server.url.href); url.protocol = "ws:";
    const socket = new WebSocket(url.href, { headers: { cookie, origin: host.server.url.origin } } as unknown as string[]);
    const frames: { type: string; streamId: string; value?: unknown; error?: { code: string; message: string } }[] = [];
    socket.addEventListener("message", event => { frames.push(JSON.parse(String(event.data))); });
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve(), { once: true });
      socket.addEventListener("error", () => reject(new Error("websocket refused")), { once: true });
    });
    socket.send(JSON.stringify({ type: "open", streamId: "follow", endpoint: "session/follow",
      payload: { args: { request: { address: { kind: "session", sessionId }, activate: true, maxMessages: 500 } } } }));
    while (!frames.some(frame => frame.type === "item" || frame.type === "error")) await Bun.sleep(5);
    const settled = frames.find(frame => frame.type === "item" || frame.type === "error")!;
    socket.close();
    return settled;
  };
  let host = await start();
  const first = await client(host);
  try {
    const preview = await first.ctx.remote.ompSessions.preview(join(home, "project")); if (!preview.ok) throw preview.error;
    expect((await first.ctx.remote.ompSessions.confirm(preview.value.confirmation)).ok).toBe(true);
    const page = await first.ctx.remote.ompSessions.catalog({}); if (!page.ok) throw page.error;
    const choice = page.value.choices[0]!;
    const opened = await first.ctx.remote.ompSessions.open(choice.selectionId); if (!opened.ok) throw opened.error;
    const before = opened.value.workerId;
    await first.ctx.fiber.dispose(); await host.stop();
    // The dying Host observed this worker exit without confirmation; the next Host owns that fact.
    const index = new SessionIndex(join(home, "state"));
    const persisted = index.get((await index.page({})).records[0]!.id);
    if (persisted === undefined) throw new Error("the restarted Host lost the attempt");
    index.observe(persisted.id, { state: "outcome_unknown", code: "SESSION_EXIT_OUTCOME_UNKNOWN" }); index.close();

    host = await start();
    const second = await client(host);
    try {
      const registered = await second.ctx.remote.ompSessions.index({}); if (!registered.ok) throw registered.error;
      expect(registered.value.records).toMatchObject([{ nativeSessionId: "native-0000",
        attempt: { state: "outcome_unknown", code: "SESSION_HOST_RESTARTED_MANUAL_OPEN_REQUIRED" } }]);
      // The read is refused with the manual-open marker, never auth, and starts nothing.
      const refused = await follow(host, second.cookie, "native-0000");
      expect(refused.error?.code).toBe("SESSION_MANUAL_OPEN_REQUIRED");
      expect(refused.error?.message).not.toContain("SESSION_AUTH_REQUIRED");
      expect(host.supervisor.starts).toBe(0);
      // Only the explicit public Open starts a worker; the next follow carries the retained native history.
      const choices = await second.ctx.remote.ompSessions.catalog({ refresh: true }); if (!choices.ok) throw choices.error;
      const reopened = await second.ctx.remote.ompSessions.open(choices.value.choices[0]!.selectionId);
      if (!reopened.ok) throw reopened.error;
      expect(reopened.value.workerId).not.toBe(before);
      expect(host.supervisor.starts).toBe(1);
      const snapshot = await follow(host, second.cookie, "native-0000");
      expect(snapshot.type).toBe("item");
      expect(JSON.stringify(snapshot.value)).toContain("Synthetic fixture input");
    } finally { await second.ctx.fiber.dispose(); await host.stop(); }
  } finally {
    if (host.server.port !== 0) await host.stop().catch(() => {});
    await discovery.close(); await rm(home, { recursive: true, force: true });
  }
}, 60_000);
