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
import { join, resolve } from "node:path";
import sessionContribution from "@deepseek-ai/dsh-api-session-controller/remote";
import { TYPERT } from "@deepseek-ai/dsh-api-workspace-controller/typert";
import type { TypertContribution } from "@deepseek-ai/dsh-typert-registry";
import { sessionsHostContribution } from "../../../packages/contracts/sessions.ts";
import { workspaceHostContribution } from "../../../packages/contracts/workspaces.ts";
import { SessionIndex } from "../../../packages/sessions/index.ts";
import { SessionSupervisor, type DirectLaunchOptions, type OwnedLaunchOptions } from "../../../packages/sessions/supervisor.ts";
import { sessionStatusEvents } from "../../../packages/sessions/status-events.ts";
import { SessionsService, sessionCaller } from "../../../packages/sessions/service.ts";
import { SessionPresentationService } from "../../../packages/sessions/presentation-service.ts";
import { StockWorkspaceService } from "../../../packages/workspaces/stock-service.ts";
import {createChatSessionDispatch, dispatchSessionRequest as dispatch, sessionUnary as unary,
  chatMethods, isSuccessfulSessionReply, preferenceMethods, commandsMethods, type ChatSessionDispatch } from "./session-remote-dispatch.ts";
import { chatHostContribution } from "../../../packages/contracts/chat.ts";
import { chatComponentHostContribution } from "../../../packages/contracts/chat-component.ts";
import { ChatAttachService, ChatCancelService, ChatLookupService, ChatPromptService } from "../../../packages/chat/service.ts";
import { ChatViewAdmission } from "./chat-view-admission.ts";
import { ChatComponentRuntime } from "./chat-component-runtime.ts";
import { preferencesHostContribution, WebPreferences } from "../../../packages/preferences/service.ts";
import { commandsHostContribution, CommandsService } from "../../../packages/commands/service.ts";
import { ChatAttachmentAuthority } from "./chat-attachment-authority.ts";
import { FileUploadsRemote, StockUploads, stockUploadsHostContribution } from "./stock-uploads.ts";
import { OriginalStore } from "../../../packages/attachments/store.ts";
import { AttachmentRemote } from "../../../packages/attachments/service.ts";
import { AttachmentBridge } from "../../../packages/attachments/bridge.ts";
import { AttachmentSubmissionGate } from "../../../packages/attachments/submission-gate.ts";
import { installAttachmentRemote } from "../../../packages/attachments/remote.ts";
import { attachmentHostContribution } from "../../../packages/contracts/attachments.ts";
import { treeHostContribution } from "../../../packages/contracts/tree.ts";
import { stopHostContribution } from "../../../packages/contracts/stop.ts";
import { retryHostContribution } from "../../../packages/contracts/manual-retry.ts";
import { StopService } from "../../../packages/interactions/stop-service.ts";
import { RetryService } from "../../../packages/manual-retry/remote-service.ts";
import { ReadonlyTree } from "../../../packages/tree/service.ts";
import { historyNavigationSourceHostContribution } from "../../../packages/contracts/history-navigation-source.ts";
import { HistoryNavigationSource } from "../../../packages/history-navigation-source/service.ts";
import { createNavigationPorts } from "./navigation-ports.ts";
import { dispatchWorkspaceRequest, WorkspaceService } from "./workspace-component-server.ts";
import { originalHistoryImages, originalHistoryResponse } from "./original-history.ts";
import type { SessionImages } from "../../../packages/projection/history-images.ts";
const streams = new Set(["$events", "session/follow", "session/control", "workspace/follow", "remoteAccess/follow"]);
// The stock roster holds five independent streams open at once (`remoteAccess`, `workspace`, `$events`,
// `session/control`, `session/follow`); extra openings are refused per stream, never by killing the mux.
const MAX_STREAMS_PER_SOCKET = 16;
const objectReplies = new Set(["/api/ompSessions/open", "/api/ompSessions/switch", "/api/ompSessions/new",
  "/api/ompSessions/view", "/api/ompSessions/recheck", "/api/ompSessions/answer", "/api/session/page", "/api/session/projections",
  "/api/session/create"]);
