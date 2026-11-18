import { Context } from "@deepseek-ai/cordis";
import TypertRegistry from "@deepseek-ai/dsh-typert-registry";
import RemoteAccessService from "@deepseek-ai/dsh-api-remote-access";
import { TypertGatewayService } from "@deepseek-ai/dsh-api-gateway";
import { Peer } from "@deepseek-ai/dsh-client-connection";
import {
  parseRemoteStreamClientMessage, type RemoteStreamClientMessage, type RemoteStreamServerMessage,
} from "@deepseek-ai/dsh-api-gateway/stream-protocol";
import { RemoteError } from "@deepseek-ai/dsh-typert-protocol";
import type { ServerWebSocket } from "bun";
import { resolve } from "node:path";
import sessionContribution from "@deepseek-ai/dsh-api-session-controller/remote";
import { sessionsHostContribution } from "../../../packages/contracts/sessions.ts";
import { workspaceHostContribution } from "../../../packages/contracts/workspaces.ts";
import { SessionIndex } from "../../../packages/sessions/index.ts";
import { SessionSupervisor, type SessionLaunchOptions } from "../../../packages/sessions/supervisor.ts";
import { SessionsService, sessionCaller } from "../../../packages/sessions/service.ts";
import { SessionPresentationService } from "../../../packages/sessions/presentation-service.ts";
import { dispatchSessionRequest as dispatch, sessionUnary as unary, isSuccessfulSessionReply } from "./session-remote-dispatch.ts";
import { dispatchWorkspaceRequest, WorkspaceService } from "./workspace-component-server.ts";
const streams = new Set(["$events", "session/follow", "session/control"]);
const objectReplies = new Set(["/api/ompSessions/open", "/api/ompSessions/switch", "/api/ompSessions/new",
  "/api/ompSessions/view", "/api/ompSessions/recheck", "/api/ompSessions/answer", "/api/session/page", "/api/session/projections"]);
import type { CatalogClient } from "../../../packages/contracts/generated/catalog-client.ts";
import type { InstallationSelection } from "../../../packages/compatibility/installation.ts";
import { trustedDiagnosticAssets } from "../../../packages/compatibility/assets.ts";
import { openBrowserAccess, type BrowserAccess } from "../../../packages/access/index.ts";
import { DirectoryGrants } from "../../../packages/workspaces/grants.ts";
import type { InteractionBroker } from "../../../packages/interactions/broker.ts";
import { brokerPendingSnapshotEndpoint } from "../../../packages/contracts/interaction-broker.ts";
import { InteractionBrokerCarrier } from "./interaction-broker-carrier.ts";
type Options = InstallationSelection & SessionLaunchOptions & {
  port?: number; assets?: string; catalog: CatalogClient; dataDir: string;
  /** Opt-in lifecycle owned by this isolated carrier. Unary mode uses one Browser View per credential. */
  interactionBroker?: InteractionBroker;
  interactionBrokerMode?: "shared-cookie-snapshot";
};
interface SocketData {
  peer: Peer; identity: BrowserAccess; detach?: () => void; streams: Map<string, AbortController>;
  brokerEvents?: AbortController;
}
type StreamOpen = Extract<RemoteStreamClientMessage, { type: "open" }>;
class FixtureStreamWriteError extends Error {}
async function* idle(signal: AbortSignal): AsyncGenerator<never> {
  const done = Promise.withResolvers<void>();
  const abort = () => { done.resolve(); };
  signal.addEventListener("abort", abort, { once: true });
  try { if (!signal.aborted) await done.promise; }
  finally { signal.removeEventListener("abort", abort); }
}

