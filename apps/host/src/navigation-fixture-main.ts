/** Isolated navigation acceptance executable. The product/default Host never imports this file. */
import { Context } from "@deepseek-ai/cordis";
import TypertRegistry from "@deepseek-ai/dsh-typert-registry";
import RemoteAccessService from "@deepseek-ai/dsh-api-remote-access";
import { TypertGatewayService } from "@deepseek-ai/dsh-api-gateway";
import { Peer, clientRequestSchema } from "@deepseek-ai/dsh-client-connection";
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import { parseRemoteStreamClientMessage } from "@deepseek-ai/dsh-api-gateway/stream-protocol";
import type { ServerWebSocket } from "bun";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";
import { navigationHostContribution, navigationFixtureContribution,
  type NavigationFixtureAction, type NavigationFixtureSnapshot } from "../../../packages/contracts/navigation-fixture.ts";
import { historyNavigationSourceContribution, historyNavigationSourceHostContribution } from "../../../packages/contracts/history-navigation-source.ts";
import { HistoryNavigationSource } from "../../../packages/history-navigation-source/service.ts";
import { NavigationFixture } from "../../../packages/navigation/fixture.ts";

interface SocketData { peer: Peer; streams: Map<string, AbortController> }

class NavigationFixtureService extends TypertRemoteService {
  constructor(ctx: Context, readonly fixture: NavigationFixture) { super(ctx, "ompNavigationFixture"); }
  @Remote("snapshot") snapshot(): Promise<NavigationFixtureSnapshot> { return this.fixture.snapshot(); }
  @Remote("act") async act(action: NavigationFixtureAction): Promise<NavigationFixtureSnapshot> {
    if (action.type === "crash") await this.fixture.crash();
    else await this.fixture.reopen();
    return await this.fixture.snapshot();
  }
}

async function* idle(signal: AbortSignal): AsyncGenerator<never> {
  const done = Promise.withResolvers<void>();
  const abort = () => { done.resolve(); };
  signal.addEventListener("abort", abort, { once: true });
  try { if (!signal.aborted) await done.promise; }
  finally { signal.removeEventListener("abort", abort); }
}

async function dispatch(request: Request, ctx: Context, peer: Peer,
  contribution: typeof navigationFixtureContribution | typeof historyNavigationSourceContribution): Promise<Response> {
  try {
    if (request.headers.get("content-type")?.split(";", 1)[0] !== "application/json") return new Response("JSON required", { status: 415 });
    const envelope = clientRequestSchema.parse(await request.json());
    const method = contribution.methods[envelope.method];
    if (!method || new URL(request.url).pathname !== `/api/${envelope.method}`) throw new Error("endpoint mismatch");
    const payload = z.strictObject({ args: z.record(z.string(), z.unknown()) }).parse(envelope.payload);
    const args = z.record(z.string(), z.unknown()).parse(method.input({ strict: true }).create().parse(payload.args));
    const value = await ctx.typertGateway.invoke({ namespace: method.namespace, method: method.method, args, peer, signal: request.signal });
    const bytes = JSON.stringify({ type: "server-response", rpcId: envelope.rpcId, result: { ok: true, value } });
    if (Buffer.byteLength(bytes) > 262_144) throw new Error("navigation response limit");
    return new Response(bytes, { headers: { "content-type": "application/json" } });
  } catch { return new Response("Invalid diagnostic request", { status: 400 }); }
}

const home = resolve("vendor/navigation-profile");
const fixture = new NavigationFixture({
  bun: process.execPath, cli: resolve("vendor/omp-strict/packages/coding-agent/src/cli.ts"),
  guard: resolve("compatibility/omp/fixtures/no-provider.ts"),
  provider: resolve("compatibility/omp/fixtures/navigation-provider.ts"),
  cwd: resolve("vendor/omp-strict"), home, project: join(home, "project"),
});
await fixture.start();
const started = await fixture.snapshot();
if (started.phase === "failed") throw new Error(started.error ?? "navigation_fixture_start_failed");

const port = Number(process.env.OMP_NAVIGATION_FIXTURE_PORT ?? 3186);
const pageRoot = resolve("vendor/dsh-navigation");
const pageManifest = z.object({ assets: z.record(z.string(), z.string()) })
  .parse(JSON.parse(await readFile(resolve(pageRoot, "manifest.json"), "utf8")));
