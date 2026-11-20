import type { Context } from "@deepseek-ai/cordis";
import { type Peer, clientRequestSchema } from "@deepseek-ai/dsh-client-connection";
import sessionContribution from "@deepseek-ai/dsh-api-session-controller/remote";
import { z } from "zod";
import type { BrowserAccess } from "../../../packages/access/index.ts";
import { chatRequestFailure } from "../../../packages/chat/service.ts";
import { chatContribution } from "../../../packages/contracts/chat.ts";
import { chatComponentContribution } from "../../../packages/contracts/chat-component.ts";
import { sessionsContribution } from "../../../packages/contracts/sessions.ts";
import { attachmentsContribution } from "../../../packages/contracts/attachment-remote.ts";
import { treeContribution } from "../../../packages/contracts/tree.ts";
import { historyNavigationSourceContribution } from "../../../packages/contracts/history-navigation-source.ts";
import { stopContribution } from "../../../packages/contracts/stop.ts";
import { stopCaller, type StopCaller } from "../../../packages/interactions/stop-service.ts";
import { attachmentContribution } from "../../../packages/contracts/attachments.ts";
import { sessionFailure } from "../../../packages/sessions/errors.ts";
import { sessionCaller } from "../../../packages/sessions/service.ts";
import { ChatBodyError, hasCurrentChatAuthority, readChatRequestBody } from "./chat-request-body.ts";
import { preferencesHostContribution } from "../../../packages/preferences/service.ts";
import type { ChatViewAdmission, ChatViewEnrollment } from "./chat-view-admission.ts";

export const preferenceMethods = Object.fromEntries(preferencesHostContribution.invocations
  .map(descriptor => [`${descriptor.namespace}/${descriptor.method}`, descriptor]));
const sessionMethods = { ...sessionsContribution.methods, ...sessionContribution.methods, ...preferenceMethods,
  "ompTree/read": treeContribution.methods["ompTree/read"],
  "ompHistoryNavigationSource/action": historyNavigationSourceContribution.methods["ompHistoryNavigationSource/action"],
  "ompChatComponent/attach": chatComponentContribution.methods["ompChatComponent/attach"] };
/** Read-only tree RPC is admitted by the Chat Host without being part of a Chat presentation binding. */
const treeUnary = new Set(["ompTree/read"]);
/** Native navigation is authorized by the source service, not by a Chat presentation binding. */
const navigationUnary = new Set(["ompHistoryNavigationSource/action"]);
export const sessionUnary = new Set([...Object.keys(sessionsContribution.methods), "session/list", "session/page", "session/projections",
  "ompChatComponent/attach", ...Object.keys(preferenceMethods)]);
export const chatMethods = {
  "session/prompt": sessionContribution.methods["session/prompt"],
  "session/cancel": sessionContribution.methods["session/cancel"],
  "ompChat/lookup": chatContribution.methods["ompChat/lookup"],
  "ompChat/state": chatContribution.methods["ompChat/state"],
  ...attachmentsContribution.methods,
  "ompOriginals/exchange": attachmentContribution.methods["ompOriginals/exchange"],
  "ompTree/read": treeContribution.methods["ompTree/read"],
  "ompHistoryNavigationSource/action": historyNavigationSourceContribution.methods["ompHistoryNavigationSource/action"],
  ...stopContribution.methods,
};
const chatEndpoints = new Set(Object.keys(chatMethods).map(method => `/api/${method}`));
const successfulReplies = new WeakSet<Response>();
export const isSuccessfulSessionReply = (response: Response): boolean => successfulReplies.has(response);
const noStore = { "cache-control": "no-store" };
const invalidated = () => new Response("Access invalidated", { status: 401, headers: noStore });

/** Resolve the already attached View from Host-owned carrier state after browser admission. */
type ResolveChatView = (request: Request, identity: BrowserAccess) => ChatViewEnrollment | undefined;
type ResolveStop = (identity: BrowserAccess) => StopCaller | undefined;
type ChatBinding = NonNullable<ReturnType<ChatViewAdmission["bind"]>>;

/** Opt-in unary dispatch with an authenticated View resolver and a bounded body read. */
export type ChatSessionDispatch = (request: Request, ctx: Context, peer: Peer) => Promise<Response>;

