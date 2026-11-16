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
import { historyContribution, historyHostContribution, historyRequest,
  type HistoryRequest, type HistoryResult } from "../../packages/contracts/history.ts";
import { HistoryTransport } from "../../packages/compatibility/history-transport.ts";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

interface Options { port?: number; assets?: string }
interface SocketData { peer: Peer; streams: Map<string, AbortController> }
class HistoryFixtureService extends TypertRemoteService {
  constructor(ctx: Context, private readonly transport: HistoryTransport) { super(ctx, "ompHistoryFixture"); }
  @Remote("read")
  async read(options: HistoryRequest): Promise<HistoryResult> {
    try {
      if (options.operation === "open") return { status: "opened", value: await this.transport.history.open(options.scope) };
      if (options.operation === "page") return { status: "page", value: await this.transport.history.page(options.cursor) };
      if (options.operation === "content") return { status: "content", value: await this.transport.history.content(options.cursor) };
      await this.transport.history.close(options.snapshot); return { status: "closed" };
    } catch (error) {
      const message = error instanceof Error ? error.message : "history_read_failed";
      return { status: "error", code: /^(history_[a-z_]+|RPC_[A-Z_]+|HISTORY_[A-Z_]+)$/.test(message) ? message : "history_read_failed" };
    }
  }
}

async function* idle(signal: AbortSignal): AsyncGenerator<never> {
  const done = Promise.withResolvers<void>();
  const abort = () => { done.resolve(); };
  signal.addEventListener("abort", abort, { once: true });
  try { if (!signal.aborted) await done.promise; }
  finally { signal.removeEventListener("abort", abort); }
}

/** Loopback diagnostics carrier. No private Session or general Remote routes are mounted. */
export async function startHistoryFixture(options: Options) {
  const ctx = new Context();
  const lifetime = new AbortController();
  const assets = resolve(options.assets ?? "vendor/dsh-history");
  const profile = await mkdtemp(join(tmpdir(), "omp-history-browser-"));
  const transport = await HistoryTransport.open({ argv: [process.execPath, "--no-env-file", "--preload",
    resolve("compatibility/omp/fixtures/history-network-guard.js"), resolve("compatibility/omp/fixtures/history-rpc.js")],
    env: { HOME: profile, PI_CODING_AGENT_DIR: profile, OMP_HISTORY_FIXTURE_PROFILE: profile,
      PATH: process.env.PATH ?? "/usr/bin:/bin" }, signal: lifetime.signal });
  await ctx.plugin(TypertRegistry); await ctx.plugin(RemoteAccessService); await ctx.plugin(TypertGatewayService, {});
  ctx.typert.register(historyHostContribution);
  new HistoryFixtureService(ctx, transport);
  const unregister = ctx.typertGateway.registerRemoteEvents(idle, { home: "/synthetic-history" });
  const peers = new Set<Peer>();
  const sockets = new Set<ServerWebSocket<SocketData>>();
  const owner = new Peer(ctx, { principal: { kind: "owner" } });

  const permitted = (request: Request, origin: string): boolean => {
    const supplied = request.headers.get("origin");
    return request.headers.get("host") === new URL(origin).host && (supplied === null || supplied === origin)
      && !["cross-site", "same-site"].includes(request.headers.get("sec-fetch-site") ?? "");
  };
  const server = Bun.serve<SocketData>({
    hostname: "127.0.0.1", port: options.port ?? 3184, maxRequestBodySize: 16_384,
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
      if (path === "/api/ompHistoryFixture/read" && request.method === "POST") {
        if (request.headers.get("origin") !== carrier.url.origin) return new Response("Forbidden", { status: 403 });
        return dispatch(request, ctx, owner);
      }
      if (path.startsWith("/api/")) return new Response("Private Session admission is blocked", { status: 501 });
      if (request.method === "GET" && path === "/healthz") {
        return Response.json({ service: "omp-webui-host", status: "ok", stage: "synthetic-history-only", sessionAdmission: "blocked" });
      }
      if (request.method !== "GET" || !["/", "/client.js"].includes(path)) return new Response("Not found", { status: 404 });
      return new Response(Bun.file(join(assets, path === "/" ? "index.html" : "client.js")));
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
    server, profile,
    async stop(): Promise<void> {
      lifetime.abort();
      await transport.close();
      await rm(profile, {recursive:true,force:true});
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
    if (envelope.method !== "ompHistoryFixture/read") throw new Error("endpoint mismatch");
    const payload = z.strictObject({ args: z.strictObject({options: historyRequest}) }).parse(envelope.payload);
    const method = historyContribution.methods["ompHistoryFixture/read"];
    method?.input({ strict: true }).create().parse(payload.args);
    const value = await ctx.typertGateway.invoke({ namespace: "ompHistoryFixture", method: "read",
      args: payload.args, peer, signal: request.signal });
    return Response.json({ type: "server-response", rpcId: envelope.rpcId, result: { ok: true, value } });
  } catch { return new Response("Invalid history fixture request", { status: 400 }); }
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