/** Loopback diagnostics carrier. No private Session or general Remote routes are mounted. */
export async function startSessionComponentServer(options: Options) {
  const ctx = new Context();
  const assets = resolve(options.assets ?? "vendor/dsh-sessions");
  const staticAssets = await trustedDiagnosticAssets(options.manifest, assets);
  await ctx.plugin(TypertRegistry);
  await ctx.plugin(RemoteAccessService);
  await ctx.plugin(TypertGatewayService, {});
  ctx.typert.register(sessionsHostContribution);
  ctx.typert.register({ ...workspaceHostContribution, invocations: workspaceHostContribution.invocations.filter(method =>
    method.namespace === "ompWorkspaces" && method.method === "registered") });
  ctx.typert.register({ package: sessionContribution.package, face: "host", schemas: [],
    model: { services: [], events: [], objects: [] }, invocations: sessionContribution.descriptors });
  const directories = new DirectoryGrants(options.dataDir);
  const index = new SessionIndex(options.dataDir);
  new WorkspaceService(ctx, options.catalog, directories, index);
  const unregister = ctx.typertGateway.registerRemoteEvents(idle, { home: "/" });
  const peers = new Set<Peer>();
  const sockets = new Set<ServerWebSocket<SocketData>>();
  const owner = new Peer(ctx, { principal: { kind: "owner" } });

  let inflight = 0;
  let stopping = false;
  let supervisor: SessionSupervisor;
  let revokedStop: Promise<void> | undefined;
  let access: ReturnType<typeof openBrowserAccess>;
  let interactionCarrier: InteractionBrokerCarrier | undefined;
  const interactionBroker = options.interactionBroker;
  const server = Bun.serve<SocketData>({
    hostname: "127.0.0.1", port: options.port ?? 3180, maxRequestBodySize: 16_384,
    async fetch(request, carrier) {
      if (stopping) return new Response("Host closing", { status: 503 });
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
      const registeredWorkspace = path === "/api/ompWorkspaces/registered";
      const brokerRoute = interactionCarrier?.handles(path) ? interactionCarrier : undefined;
      if ((brokerRoute || registeredWorkspace || [...unary].some(method => path === `/api/${method}`))
        && request.method === "POST") {
        if (request.headers.get("origin") !== server.url.origin) return new Response("Forbidden", { status: 403 });
        const identity = access.admit(request, "write");
        if (identity instanceof Response) return identity;
        if (inflight >= 32) return Response.json({ error: { code: "SESSION_REQUEST_LIMIT" } }, { status: 429 });
        ++inflight;
        try {
          if (brokerRoute) return await brokerRoute.dispatch(request, identity);
          const current = () => access.revalidate(identity);
          const response = registeredWorkspace ? await dispatchWorkspaceRequest(request, ctx, owner, current)
            : await sessionCaller.run(identity, () => dispatch(request, ctx, owner, current));
          if (!current()) return new Response("Access invalidated", { status: 401 });
          if (objectReplies.has(path) && isSuccessfulSessionReply(response)) { try { supervisor.assertObjectAccess(identity); }
            catch { return new Response("Session access invalidated", { status: 403 }); } }
          return response;
        } finally { --inflight; }
      }
      if (path.startsWith("/api/")) return new Response("Private Session admission is blocked", { status: 501 });
      if (request.method === "GET" && path === "/healthz") {
        return Response.json({ service: "omp-webui-host", status: "ok", stage: "isolated-session-component", sessionAdmission: "blocked" });
      }
      if (request.method !== "GET" || !["/", "/client.js"].includes(path)) return new Response("Not found", { status: 404 });
      return staticAssets.response(path === "/" ? "index.html" : "client.js");
    },
    websocket: {
      maxPayloadLength: 16_384, idleTimeout: 60,
      open(socket) {
        sockets.add(socket);
        socket.data.detach = access.attachPeer(socket.data.identity, () => {
          abortStreams(socket);
          socket.close(4001, "Access invalidated");
        });
      },
      message(socket, bytes) {
        if (!access.revalidate(socket.data.identity)) { socket.close(4001, "Access invalidated"); return; }
        try {
          const text = typeof bytes === "string" ? bytes : new TextDecoder("utf-8", { fatal: true }).decode(bytes);
          const frame = parseRemoteStreamClientMessage(text);
          if (frame.type === "cancel") { socket.data.streams.get(frame.streamId)?.abort(); return; }
          const snapshot = frame.type === "open" && frame.endpoint === brokerPendingSnapshotEndpoint &&
            interactionCarrier?.sharedSnapshot ? interactionCarrier : undefined;
          if (frame.type !== "open" || (!streams.has(frame.endpoint) && !snapshot) ||
            socket.data.streams.size >= 4 || socket.data.streams.has(frame.streamId)) {
            socket.close(1008, "diagnostics streams only"); return;
          }
          const events = frame.endpoint === "$events" ? interactionCarrier : undefined;
          const current = () => {
            if (!access.revalidate(socket.data.identity)) return false;
            if (frame.endpoint === "session/follow") {
              try { supervisor.assertObjectAccess(socket.data.identity); } catch { return false; }
            }
            return true;
          };
          void runFixtureStream(socket, frame, ctx, current, events, snapshot)
            .catch(() => socket.close(1011, "stream failed"));
        } catch { socket.close(1008, "invalid stream frame"); }
      },
      close(socket) {
        sockets.delete(socket); socket.data.detach?.();
        abortStreams(socket);
        peers.delete(socket.data.peer);
        void socket.data.peer.dispose();
      },
    },
  });
  access = openBrowserAccess({ dataDir: options.dataDir, origin: server.url.origin });
  if (interactionBroker) interactionCarrier = new InteractionBrokerCarrier(ctx, access, interactionBroker,
    options.interactionBrokerMode === "shared-cookie-snapshot");
  const { launch, launchOwned } = options;
  supervisor = new SessionSupervisor({ authority: access, grants: directories, index, catalog: options.catalog,
    ...(launchOwned === undefined ? { launch } : { launchOwned }) });
  new SessionsService(ctx, { authority: access, grants: directories, index, catalog: options.catalog, supervisor });
  new SessionPresentationService(ctx, supervisor);
  const detachRevocation = access.onRevokeAll(() => {
    const brokerStop = interactionCarrier?.revokeAll();
    revokedStop = Promise.allSettled([supervisor.revokeAll(), brokerStop]).then(results => {
      for (const result of results) if (result.status === "rejected") throw result.reason;
    });
    void revokedStop.catch(() => {});
  });
  return {
    server, supervisor, index,
    async revokeAll(): Promise<void> {
      try { access.revokeAll(); }
      finally { await revokedStop; }
    },
    bootstrapLink: () => access.bootstrapLink(),
    async stop(): Promise<void> {
      stopping = true;
      const draining = supervisor.close(); access.close(); detachRevocation();
      interactionBroker?.close();
      await draining; directories.close(); index.close();
      for (const socket of sockets) socket.close(1001, "Host shutdown");
      await unregister();
      await ctx.fiber.dispose();
      await server.stop(true);
    },
  };
}