export function createChatSessionDispatch(admission: ChatViewAdmission, resolveView: ResolveChatView,
  resolveStop?: ResolveStop): ChatSessionDispatch {
  let inflight = 0;
  return async (request, ctx, peer) => {
    const identity = admission.authority.admit(request, "write");
    if (identity instanceof Response) return identity;
    if (request.method !== "POST") return new Response("POST required", { status: 405 });
    if (!chatEndpoints.has(new URL(request.url).pathname)) return new Response("Chat unavailable", { status: 404 });
    if (inflight >= 32) return new Response("Chat request limit", { status: 429 });
    const unbound = new URL(request.url).pathname.slice(5);
    if (treeUnary.has(unbound) || navigationUnary.has(unbound)) {
      ++inflight;
      try { return await sessionCaller.run(identity, () => dispatch(request, ctx, peer, () => true)); }
      finally { --inflight; }
    }
    let binding;
    try {
      const view = resolveView(request, identity);
      if (view) binding = admission.bind(identity, view, peer, request.signal);
    } catch { return invalidated(); }
    if (!binding) return invalidated();
    const stop = resolveStop?.(identity);
    ++inflight;
    try { return await sessionCaller.run(identity, () => dispatch(request, ctx, peer, binding.current, binding, stop)); }
    finally { --inflight; }
  };
}

/** Existing Session dispatch. Chat remains unavailable without its explicit admission binding. */
export function dispatchSessionRequest(request: Request, ctx: Context, peer: Peer, current: () => boolean): Promise<Response> {
  return dispatch(request, ctx, peer, current);
}

/** Validate before invocation, preserve request correlation and sanitize failures. */
async function dispatch(request: Request, ctx: Context, peer: Peer, authority: () => boolean,
  chat?: ChatBinding, stop?: StopCaller): Promise<Response> {
  if (request.headers.get("content-type")?.split(";", 1)[0] !== "application/json") {
    return new Response("JSON required", { status: 415 });
  }
  const current = chat ? () => hasCurrentChatAuthority(authority) : authority;
  let decoded;
  try {
    const original = new URL(request.url).pathname === "/api/ompOriginals/exchange";
    const data = chat ? await readChatRequestBody(request, chat.signal, authority, original) : await request.json();
    const envelope = clientRequestSchema.parse(data);
    const method = Object.entries(chat ? chatMethods : sessionMethods).find(([name]) => name === envelope.method)?.[1];
    if (!method || (!chat && !sessionUnary.has(envelope.method) && !treeUnary.has(envelope.method) && !navigationUnary.has(envelope.method))
      || new URL(request.url).pathname !== `/api/${envelope.method}`) throw new Error("endpoint mismatch");
    const payload = z.strictObject({ args: z.record(z.string(), z.unknown()) }).parse(envelope.payload);
    const args = z.record(z.string(), z.unknown()).parse(method.input({ strict: true }).create().parse(payload.args));
    decoded = { envelope, method, args };
  } catch (error) {
    if (chat) {
      if (!current()) return invalidated();
      if (error instanceof ChatBodyError) return new Response(error.message, { status: error.status, headers: noStore });
    }
    return new Response("Invalid Session request", { status: 400 });
  }
  const { envelope, method, args } = decoded;
  if (!current()) return invalidated();
  const options = chat ? { headers: noStore } : undefined;
  try {
    const signal = chat?.signal ?? request.signal;
    signal.throwIfAborted();
    if (!current()) return invalidated();
    const invoke = () => ctx.typertGateway.invoke({ namespace: method.namespace, method: method.method, args, peer, signal });
    const value = await (chat ? chat.run(() => stop ? stopCaller.run(stop, invoke) : invoke()) : invoke());
    if (chat && !current()) return invalidated();
    const response = Response.json({ type: "server-response", rpcId: envelope.rpcId, result: { ok: true, value } }, options);
    if (!chat) successfulReplies.add(response);
    return response;
  } catch (error) {
    if (chat && !current()) return invalidated();
    const failure = (chat && chatRequestFailure(error)) ?? sessionFailure(error);
    return Response.json({ type: "server-response", rpcId: envelope.rpcId,
      result: { ok: false, error: ctx.typertGateway.wireStream.failure(failure) } }, options);
  }
}
