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

test.each(["direct", "retained"] as const)(
  "the isolated Session carrier forwards a %s launch method inherited from its option class", async mode => {
    const home = await mkdtemp(join(tmpdir(), "session-launch-carrier-"));
    const launches: { cwd: string; retirement?: AbortSignal }[] = [];
    class CarrierOptions {
      readonly dataDir = join(home, "state");
      readonly port = 0;
      readonly catalog = new CatalogClient(async () => { throw new Error("UNEXPECTED_CATALOG_REQUEST"); });
      readonly manifest = join(home, "absent-manifest");
      readonly launcher = join(home, "absent-launcher");
    }
    class DirectOptions extends CarrierOptions {
      async launch(cwd: string): Promise<never> {
        launches.push({ cwd });
        throw new Error("STRICT_STARTUP_FAILED");
      }
    }
    class RetainedOptions extends CarrierOptions {
      launchOwned(cwd: string, retirement: AbortSignal): never {
        launches.push({ cwd, retirement });
        throw new Error("STRICT_STARTUP_FAILED");
      }
    }
    const options = mode === "direct" ? new DirectOptions() : new RetainedOptions();
    const host = await startSessionComponentServer(options);
    const ctx = new Context();
    try {
      const origin = host.server.url.origin;
      const exchange = await fetch(host.bootstrapLink(), { redirect: "manual" });
      const cookie = exchange.headers.get("set-cookie")!.split(";")[0]!;
      const { csrf } = await (await fetch(`${origin}/auth/status`, { headers: { cookie } })).json() as { csrf: string };
      installConnection(ctx, { interactions: "none", transport: {
        fetch: (url, init) => fetch(new URL(url, origin), {
          ...init, headers: { cookie, origin, "x-omp-csrf": csrf, "content-type": "application/json" },
        }),
        openStream: async function* () {},
      } });
      registry(ctx); gateway(ctx); await ctx.remote.$mount(sessionsContribution);
      const preview = await ctx.remote.ompSessions.preview(home);
      if (!preview.ok) throw preview.error;
      const grant = await ctx.remote.ompSessions.confirm(preview.value.confirmation);
      if (!grant.ok) throw grant.error;

      expect(await ctx.remote.ompSessions.new(grant.value.id)).toMatchObject({
        ok: false, error: { code: "STRICT_STARTUP_FAILED" },
      });
      expect(launches).toEqual([mode === "direct" ? { cwd: home } : { cwd: home, retirement: expect.any(AbortSignal) }]);
      expect(host.supervisor.hasOwnedReservation).toBe(true);
    } finally {
      await ctx.fiber.dispose(); await host.stop(); await rm(home, { recursive: true, force: true });
    }
  },
);

test("cancelling a live Session stream keeps the multiplexed websocket open", async () => {
  const home = await mkdtemp(join(tmpdir(), "session-stream-cancel-"));
  class Options {
    readonly dataDir = join(home, "state");
    readonly port = 0;
    readonly catalog = new CatalogClient(async () => { throw new Error("UNEXPECTED_CATALOG_REQUEST"); });
    readonly manifest = join(home, "absent-manifest");
    readonly launcher = join(home, "absent-launcher");
    readonly launchOwned = async () => { throw new Error("UNEXPECTED_LAUNCH"); };
  }
  const host = await startSessionComponentServer(new Options());
  try {
    const origin = host.server.url.origin;
    const exchange = await fetch(host.bootstrapLink(), { redirect: "manual" });
    const cookie = exchange.headers.get("set-cookie")!.split(";")[0]!;
    const url = new URL("api/remote.mux", host.server.url.href);
    url.protocol = "ws:";
    // Bun accepts handshake headers here; the DOM typings only admit protocols.
    const socket = new WebSocket(url.href, { headers: { cookie, origin } } as unknown as string[]);
    const frames: { type: string; streamId: string }[] = [];
    let closed: { code: number; reason: string } | undefined;
    socket.addEventListener("message", event => { frames.push(JSON.parse(String(event.data)) as { type: string; streamId: string }); });
    socket.addEventListener("close", event => { closed = { code: event.code, reason: event.reason }; });
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve(), { once: true });
      socket.addEventListener("error", () => reject(new Error("websocket refused")), { once: true });
    });
    // The DSH client cancels a stream immediately after opening it on reconnect, while the
    // handshake is still in flight; that must abort only that stream, never the multiplexed socket.
    socket.send(JSON.stringify({ type: "open", streamId: "first", endpoint: "session/control", payload: { args: {} } }));
    socket.send(JSON.stringify({ type: "cancel", streamId: "first" }));
    await Bun.sleep(100);
    expect(closed).toBeUndefined();
    expect(socket.readyState).toBe(WebSocket.OPEN);
    socket.send(JSON.stringify({ type: "open", streamId: "second", endpoint: "session/control", payload: { args: {} } }));
    while (!frames.some(frame => frame.type === "item" && frame.streamId === "second")) await Bun.sleep(5);
    expect(closed).toBeUndefined();
    socket.close();
  } finally {
    await host.stop(); await rm(home, { recursive: true, force: true });
  }
});
