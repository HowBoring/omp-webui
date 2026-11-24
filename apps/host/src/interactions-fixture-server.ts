import { Context } from "@deepseek-ai/cordis";
import TypertRegistry from "@deepseek-ai/dsh-typert-registry";
import RemoteAccessService from "@deepseek-ai/dsh-api-remote-access";
import { TypertGatewayService } from "@deepseek-ai/dsh-api-gateway";
import { clientRequestSchema } from "@deepseek-ai/dsh-client-connection";
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import type { Peer } from "@deepseek-ai/dsh-client-connection";
import { DshEventsCarrier, permittedFixtureOrigin, type DshSocketData } from "./dsh-events-carrier.ts";
import { resolve } from "node:path";
import { z } from "zod";
import { interactionsContribution, interactionsHostContribution, type UIAnswer,
  type InteractionScenario } from "../../../packages/contracts/interactions.ts";
import { InteractionBridge, type InteractionPort } from "../../../packages/interactions/bridge.ts";
import { startNativeInteractionFixture } from "../../../tests/interactions/worker.ts";

interface Options { port?:number; waitMs?:number }
class InteractionsService extends TypertRemoteService {
  readonly state={initialized:false,busy:false};
  constructor(ctx:Context,readonly bridge:InteractionBridge) {super(ctx,"ompInteractions");}
  @Remote("snapshot") snapshot() {return this.bridge.snapshot();}
  @Remote("answer") async answer(generation:string,interactionId:string,answer:UIAnswer) {
    const admission=this.bridge.admission(generation,interactionId,answer);
    if(admission) return await admission;
    const root=this.bridge.snapshot().pending.some(card=>card.id === interactionId && card.scope.kind === "startup");
    const result=await this.bridge.answer(generation,interactionId,answer);
    if(root && ["answered","cancelled","expired"].includes(result.status) && !this.state.initialized) {
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

/** Isolated loopback interaction acceptance carrier. Product Session admission is blocked. */
export async function startInteractionsFixtureServer(options: Options={}) {
  const worker=await startNativeInteractionFixture();
  const carrier=await startInteractionsFixtureCarrier(worker,options);
  return {...carrier,async stop(){await carrier.stop();return worker.close();}};
}

/** Public isolated carrier with an owned worker boundary; no browser-provided worker controls. */
export async function startInteractionsFixtureCarrier(worker:InteractionPort,options:Options={}) {
  const ctx = new Context();
  const assets=resolve("vendor/dsh-interactions");
  const bridge=new InteractionBridge(worker,options.waitMs === undefined ? {} : {waitMs:options.waitMs});
  await ctx.plugin(TypertRegistry);await ctx.plugin(RemoteAccessService);await ctx.plugin(TypertGatewayService,{});
  ctx.typert.register(interactionsHostContribution);new InteractionsService(ctx,bridge);
  const events=new DshEventsCarrier(ctx,"/S0-isolated-interactions");
  const server = Bun.serve<DshSocketData>({
    hostname: "127.0.0.1", port: options.port ?? 3183, maxRequestBodySize: 16_384,
    async fetch(request, carrier) {
      const path = new URL(request.url).pathname;
      if (!permittedFixtureOrigin(request, carrier.url.origin)) return new Response("Forbidden", { status: 403 });
      if (path === "/api/remote.mux") return events.upgrade(request,carrier);
      if (["/api/ompInteractions/snapshot","/api/ompInteractions/answer","/api/ompInteractions/start"].includes(path) && request.method === "POST") {
        if (request.headers.get("origin") !== carrier.url.origin) return new Response("Forbidden", { status: 403 });
        return dispatch(request, ctx, events.owner);
      }
      if (path.startsWith("/api/")) return new Response("Private Session admission is blocked", { status: 501 });
      if (request.method === "GET" && path === "/healthz") {
        return Response.json({ service: "omp-webui-host", status: "ok", stage: "S0-isolated-interactions", sessionAdmission: "blocked" });
      }
      if (request.method !== "GET" || !["/", "/client.js"].includes(path)) return new Response("Not found", { status: 404 });
      return new Response(Bun.file(resolve(assets,path === "/" ? "index.html" : "client.js")));
    },
    websocket:events.websocket,
  });
  return {
    server, bridge,
    async stop() {
      bridge.dispose();
      await events.dispose();
      await ctx.fiber.dispose();
      await server.stop(true);
    },
  };
}

async function dispatch(request: Request, ctx: Context, peer: Peer): Promise<Response> {
  try {
    if (request.headers.get("content-type")?.split(";", 1)[0] !== "application/json") return new Response("JSON required", { status: 415 });
    const envelope = clientRequestSchema.parse(await request.json());
    if(new URL(request.url).pathname !== `/api/${envelope.method}`)throw new Error("S0 endpoint mismatch");
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

