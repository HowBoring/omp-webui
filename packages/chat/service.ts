import { AsyncLocalStorage } from "node:async_hooks";
import type { Context } from "@deepseek-ai/cordis";
import { Remote, RemoteError, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import type { SessionCancelRequest, SessionPromptRequest } from "@deepseek-ai/dsh-api-session-controller/types";
import { chatRecovery, chatSessionId, chatState } from "../contracts/chat.ts";
import { chatAttachment, chatAttachmentResult, type ChatAttachment, type ChatAttachmentResult } from "../contracts/chat-component.ts";
import { ChatError, type ChatCaller, type ChatGateway } from "./gateway.ts";

/** The Host resolves only an explicitly open, retained worker. */
type ResolveChat = (sessionId: string) => ChatGateway | undefined;

/** Only an authenticated carrier can install the server-side capability for a Gateway invocation. */
export const chatViewCaller = new AsyncLocalStorage<ChatCaller["view"]>();

function binding(ctx: Context, resolve: ResolveChat, sessionId: string) {
  const invocation = ctx.invocation;
  const view = chatViewCaller.getStore();
  if (!view || !invocation || invocation.signal.aborted || invocation.peer.signal.aborted) throw new ChatError("authority");
  const worker = resolve(chatSessionId.parse(sessionId));
  if (!worker) throw new ChatError("authority");
  return { worker, caller: { view, peer: invocation.peer }, signal: invocation.signal };
}

class ChatRemoteError extends RemoteError<"gateway/bad-request"> {}

/** The carrier may publish these fixed, content-free service failures. */
export function chatRequestFailure(error: unknown): RemoteError | undefined {
  return error instanceof ChatRemoteError ? error : undefined;
}

function publicError(error: unknown): never {
  const code = error instanceof ChatError ? error.code : "unknown";
  if (code === "busy") {
    throw new ChatRemoteError("gateway/bad-request", "Native Session is busy. Your draft is retained.", {});
  }
  if (code === "unknown") {
    throw new ChatRemoteError("gateway/bad-request", "Submission outcome is unresolved. Check Native recovery.", {});
  }
  if (code === "cancelled") {
    throw new ChatRemoteError("gateway/bad-request", "Send attempt was cancelled before Native dispatch. Your draft is retained.", {});
  }
  throw new ChatRemoteError("gateway/bad-request", "Chat request is unavailable for this Session view.", {});
}

/** Unregistered prompt delegate for the public DSH session/prompt method. */
export class ChatPromptService extends TypertRemoteService {
  constructor(ctx: Context, private readonly resolve: ResolveChat) {
    super(ctx, "chatPrompt", { namespace: "session" });
  }

  @Remote("prompt") async prompt(request: SessionPromptRequest) {
    try {
      const { worker, caller, signal } = binding(this.ctx, this.resolve, request.sessionId);
      return await worker.prompt(caller, request, signal);
    } catch (error) { return publicError(error); }
  }
}

/** Unregistered cancel delegate for the public DSH session/cancel method. */
export class ChatCancelService extends TypertRemoteService {
  constructor(ctx: Context, private readonly resolve: ResolveChat) {
    super(ctx, "chatCancel", { namespace: "session" });
  }

  @Remote("cancel") async cancel(request: SessionCancelRequest) {
    try {
      const { worker, caller, signal } = binding(this.ctx, this.resolve, request.sessionId);
      return await worker.cancel(caller, request, signal);
    } catch (error) { return publicError(error); }
  }
}

/** Component-only View enrollment. The carrier supplies identity outside this service. */
export class ChatAttachService extends TypertRemoteService {
  constructor(ctx: Context, private readonly attachView: (input: ChatAttachment) => ChatAttachmentResult | undefined) {
    super(ctx, "ompChatComponent");
  }

  @Remote("attach") async enroll(input: ChatAttachment): Promise<ChatAttachmentResult> {
    const result = this.attachView(chatAttachment.parse(input));
    if (!result) throw new ChatRemoteError("gateway/bad-request", "No live Session worker is available to attach.", {});
    return chatAttachmentResult.parse(result);
  }
}

/** Unregistered read-only recovery and worker lifecycle Remote. */
export class ChatLookupService extends TypertRemoteService {
  constructor(ctx: Context, private readonly resolve: ResolveChat) {
    super(ctx, "ompChat");
  }

  @Remote("lookup") async lookup(sessionId: string, requestId: string) {
    try {
      const { worker, caller, signal } = binding(this.ctx, this.resolve, sessionId);
      return chatRecovery.parse(await worker.lookup(caller, sessionId, requestId, signal));
    } catch (error) { return publicError(error); }
  }

  @Remote("state") async state(sessionId: string) {
    try {
      const { worker, caller, signal } = binding(this.ctx, this.resolve, sessionId);
      return chatState.parse(await worker.state(caller, sessionId, signal));
    } catch (error) { return publicError(error); }
  }
}
