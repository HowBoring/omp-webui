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
import { diagnosticsContribution, diagnosticsHostContribution,
  type DiagnosticReport } from "../../../packages/contracts/diagnostics.ts";
import { trustedDiagnosticAssets } from "../../../packages/compatibility/assets.ts";
import { inspectDiagnostics } from "../../../packages/compatibility/diagnostics.ts";
import type { InstallationSelection } from "../../../packages/compatibility/installation.ts";

interface Options extends InstallationSelection { port?: number; assets?: string }
const emptyPayload = z.strictObject({ args: z.strictObject({}) });

class DiagnosticsService extends TypertRemoteService {
  constructor(ctx: Context, private readonly inspect: () => Promise<DiagnosticReport>) {
    super(ctx, "ompDiagnostics");
  }
  @Remote("preflight")
  preflight(): Promise<DiagnosticReport> { return this.inspect(); }
}

/** Loopback diagnostics carrier. No private Session or general Remote routes are mounted. */
export async function startDiagnosticsServer(options: Options) {
  const ctx = new Context();
  const lifetime = new AbortController();
  const assets = resolve(options.assets ?? "vendor/dsh-diagnostics");
  const staticAssets = await trustedDiagnosticAssets(options.manifest, assets, options.expectedIdentity);
  const selection = { ...options, ...(options.expectedIdentity !== undefined || staticAssets.identity === undefined
    ? {} : { expectedIdentity: staticAssets.identity }) };
  let busy = false;
  await ctx.plugin(TypertRegistry);
  await ctx.plugin(RemoteAccessService);
  await ctx.plugin(TypertGatewayService, {});
  ctx.typert.register(diagnosticsHostContribution);
  new DiagnosticsService(ctx, async () => {
    if (busy) return { status: "blocked", sessionAdmission: "blocked", code: "PREFLIGHT_BUSY", missingCapabilities: [] };
    busy = true;
    try { return await inspectDiagnostics(selection, lifetime.signal); } finally { busy = false; }
  });
  const events=new DshEventsCarrier(ctx,"/diagnostics");
  const server = Bun.serve<DshSocketData>({
    hostname: "127.0.0.1", port: options.port ?? 3180, maxRequestBodySize: 16_384,
    async fetch(request, carrier) {
      const path = new URL(request.url).pathname;
      if (!permittedFixtureOrigin(request, carrier.url.origin)) return new Response("Forbidden", { status: 403 });
      if (path === "/api/remote.mux") return events.upgrade(request,carrier);
      if (path === "/api/ompDiagnostics/preflight" && request.method === "POST") {
        if (request.headers.get("origin") !== carrier.url.origin) return new Response("Forbidden", { status: 403 });
        return dispatch(request, ctx, events.owner);
      }
      if (path.startsWith("/api/")) return new Response("Private Session admission is blocked", { status: 501 });
      if (request.method === "GET" && path === "/healthz") {
        return Response.json({ service: "omp-webui-host", status: "ok", stage: "diagnostics-only", sessionAdmission: "blocked" });
      }
      if (request.method !== "GET" || !["/", "/client.js"].includes(path)) return new Response("Not found", { status: 404 });
      return staticAssets.response(path === "/" ? "index.html" : "client.js");
    },
    websocket:events.websocket,
  });
  return {
    server,
    async stop(): Promise<void> {
      lifetime.abort();
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
    if (envelope.method !== "ompDiagnostics/preflight") throw new Error("endpoint mismatch");
    const payload = emptyPayload.parse(envelope.payload);
    const method = diagnosticsContribution.methods["ompDiagnostics/preflight"];
    method?.input({ strict: true }).create().parse(payload.args);
    const value = await ctx.typertGateway.invoke({ namespace: "ompDiagnostics", method: "preflight",
      args: payload.args, peer, signal: request.signal });
    return Response.json({ type: "server-response", rpcId: envelope.rpcId, result: { ok: true, value } });
  } catch { return new Response("Invalid diagnostic request", { status: 400 }); }
}

