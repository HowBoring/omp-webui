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
import { interactionsContribution, interactionsHostContribution, type UIAnswer,
  type InteractionScenario } from "../../../packages/contracts/interactions.ts";
import { InteractionBridge } from "../../../packages/interactions/bridge.ts";
import { startNativeInteractionFixture } from "../../../tests/interactions/worker.ts";

interface Options { port?:number; waitMs?:number }
interface SocketData { peer:Peer; streams:Map<string,AbortController> }
class InteractionsService extends TypertRemoteService {
  readonly state={initialized:false,busy:false};
  constructor(ctx:Context,readonly bridge:InteractionBridge) {super(ctx,"ompInteractions");}
  @Remote("snapshot") snapshot() {return this.bridge.snapshot();}
  @Remote("answer") async answer(generation:string,interactionId:string,answer:UIAnswer) {
    const root=this.bridge.snapshot().pending.some(card=>card.id === interactionId && card.scope.kind === "startup");
    const result=await this.bridge.answer(generation,interactionId,answer);
    if(root && result.status !== "invalid" && result.status !== "stale" && !this.state.initialized) {
      const state=await this.bridge.port.command({type:"get_state"});
      const identity=z.object({sessionId:z.string().min(1),model:z.object({provider:z.literal("openai"),id:z.literal("gpt-4o")})}).parse(state);
      this.bridge.bindSession(identity.sessionId);
      await this.bridge.port.command({type:"set_ask_dialog",enabled:true});this.state.initialized=true;
    }
    return result;
  }
  @Remote("start") async start(scenario:InteractionScenario) {
    if(!this.state.initialized || this.state.busy || this.bridge.snapshot().pending.length) throw new Error("S0_NATIVE_BUSY");
    const commands:Record<InteractionScenario,string>={ask:"/s0-ask","multi-ask":"/s0-multi-ask", "timed-ask":"/s0-ask 700",select:"/s0-select",confirm:"/s0-confirm",
      tool:"/s0-tool", "timed-tool":"/s0-tool 0.7"};
    this.state.busy=true;
    void this.bridge.port.command({type:"prompt",message:commands[scenario]}).catch(()=>{}).finally(()=>{this.state.busy=false;});
    return this.bridge.snapshot();
  }
}

async function* idle(signal: AbortSignal): AsyncGenerator<never> {
  const done = Promise.withResolvers<void>();
  const abort = () => { done.resolve(); };
  signal.addEventListener("abort", abort, { once: true });
  try { if (!signal.aborted) await done.promise; }
  finally { signal.removeEventListener("abort", abort); }
}

/** Isolated loopback interaction acceptance carrier. Product Session admission is blocked. */
export async function startInteractionsFixtureServer(options: Options={}) {
  const ctx = new Context();
  const assets=resolve("vendor/dsh-interactions");
  const worker=await startNativeInteractionFixture();
  const bridge=new InteractionBridge(worker,options.waitMs === undefined ? {} : {waitMs:options.waitMs});
  await ctx.plugin(TypertRegistry);await ctx.plugin(RemoteAccessService);await ctx.plugin(TypertGatewayService,{});
  ctx.typert.register(interactionsHostContribution);new InteractionsService(ctx,bridge);
  const unregister = ctx.typertGateway.registerRemoteEvents(idle, { home: "/S0-isolated-interactions" });
  const peers = new Set<Peer>();
  const sockets = new Set<ServerWebSocket<SocketData>>();
  const owner = new Peer(ctx, { principal: { kind: "owner" } });

  const permitted = (request: Request, origin: string): boolean => {
    const supplied = request.headers.get("origin");
    return request.headers.get("host") === new URL(origin).host && (supplied === null || supplied === origin)
      && !["cross-site", "same-site"].includes(request.headers.get("sec-fetch-site") ?? "");
  };
  const server = Bun.serve<SocketData>({
    hostname: "127.0.0.1", port: options.port ?? 3183, maxRequestBodySize: 16_384,
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
      if (["/api/ompInteractions/snapshot","/api/ompInteractions/answer","/api/ompInteractions/start"].includes(path) && request.method === "POST") {
        if (request.headers.get("origin") !== carrier.url.origin) return new Response("Forbidden", { status: 403 });
        return dispatch(request, ctx, owner);
      }
      if (path.startsWith("/api/")) return new Response("Private Session admission is blocked", { status: 501 });
      if (request.method === "GET" && path === "/healthz") {
        return Response.json({ service: "omp-webui-host", status: "ok", stage: "S0-isolated-interactions", sessionAdmission: "blocked" });
      }
      if (request.method !== "GET" || !["/", "/client.js"].includes(path)) return new Response("Not found", { status: 404 });
      return new Response(Bun.file(resolve(assets,path === "/" ? "index.html" : "client.js")));
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
    server, bridge,
    async stop() {
      bridge.dispose();
      for (const socket of sockets) socket.close(1001, "Host shutdown");
      await unregister();
      await ctx.fiber.dispose();
      await server.stop(true);
      return worker.close();
    },
  };
}

async function dispatch(request: Request, ctx: Context, peer: Peer): Promise<Response> {
  try {
    if (request.headers.get("content-type")?.split(";", 1)[0] !== "application/json") return new Response("JSON required", { status: 415 });
    const envelope = clientRequestSchema.parse(await request.json());
    const method=interactionsContribution.methods[envelope.method];
    if(method === undefined) throw new Error("Unsupported S0 Remote");
    const payload=z.strictObject({args:z.record(z.string(),z.unknown())}).parse(envelope.payload);
    method.input({strict:true}).create().parse(payload.args);
    const [namespace,name]=envelope.method.split("/");
    if(namespace !== "ompInteractions" || !name)throw new Error("Invalid S0 method");
    const value=await ctx.typertGateway.invoke({namespace,method:name,args:payload.args,peer,signal:request.signal});
    return Response.json({ type: "server-response", rpcId: envelope.rpcId, result: { ok: true, value } });
  } catch { return new Response("Invalid isolated interaction request", { status: 400 }); }
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
