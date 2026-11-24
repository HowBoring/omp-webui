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
import { workspaceContribution, workspaceHostContribution } from "../../../packages/contracts/workspaces.ts";
import { workspaceFailure } from "../../../packages/workspaces/errors.ts";
import type { CatalogPageInput } from "../../../packages/contracts/catalog.ts";
import type { CatalogClient } from "../../../packages/contracts/generated/catalog-client.ts";
import type { InstallationSelection } from "../../../packages/compatibility/installation.ts";
import { trustedDiagnosticAssets } from "../../../packages/compatibility/assets.ts";
import { openBrowserAccess, type BrowserAccess } from "../../../packages/access/index.ts";
import { DirectoryGrants } from "../../../packages/workspaces/grants.ts";
import { workspacePage } from "../../../packages/workspaces/catalog.ts";
import { registeredPage, emptySessionIndex, type SessionIndexReader } from "../../../packages/workspaces/index.ts";
interface Options extends InstallationSelection { port?: number; assets?: string; catalog: CatalogClient; dataDir: string; index?: SessionIndexReader }
interface SocketData { peer: Peer; identity: BrowserAccess; detach?: () => void; streams: Map<string, AbortController> }
export class WorkspaceService extends TypertRemoteService {
  constructor(ctx: Context, private readonly catalog: CatalogClient, private readonly directories: DirectoryGrants, private readonly index: SessionIndexReader) {
    super(ctx, "ompWorkspaces");
  }
  @Remote("sources") sources() { return this.catalog.sources(); }
  @Remote("page") page(options: CatalogPageInput) { return workspacePage(this.catalog, this.directories, options); }
  @Remote("registered") registered(options: CatalogPageInput) {
    return registeredPage(this.catalog, this.directories, this.index, options);
  }
  @Remote("grants") grants() { return this.directories.list(); }
  @Remote("preview") preview(path: string) { return this.directories.preview(path); }
  @Remote("confirm") confirm(confirmation: string) { return this.directories.confirm(confirmation); }
  @Remote("revoke") revoke(id: string) {
    this.directories.revoke(id); return { revoked: true as const, workers: "unavailable_pending_44" as const };
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
export async function startWorkspaceComponentServer(options: Options) {
  const ctx = new Context();
  const assets = resolve(options.assets ?? "vendor/dsh-workspaces");
  const staticAssets = await trustedDiagnosticAssets(options.manifest, assets);
  await ctx.plugin(TypertRegistry);
  await ctx.plugin(RemoteAccessService);
  await ctx.plugin(TypertGatewayService, {});
  ctx.typert.register(workspaceHostContribution);
  const directories = new DirectoryGrants(options.dataDir);
  new WorkspaceService(ctx, options.catalog, directories, options.index ?? emptySessionIndex);
  const unregister = ctx.typertGateway.registerRemoteEvents(idle, { home: "/" });
  const peers = new Set<Peer>();
  const sockets = new Set<ServerWebSocket<SocketData>>();
  const owner = new Peer(ctx, { principal: { kind: "owner" } });

  let inflight = 0;
  let access: ReturnType<typeof openBrowserAccess>;
  const server = Bun.serve<SocketData>({
    hostname: "127.0.0.1", port: options.port ?? 3180, maxRequestBodySize: 16_384,
    async fetch(request, carrier) {
      const path = new URL(request.url).pathname;
      if (path !== "/" || new URL(request.url).searchParams.has("bootstrap")) {
        const auth = await access.handle(request);
        if (auth) return auth;
      }
      if (path === "/" || path.startsWith("/api/")) {
        const identity = access.admit(request, path === "/api/remote.mux" ? "websocket"
          : request.method === "POST" ? "write" : "read");
        if (identity instanceof Response) return identity;
      }
      if (path === "/api/remote.mux") {
        if (request.headers.get("origin") !== carrier.url.origin || peers.size >= 8) {
          return new Response("Forbidden", { status: 403 });
        }
        const identity = access.admit(request, "websocket");
        if (identity instanceof Response) return identity;
        const peer = new Peer(ctx, { principal: { kind: "owner" } });
        if (carrier.upgrade(request, { data: { peer, identity, streams: new Map() } })) {
          peers.add(peer);
          return;
        }
        await peer.dispose();
        return new Response("Upgrade required", { status: 426 });
      }
      if (Object.keys(workspaceContribution.methods).some(method => path === `/api/${method}`) && request.method === "POST") {
        if (request.headers.get("origin") !== carrier.url.origin) return new Response("Forbidden", { status: 403 });
        const identity = access.admit(request, "write");
        if (identity instanceof Response) return identity;
        if (inflight >= 32) return Response.json({ error: { code: "WORKSPACE_REQUEST_LIMIT" } }, { status: 429 });
        ++inflight;
        try {
          const response = await dispatchWorkspaceRequest(request, ctx, owner, () => access.revalidate(identity));
          return access.revalidate(identity) ? response : new Response("Access invalidated", { status: 401 });
        } finally { --inflight; }
      }
      if (path.startsWith("/api/")) return new Response("Private Session admission is blocked", { status: 501 });
      if (request.method === "GET" && path === "/healthz") {
        return Response.json({ service: "omp-webui-host", status: "ok", stage: "isolated-workspace-component", sessionAdmission: "blocked" });
      }
      if (request.method !== "GET" || !["/", "/client.js"].includes(path)) return new Response("Not found", { status: 404 });
      return staticAssets.response(path === "/" ? "index.html" : "client.js");
    },
    websocket: {
      maxPayloadLength: 16_384, idleTimeout: 60,
      open(socket) {
        sockets.add(socket);
        socket.data.detach = access.attachPeer(socket.data.identity, () => socket.close(4001, "Access invalidated"));
      },
      message(socket, bytes) {
        if (!access.revalidate(socket.data.identity)) { socket.close(4001, "Access invalidated"); return; }
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
        sockets.delete(socket); socket.data.detach?.();
        for (const control of socket.data.streams.values()) control.abort();
        peers.delete(socket.data.peer);
        void socket.data.peer.dispose();
      },
    },
  });
  access = openBrowserAccess({ dataDir: options.dataDir, origin: server.url.origin });
  return {
    server,
    bootstrapLink: () => access.bootstrapLink(),
    async stop(): Promise<void> {
      access.close(); directories.close();
      for (const socket of sockets) socket.close(1001, "Host shutdown");
      await unregister();
      await ctx.fiber.dispose();
      await server.stop(true);
    },
  };
}

export async function dispatchWorkspaceRequest(request: Request, ctx: Context, peer: Peer,
  current: () => boolean): Promise<Response> {
  if (request.headers.get("content-type")?.split(";", 1)[0] !== "application/json") {
    return new Response("JSON required", { status: 415 });
  }
  let decoded;
  try {
    const envelope = clientRequestSchema.parse(await request.json());
    const method = workspaceContribution.methods[envelope.method];
    if (!method || new URL(request.url).pathname !== `/api/${envelope.method}`) throw new Error("endpoint mismatch");
    const payload = z.strictObject({args:z.record(z.string(),z.unknown())}).parse(envelope.payload);
    const args = z.record(z.string(),z.unknown()).parse(method.input({strict:true}).create().parse(payload.args));
    decoded = { envelope, method, args };
  } catch { return new Response("Invalid workspace request", { status: 400 }); }
  const { envelope, method, args } = decoded;
  if (!current()) return new Response("Access invalidated", { status: 401 });
  try {
    request.signal.throwIfAborted();
    if (!current()) return new Response("Access invalidated", { status: 401 });
    const value = await ctx.typertGateway.invoke({namespace:method.namespace,method:method.method,
      args,peer,signal:request.signal});
    return Response.json({ type: "server-response", rpcId: envelope.rpcId, result: { ok: true, value } });
  } catch (error) {
    return Response.json({ type: "server-response", rpcId: envelope.rpcId,
      result: { ok: false, error: ctx.typertGateway.wireStream.failure(workspaceFailure(error)) } });
  }
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