function abortStreams(socket: ServerWebSocket<SocketData>): void {
  for (const control of socket.data.streams.values()) control.abort();
}

async function runFixtureStream(socket: ServerWebSocket<SocketData>, frame: StreamOpen, ctx: Context,
  current: () => boolean, events?: InteractionBrokerCarrier, snapshot?: InteractionBrokerCarrier): Promise<void> {
  const { peer, identity, streams } = socket.data;
  const control = new AbortController();
  const sharedEvents = events?.sharedSnapshot === true;
  const duplicateEvents = sharedEvents && socket.data.brokerEvents !== undefined;
  if (sharedEvents && !duplicateEvents) socket.data.brokerEvents = control;
  streams.set(frame.streamId, control);
  const terminal = sharedEvents || snapshot !== undefined;
  try {
    if (duplicateEvents) throw new Error("Interaction event stream already admitted");
    await sessionCaller.run(identity, () => snapshot
      ? snapshot.runSnapshot(peer, identity, control.signal, authorized => pump(socket, frame, control, ctx, authorized, true))
      : pump(socket, frame, control, ctx, current, terminal,
        events && (value => events.ready(value, peer, identity, control.signal))));
  } catch (error) {
    if (!terminal) throw error;
    if (control.signal.aborted || socket.readyState !== WebSocket.OPEN) return;
    try {
      if (error instanceof FixtureStreamWriteError) throw error;
      const failure = new RemoteError("gateway/internal", snapshot
        ? "Interaction snapshot failed." : "Interaction event stream failed.", {});
      sendFrame(socket, { type: "error", streamId: frame.streamId, error: ctx.typertGateway.wireStream.failure(failure) }, true);
    } catch {
      socket.close(1011, "stream failed");
    }
  } finally {
    control.abort();
    streams.delete(frame.streamId);
    if (socket.data.brokerEvents === control) delete socket.data.brokerEvents;
  }
}

function sendFrame(socket: ServerWebSocket<SocketData>, frame: RemoteStreamServerMessage,
  requireDelivery: boolean): void {
  const message = JSON.stringify(frame);
  let sent: number;
  try { sent = socket.send(message); }
  catch (error) {
    if (!requireDelivery) throw error;
    throw new FixtureStreamWriteError("Diagnostic stream write failed", { cause: error });
  }
  // A nonempty 0 is dropped. A -1 may already be queued, so close the socket without sending another terminal.
  if (requireDelivery && sent <= 0) throw new FixtureStreamWriteError("Diagnostic stream delivery failed");
  if (sent < 0) throw new Error("slow diagnostic viewer");
}

async function pump(socket: ServerWebSocket<SocketData>, { streamId, endpoint, payload }: StreamOpen,
  control: AbortController, ctx: Context, current: () => boolean, terminal: boolean,
  onReady?: (value: unknown) => void): Promise<void> {
  if (!current()) throw new Error("SESSION_AUTH_REQUIRED");
  const stream = await ctx.typertGateway.wireStream.open(endpoint, payload, idle(control.signal),
    socket.data.peer, control.signal);
  for await (const value of stream) {
    if (!current() || control.signal.aborted) throw new Error("SESSION_AUTH_REQUIRED");
    if (onReady) { onReady(value); onReady = undefined; }
    sendFrame(socket, { type: "item", streamId, value }, terminal);
  }
  if (terminal && !control.signal.aborted) {
    if (!current()) throw new Error("SESSION_AUTH_REQUIRED");
    sendFrame(socket, { type: "end", streamId }, terminal);
  }
}
