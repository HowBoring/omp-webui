import { Context } from "@deepseek-ai/cordis";
import TypertRegistry from "@deepseek-ai/dsh-typert-registry";
import RemoteAccessService from "@deepseek-ai/dsh-api-remote-access";
import { TypertGatewayService } from "@deepseek-ai/dsh-api-gateway";
import { Peer, clientRequestSchema } from "@deepseek-ai/dsh-client-connection";
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import { parseRemoteStreamClientMessage } from "@deepseek-ai/dsh-api-gateway/stream-protocol";
import type { ServerWebSocket } from "bun";
import { resolve } from "node:path";
import { z } from "zod";
import { continuationContribution, continuationHostContribution,
  type ContinuationAction } from "../../../packages/contracts/continuation.ts";
import { ContinuationFixture } from "../../../packages/continuation/fixture.ts";
import { trustedDiagnosticAssets } from "../../../packages/compatibility/assets.ts";
import type { InstallationSelection } from "../../../packages/compatibility/installation.ts";

interface Options extends InstallationSelection { port?: number; assets?: string; fixture: ContinuationFixture }
interface SocketData { peer: Peer; streams: Map<string, AbortController> }


class ContinuationFixtureService extends TypertRemoteService {
  constructor(ctx: Context, readonly fixture: ContinuationFixture) { super(ctx, "ompContinuationFixture"); }
  @Remote("snapshot") snapshot() { return this.fixture.snapshot(); }
  @Remote("act") act(action: ContinuationAction) { return this.fixture.act(action); }
}

async function* idle(signal: AbortSignal): AsyncGenerator<never> {
  const done = Promise.withResolvers<void>();
  const abort = () => { done.resolve(); };
  signal.addEventListener("abort", abort, { once: true });
  try { if (!signal.aborted) await done.promise; }
  finally { signal.removeEventListener("abort", abort); }
}

/** Isolated typed continuation carrier. Only synthetic sources are configured; product admission stays blocked. */
export async function startContinuationFixtureServer(options: Options) {
  const ctx = new Context();
  const lifetime = new AbortController();
  const assets = resolve(options.assets ?? "vendor/dsh-continuation");
  const staticAssets = await trustedDiagnosticAssets(options.manifest, assets);
  await ctx.plugin(TypertRegistry);
  await ctx.plugin(RemoteAccessService);
  await ctx.plugin(TypertGatewayService, {});
  ctx.typert.register(continuationHostContribution);
  new ContinuationFixtureService(ctx, options.fixture);
  const unregister = ctx.typertGateway.registerRemoteEvents(idle, { home: "/continuation-fixture" });
  const peers = new Set<Peer>();
  const sockets = new Set<ServerWebSocket<SocketData>>();
  const owner = new Peer(ctx, { principal: { kind: "owner" } });

  const permitted = (request: Request, origin: string): boolean => {
    const supplied = request.headers.get("origin");
    return request.headers.get("host") === new URL(origin).host && (supplied === null || supplied === origin)
      && !["cross-site", "same-site"].includes(request.headers.get("sec-fetch-site") ?? "");
  };
  const server = Bun.serve<SocketData>({
    hostname: "127.0.0.1", port: options.port ?? 3185, maxRequestBodySize: 16_384,
    async fetch(request, carrier) {
      const path = new URL(request.url).pathname;
      if (!permitted(request, carrier.url.origin)) return new Response("Forbidden", { status: 403 });
      if (path === "/api/remote.mux") {
        if (request.headers.get("origin") !== carrier.url.origin || peers.size >= 8) {
          return new Response("Forbidden", { status: 403 });
        }
        const peer = new Peer(ctx, { principal: { kind: "owner" } });
        if (carrier.upgrade(request, { data: { peer, streams: new Map() } })) {
          peers.add(peer);
          return;
        }
        await peer.dispose();
        return new Response("Upgrade required", { status: 426 });
      }
      if (["/api/ompContinuationFixture/snapshot", "/api/ompContinuationFixture/act"].includes(path) && request.method === "POST") {
        if (request.headers.get("origin") !== carrier.url.origin) return new Response("Forbidden", { status: 403 });
        return dispatch(request, ctx, owner);
      }
      if (path.startsWith("/api/")) return new Response("Private Session admission is blocked", { status: 501 });
      if (request.method === "GET" && path === "/healthz") {
        return Response.json({ service: "omp-webui-host", status: "ok", stage: "isolated-continuation-fixture", sessionAdmission: "blocked" });
      }
      if (request.method !== "GET" || !["/", "/client.js"].includes(path)) return new Response("Not found", { status: 404 });
      return staticAssets.response(path === "/" ? "index.html" : "client.js");
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
  return {
    server,
    async stop(): Promise<void> {
      lifetime.abort();
      await options.fixture.close();
      for (const socket of sockets) socket.close(1001, "Host shutdown");
      await unregister();
      await ctx.fiber.dispose();
      await server.stop(true);
    },
  };
}

async function dispatch(request: Request, ctx: Context, peer: Peer): Promise<Response> {
  try {
    if (request.headers.get("content-type")?.split(";", 1)[0] !== "application/json") return new Response("JSON required", { status: 415 });
    const envelope = clientRequestSchema.parse(await request.json());
    const method = continuationContribution.methods[envelope.method];
    if (!method || new URL(request.url).pathname !== `/api/${envelope.method}`) throw new Error("endpoint mismatch");
    const payload = z.strictObject({args:z.record(z.string(),z.unknown())}).parse(envelope.payload);
    const args = z.record(z.string(),z.unknown()).parse(method.input({strict:true}).create().parse(payload.args));
    const value = await ctx.typertGateway.invoke({namespace:method.namespace,method:method.method,
      args,peer,signal:request.signal});
    const bytes = JSON.stringify({ type: "server-response", rpcId: envelope.rpcId, result: { ok: true, value } });
    if (Buffer.byteLength(bytes) > 262_144) throw new Error("continuation response limit");
    return new Response(bytes, { headers: { "content-type": "application/json" } });
  } catch { return new Response("Invalid diagnostic request", { status: 400 }); }
}

async function pump(socket: ServerWebSocket<SocketData>, streamId: string, payload: unknown,
  control: AbortController, ctx: Context): Promise<void> {
  try {
    const stream = await ctx.typertGateway.wireStream.open("$events", payload, idle(control.signal),
      socket.data.peer, control.signal);
    for await (const value of stream) {
      if (socket.send(JSON.stringify({ type: "item", streamId, value })) < 0) throw new Error("slow diagnostic viewer");
    }
  } finally { socket.data.streams.delete(streamId); }
}