import type { CatalogClient } from "../../../packages/contracts/generated/catalog-client.ts";
import type { InstallationSelection } from "../../../packages/compatibility/installation.ts";
import { trustedDiagnosticAssets, trustedProductAssets } from "../../../packages/compatibility/assets.ts";
import { configuredOrigin } from "../../../packages/access/trust.ts";
import { openBrowserAccess, type BrowserAccess } from "../../../packages/access/index.ts";
import { DirectoryGrants } from "../../../packages/workspaces/grants.ts";
import type { InteractionBroker } from "../../../packages/interactions/broker.ts";
import { InteractionBrokerCarrier, type BrokerStream, type InteractionBrokerMode } from "./interaction-broker-carrier.ts";
interface CarrierOptions extends InstallationSelection {
  port?: number; assets?: string; catalog: CatalogClient; dataDir: string;
  /** Opt-in lifecycle owned by this isolated carrier. Unary mode uses one Browser View per credential. */
  interactionBroker?: InteractionBroker;
  interactionBrokerMode?: InteractionBrokerMode;
  /** Opt-in component Chat over the same explicitly opened worker. Product admission stays blocked. */
  chat?: true;
  /** Product Host: require independently trusted assets and report real admission instead of the fixture stage. */
  product?: true;
  /** Exact browser origin used for bootstrap links and Origin checks; listener stays loopback-only. */
  origin?: string;
}
/** Exactly one launcher, inherited either from an option class or from an object literal. */
type Options = (CarrierOptions & DirectLaunchOptions) | (CarrierOptions & OwnedLaunchOptions);
interface SocketData {
  peer: Peer; identity: BrowserAccess; detach?: () => void; streams: Map<string, AbortController>;
  brokerEvents?: AbortController;
}
type StreamOpen = Extract<RemoteStreamClientMessage, { type: "open" }>;
class FixtureStreamWriteError extends Error {}
/** Frozen route keys carry literal `@`; browsers percent-encode it in asset URLs. */
function decoded(target: string): string {
  try { return decodeURIComponent(target); } catch { return target; }
}
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
  const staticAssets = options.product
    ? await trustedProductAssets(options.manifest, assets, options.expectedIdentity ?? "")
    : await trustedDiagnosticAssets(options.manifest, assets, options.expectedIdentity);
  /** Request target → enrolled file, from the frozen route table the product build emitted. */
  const routes = options.product
    ? new Map(Object.entries(JSON.parse(new TextDecoder().decode(await staticAssets.bytes("plugins/routes.json"))) as Record<string, string>))
    : undefined;
  await ctx.plugin(TypertRegistry);
  await ctx.plugin(RemoteAccessService);
  await ctx.plugin(TypertGatewayService, {});
  ctx.typert.register(sessionsHostContribution);
  ctx.typert.register({ ...workspaceHostContribution, invocations: workspaceHostContribution.invocations.filter(method =>
    method.namespace === "ompWorkspaces" && method.method === "registered") });
  const promptDescriptor = sessionContribution.descriptors.find(method => method.namespace === "session" && method.method === "prompt");
  const cancelDescriptor = sessionContribution.descriptors.find(method => method.namespace === "session" && method.method === "cancel");
  ctx.typert.register({ package: sessionContribution.package, face: "host", schemas: [],
    model: { services: [], events: [], objects: [] }, invocations: sessionContribution.descriptors.filter(method =>
      !(options.chat && (promptDescriptor && method.id === promptDescriptor.id
        || cancelDescriptor && method.id === cancelDescriptor.id))) });
  const workspaceContribution = TYPERT as unknown as TypertContribution;
  // Workspace verbs only: the stock directory picker stays unserved rather than inventing a native dialog.
  ctx.typert.register({ ...workspaceContribution, invocations: workspaceContribution.invocations.filter(method =>
    method.namespace === "workspace") });
  const directories = new DirectoryGrants(options.dataDir);
  const index = new SessionIndex(options.dataDir);
  new WorkspaceService(ctx, options.catalog, directories, index);
  let unregister: (() => Promise<void>) | undefined;
  const peers = new Set<Peer>();
  const sockets = new Set<ServerWebSocket<SocketData>>();
  const owner = new Peer(ctx, { principal: { kind: "owner" } });

  let inflight = 0;
  let stopping = false;
  let supervisor: SessionSupervisor;
  let chatComposition: { runtime: ChatComponentRuntime; dispatch: ChatSessionDispatch } | undefined;
  let attachmentStore: OriginalStore | undefined;
  let stockUploads: StockUploads | undefined;
  let readonlyTree: ReadonlyTree | undefined;
  let stockImages: SessionImages | undefined;
  let expirySweep: Timer | undefined;
  const stockUnary = ["session/create", "session/modelCatalog", "session/selectModel"];
  let unaryMethods = new Set([...unary, ...stockUnary]);
  const chatEndpoints = new Set(Object.keys(chatMethods).map(method => `/api/${method}`));
  let revokedStop: Promise<void> | undefined;
  let access: ReturnType<typeof openBrowserAccess>;
  let origin: URL;
  let interactionCarrier: InteractionBrokerCarrier | undefined;
  const interactionBroker = options.interactionBroker;
  const server = Bun.serve<SocketData>({
    // The strict reader still enforces 2 MiB for prompt work and 16 MiB for one base64 image original.
    hostname: "127.0.0.1", port: options.port ?? 3180, maxRequestBodySize: 20 * 1024 * 1024,
    async fetch(request, carrier) {
      if (stopping) return new Response("Host closing", { status: 503 });
      const path = new URL(request.url).pathname;
      if (path !== "/" || new URL(request.url).searchParams.has("bootstrap")) {
        const auth = await access.handle(request);
        if (auth) return auth;
      }
      if ((path === "/" || path.startsWith("/api/")) && path !== "/api/session/uploadFileBinary") {
        const identity = access.admit(request, path === "/api/remote.mux" ? "websocket"
          : request.method === "POST" ? "write" : "read");
        if (identity instanceof Response) return identity;
      }
      if (path === "/api/remote.mux") {
        if (request.headers.get("origin") !== origin.origin || peers.size >= 8) {
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
      if (path === "/api/ompOriginals/history" || path === "/api/ompOriginals/original") {
        if (!attachmentStore) return new Response("Not found", { status: 404 });
        return originalHistoryResponse(request, {
          admit: value => access.admit(value, "read"),
          session: (identity, sessionId) => {
            const tree = supervisor.treeAccess(identity, sessionId);
            return { history: tree.history, scope: { hostId: access.hostId, browserId: identity.credentialId,
              pageId: identity.credentialId, profileId: access.hostId, sourceId: tree.sourceId,
              instanceId: tree.instanceId, sessionId, canonicalCwd: tree.cwd, authorityEpoch: tree.epoch } };
          },
          retains: (sessionId, entryId) => readonlyTree?.retains(sessionId, entryId),
          store: attachmentStore,
        });
      }
      if (path === "/api/session/uploadFileBinary") {
        if (request.headers.get("origin") !== origin.origin) return new Response("Forbidden", { status: 403 });
        // Stock uploads arrive from a blob Worker that only sends cookies, content-type and Origin.
        const identity = access.admit(request, "write", false);
        if (identity instanceof Response) return identity;
        if (!stockUploads) return new Response("Not found", { status: 404 });
        return stockUploads.handle(identity, request);
      }
      const registeredWorkspace = path === "/api/ompWorkspaces/registered";
      const brokerRoute = interactionCarrier?.handles(path) ? interactionCarrier : undefined;
      if ((brokerRoute || registeredWorkspace || [...unaryMethods].some(method => path === `/api/${method}`))
        && request.method === "POST") {
        if (request.headers.get("origin") !== origin.origin) return new Response("Forbidden", { status: 403 });
        const identity = access.admit(request, "write");
        if (identity instanceof Response) return identity;
        if (inflight >= 32) return Response.json({ error: { code: "SESSION_REQUEST_LIMIT" } }, { status: 429 });
        ++inflight;
        try {
          if (brokerRoute) return await brokerRoute.dispatch(request, identity);
          if (chatComposition && chatEndpoints.has(path)) return chatComposition.dispatch(request, ctx, owner);
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
        return Response.json({ service: "omp-webui-host", status: "ok",
          stage: options.product ? "product" : "isolated-session-component",
          sessionAdmission: options.product ? "admitted" : "blocked" });
      }
      if (request.method !== "GET") return new Response("Not found", { status: 404 });
      const target = path + new URL(request.url).search;
      const enrolled = path === "/" ? "index.html" : routes?.get(target) ?? routes?.get(decoded(target))
        ?? (path === "/client.js" ? "client.js" : undefined);
      if (enrolled === undefined) return new Response("Not found", { status: 404 });
      return staticAssets.response(enrolled);
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
          if (frame.type !== "open") return;
          const brokerStream = interactionCarrier?.streamKind(frame.endpoint);
          if ((!streams.has(frame.endpoint) && !brokerStream) ||
            socket.data.streams.size >= MAX_STREAMS_PER_SOCKET || socket.data.streams.has(frame.streamId)) {
            // Refuse only the offending stream: closing the socket would abort the stock roster's siblings.
            try {
              sendFrame(socket, { type: "error", streamId: frame.streamId,
                error: ctx.typertGateway.wireStream.failure(
                  new RemoteError("gateway/service-unavailable", "This connection cannot open another stream.", { endpoint: frame.endpoint })) }, true);
            } catch { socket.close(1011, "stream failure could not be delivered"); }
            return;
          }
          const current = () => {
            if (!access.revalidate(socket.data.identity)) return false;
            if (frame.endpoint === "session/follow") {
              try { supervisor.assertObjectAccess(socket.data.identity); } catch { return false; }
            }
            return true;
          };
          void runFixtureStream(socket, frame, ctx, current, interactionCarrier, brokerStream)
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
  origin = configuredOrigin(options.origin ?? server.url.origin);
  access = openBrowserAccess({ dataDir: options.dataDir, origin: origin.origin });
  if (interactionBroker) interactionCarrier = new InteractionBrokerCarrier(ctx, access, interactionBroker,
    options.interactionBrokerMode);
  const { launch, launchOwned } = options;
  supervisor = new SessionSupervisor({ authority: access, grants: directories, index, catalog: options.catalog,
    onBranch: (_identity, previous, native, entryIds) => {
      attachmentStore?.inheritBranchLinks(previous.sessionId, previous.instanceId, native.sessionId, native.instanceId, entryIds);
    },
    ...(launchOwned === undefined ? { launch } : { launchOwned }) });
  unregister = ctx.typertGateway.registerRemoteEvents(
    sessionStatusEvents(listener => supervisor.subscribeStatus(listener)), { home: "/" });
  let stockWorkspaces: StockWorkspaceService;
  const sessionsService = new SessionsService(ctx, { authority: access, grants: directories, index,
    catalog: options.catalog, supervisor, workspacePath: id => stockWorkspaces.pathOf(id) });
  new SessionPresentationService(ctx, supervisor, sessionsService, () => stockWorkspaces?.changed(),
    () => stockImages);
  stockWorkspaces = new StockWorkspaceService(ctx, directories, sessionsService, supervisor);
  if (options.chat) {
    ctx.typert.register({ ...chatHostContribution, invocations: [...chatHostContribution.invocations,
      ...(promptDescriptor ? [{ ...promptDescriptor, service: "chatPrompt" }] : []),
      ...(cancelDescriptor ? [{ ...cancelDescriptor, service: "chatCancel" }] : [])] });
    ctx.typert.register(chatComponentHostContribution);
    const admission = new ChatViewAdmission(access, directories, supervisor);
    let gate: AttachmentSubmissionGate | undefined;
    attachmentStore = new OriginalStore({ dataDir: join(options.dataDir, "attachments"), recovery: "exclusive-host-startup",
      // Late-bound: startup recovery runs before the gate exists, and an absent gate must refuse deletion.
      protection: original => gate?.protection(original.binding, original.objectId) ?? { status: "unknown" } });
    stockImages = originalHistoryImages({ store: attachmentStore,
      session: (identity, sessionId) => {
        const tree = supervisor.treeAccess(identity, sessionId);
        return { history: tree.history, scope: { hostId: access.hostId, browserId: identity.credentialId,
          pageId: identity.credentialId, profileId: access.hostId, sourceId: tree.sourceId,
          instanceId: tree.instanceId, sessionId, canonicalCwd: tree.cwd, authorityEpoch: tree.epoch } };
      },
      retains: (sessionId, entryId) => readonlyTree?.retains(sessionId, entryId) });
    let runtime: ChatComponentRuntime;
    const authority = new ChatAttachmentAuthority(access, () => runtime, attachmentStore);
    stockUploads = new StockUploads(authority, () => runtime);
    const bridge = new AttachmentBridge(authority, target => runtime.native(target));
    gate = new AttachmentSubmissionGate(bridge, attempt => authority.authorizeAttempt(attempt));
    // Restart never resets the staged clock: drain the persisted inventory in bounded pages before serving.
    attachmentStore.collectExpiredPages(32);
    // ponytail: one bounded pass per minute; replace with an activityAt index if 100k-row scans matter.
    expirySweep = setInterval(() => {
      try { attachmentStore?.collectExpiredPages(4); }
      catch (error) { console.error("ATTACHMENT_EXPIRY_SWEEP_FAILED", error); }
    }, 60_000);
    expirySweep.unref?.();
    ctx.typert.register(attachmentHostContribution);
    new AttachmentRemote(ctx, attachmentStore, (_peer, target) => authority.scope(target));
    installAttachmentRemote(ctx, gate);
    runtime = new ChatComponentRuntime(access, directories, supervisor, admission, gate, stockUploads);
    new ChatPromptService(ctx, sessionId => runtime.gateway(sessionId));
    new ChatCancelService(ctx, sessionId => runtime.gateway(sessionId));
    new ChatLookupService(ctx, sessionId => runtime.gateway(sessionId));
    new ChatAttachService(ctx, input => {
      const identity = sessionCaller.getStore(); return identity ? runtime.attach(identity, input) : undefined;
    });
    ctx.typert.register(treeHostContribution);
    ctx.typert.register(stopHostContribution);
    new StopService(ctx);
    ctx.typert.register(retryHostContribution);
    new RetryService(ctx);
    readonlyTree = new ReadonlyTree(ctx, (_peer, sessionId) => {
      const identity = sessionCaller.getStore();
      if (!identity || !access.revalidate(identity)) throw new Error("TREE_AUTHORITY_UNAVAILABLE");
      return supervisor.treeAccess(identity, sessionId);
    });
    ctx.typert.register(historyNavigationSourceHostContribution);
    new HistoryNavigationSource(ctx, createNavigationPorts({ supervisor, runtime, dataDir: options.dataDir,
      identity: () => sessionCaller.getStore(), revalidate: identity => access.revalidate(identity) }));
    ctx.typert.register(preferencesHostContribution);
    new WebPreferences(ctx, () => {
      const identity = sessionCaller.getStore();
      if (!identity || !access.revalidate(identity)) throw new Error("WEBUI_PREFERENCE_AUTHORITY");
    });
    ctx.typert.register(commandsHostContribution);
    ctx.typert.register(stockUploadsHostContribution);
    new FileUploadsRemote(ctx, stockUploads);
    new CommandsService(ctx, sessionId => {
      const identity = sessionCaller.getStore();
      if (!identity || !access.revalidate(identity)) return undefined;
      return supervisor.commandsAccess(identity, sessionId);
    });
    chatComposition = { runtime, dispatch: createChatSessionDispatch(admission,
      (_request, identity) => runtime.enrollment(identity), identity => runtime.stopBinding(identity),
      identity => runtime.retryBinding(identity)) };
    unaryMethods = new Set([...unary, ...stockUnary, ...Object.keys(preferenceMethods),
      ...Object.keys(commandsMethods), "ompChatComponent/attach", ...Object.keys(chatMethods)]);
  }
  const detachRevocation = access.onRevokeAll(() => {
    chatComposition?.runtime.close();
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
      if (expirySweep !== undefined) clearInterval(expirySweep);
      expirySweep = undefined;
      chatComposition?.runtime.close();
      attachmentStore?.close();
      attachmentStore = undefined;
      const draining = supervisor.close(); access.close(); detachRevocation();
      interactionBroker?.close();
      await draining; directories.close(); index.close();
      for (const socket of sockets) socket.close(1001, "Host shutdown");
      await unregister?.();
      await ctx.fiber.dispose();
      await server.stop(true);
    },
  };
}


function abortStreams(socket: ServerWebSocket<SocketData>): void {
  for (const control of socket.data.streams.values()) control.abort();
}

async function runFixtureStream(socket: ServerWebSocket<SocketData>, frame: StreamOpen, ctx: Context,
  current: () => boolean, broker?: InteractionBrokerCarrier, kind?: BrokerStream): Promise<void> {
  const { peer, identity, streams } = socket.data;
  const control = new AbortController();
  const events = frame.endpoint === "$events" ? broker : undefined;
  const sharedEvents = events?.mode !== undefined;
  const duplicateEvents = sharedEvents && socket.data.brokerEvents !== undefined;
  if (sharedEvents && !duplicateEvents) socket.data.brokerEvents = control;
  streams.set(frame.streamId, control);
  const terminal = sharedEvents || kind !== undefined;
  try {
    if (duplicateEvents) throw new Error("Interaction event stream already admitted");
    await sessionCaller.run(identity, () => broker && kind
      ? broker.runStream(kind, frame.payload, peer, identity, control.signal,
        (authorized, lifetime) => pump(socket, frame, lifetime, ctx, authorized, true))
      : pump(socket, frame, control.signal, ctx, current, terminal,
        events && (value => events.ready(value, peer, identity, control.signal))));
  } catch (error) {
    // A client cancel aborts only that stream. The DSH client cancels streams in flight on reconnect,
    // and treating that abort as socket-fatal would kill every other stream and loop the connection.
    if (control.signal.aborted || socket.readyState !== WebSocket.OPEN) return;
    try {
      if (error instanceof FixtureStreamWriteError) throw error;
      // A failed stream is a typed failure for that stream only. The stock roster multiplexes five
      // streams on one socket, so closing the carrier here would also tear down its siblings.
      const failure = kind !== undefined || events !== undefined
        ? new RemoteError("gateway/internal", {
          snapshot: "Interaction snapshot failed.",
          answer: "Interaction answer failed.",
          events: "Interaction event stream failed.",
        }[kind ?? "events"], {})
        : error;
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
  signal: AbortSignal, ctx: Context, current: () => boolean, terminal: boolean,
  onReady?: (value: unknown) => void): Promise<void> {
  if (!current()) throw new Error("SESSION_AUTH_REQUIRED");
  const stream = await ctx.typertGateway.wireStream.open(endpoint, payload, idle(signal), socket.data.peer, signal);
  for await (const value of stream) {
    if (!current() || signal.aborted) throw new Error("SESSION_AUTH_REQUIRED");
    if (onReady) { onReady(value); onReady = undefined; }
    sendFrame(socket, { type: "item", streamId, value }, terminal);
  }
  if (terminal) {
    if (!current()) throw new Error("SESSION_AUTH_REQUIRED");
    if (signal.aborted) return;
    sendFrame(socket, { type: "end", streamId }, terminal);
  }
}