async function pageAsset(name: "index.html" | "client.js"): Promise<Response> {
  const bytes = await readFile(resolve(pageRoot, name));
  if (createHash("sha256").update(bytes).digest("hex") !== pageManifest.assets[name]) {
    return new Response("Page asset mismatch; Session admission blocked", { status: 503 });
  }
  return new Response(bytes, { headers: {
    "content-type": name === "index.html" ? "text/html" : "text/javascript", "cache-control": "no-store",
    "content-security-policy": "default-src 'self'; script-src 'self'; connect-src 'self'; style-src 'unsafe-inline'",
  } });
}
const ctx = new Context();
await ctx.plugin(TypertRegistry);
await ctx.plugin(RemoteAccessService);
await ctx.plugin(TypertGatewayService, {});
ctx.typert.register(navigationHostContribution);
ctx.typert.register(historyNavigationSourceHostContribution);
new NavigationFixtureService(ctx, fixture);
new HistoryNavigationSource(ctx, fixture.ports);
const unregister = ctx.typertGateway.registerRemoteEvents(idle, { home: "/navigation-fixture" });
const peers = new Set<Peer>();
const sockets = new Set<ServerWebSocket<SocketData>>();
const owner = new Peer(ctx, { principal: { kind: "owner" } });

const server = Bun.serve<SocketData>({
  hostname: "127.0.0.1", port, maxRequestBodySize: 16_384,
  async fetch(request, carrier) {
    const path = new URL(request.url).pathname;
    const supplied = request.headers.get("origin");
    if (request.headers.get("host") !== new URL(carrier.url.origin).host
      || (supplied !== null && supplied !== carrier.url.origin)
      || ["cross-site", "same-site"].includes(request.headers.get("sec-fetch-site") ?? "")) {
      return new Response("Forbidden", { status: 403 });
    }
    if (path === "/api/remote.mux") {
      if (supplied !== carrier.url.origin || peers.size >= 8) return new Response("Forbidden", { status: 403 });
      const peer = new Peer(ctx, { principal: { kind: "owner" } });
      if (carrier.upgrade(request, { data: { peer, streams: new Map() } })) { peers.add(peer); return; }
      await peer.dispose();
      return new Response("Upgrade required", { status: 426 });
    }
    if (request.method === "POST") {
      if (supplied !== carrier.url.origin) return new Response("Forbidden", { status: 403 });
      if (path === "/api/ompNavigationFixture/snapshot" || path === "/api/ompNavigationFixture/act")
        return dispatch(request, ctx, owner, navigationFixtureContribution);
      if (path === "/api/ompHistoryNavigationSource/action")
        return dispatch(request, ctx, owner, historyNavigationSourceContribution);
    }
    if (path.startsWith("/api/")) return new Response("Private Session admission is blocked", { status: 501 });
    if (request.method === "GET" && path === "/healthz") {
      return Response.json({ service: "omp-webui-host", status: "ok",
        stage: "isolated-navigation-fixture", sessionAdmission: "blocked",
        fixture: started.phase, starts: started.starts });
    }
    if (request.method !== "GET" || !["/", "/client.js"].includes(path)) return new Response("Not found", { status: 404 });
    return pageAsset(path === "/" ? "index.html" : "client.js");
  },
  websocket: {
    maxPayloadLength: 16_384, idleTimeout: 60,
    open(socket) { sockets.add(socket); },
    message(socket, bytes) {
      try {
        const text = typeof bytes === "string" ? bytes : new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        const frame = parseRemoteStreamClientMessage(text);
        if (frame.type === "cancel") { socket.data.streams.get(frame.streamId)?.abort(); return; }
        if (frame.type !== "open" || frame.endpoint !== "$events" || socket.data.streams.size >= 1) {
          socket.close(1008, "diagnostics streams only"); return;
        }
        const control = new AbortController();
        socket.data.streams.set(frame.streamId, control);
        void pump(socket, frame.streamId, frame.payload, control, ctx).catch(() => socket.close(1011, "stream failed"));
      } catch { socket.close(1008, "invalid stream frame"); }
    },
    close(socket) {
      sockets.delete(socket);
      for (const control of socket.data.streams.values()) control.abort();
      peers.delete(socket.data.peer);
      void socket.data.peer.dispose();
    },
  },
});

async function pump(socket: ServerWebSocket<SocketData>, streamId: string, payload: unknown,
  control: AbortController, context: Context): Promise<void> {
  try {
    const stream = await context.typertGateway.wireStream.open("$events", payload, idle(control.signal),
      socket.data.peer, control.signal);
    for await (const value of stream) {
      if (socket.send(JSON.stringify({ type: "item", streamId, value })) < 0) throw new Error("slow diagnostic viewer");
    }
  } finally { socket.data.streams.delete(streamId); }
}

console.info(`Isolated navigation fixture: ${server.url}`);
for (const signal of ["SIGTERM", "SIGINT"] as const) process.once(signal, () => {
  void (async () => {
    for (const socket of sockets) socket.close(1001, "Host shutdown");
    await unregister();
    await fixture.close();
    await ctx.fiber.dispose();
    await server.stop(true);
    process.exit(0);
  })();
});
