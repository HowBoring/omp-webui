import type { Context } from "@deepseek-ai/cordis";
import { Remote, RemoteError, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import type { SessionPromptRequest } from "@deepseek-ai/dsh-api-session-controller/types";
import { chatRecovery, chatSessionId, chatState } from "../contracts/chat.ts";
import { ChatError, type ChatGateway } from "./gateway.ts";

/** The Host resolves only an explicitly open, retained worker. */
type ResolveChat = (sessionId: string) => ChatGateway | undefined;

function binding(ctx: Context, resolve: ResolveChat, sessionId: string) {
  const invocation = ctx.invocation;
  if (!invocation || invocation.signal.aborted || invocation.peer.signal.aborted) throw new ChatError("authority");
  const worker = resolve(chatSessionId.parse(sessionId));
  if (!worker) throw new ChatError("authority");
  return { worker, peer: invocation.peer, signal: invocation.signal };
}

function publicError(error: unknown): never {
  const code = error instanceof ChatError ? error.code : "unknown";
  if (code === "busy") {
    throw new RemoteError("gateway/bad-request", "Native Session is busy. Your draft is retained.", {});
  }
  if (code === "unknown") {
    throw new RemoteError("gateway/bad-request", "Submission outcome is unresolved. Check Native recovery.", {});
  }
  throw new RemoteError("gateway/bad-request", "Chat request is unavailable for this Session view.", {});
}

/** Unregistered prompt delegate for the public DSH session/prompt method. */
export class ChatPromptService extends TypertRemoteService {
  constructor(ctx: Context, private readonly resolve: ResolveChat) {
    super(ctx, "sessionController", { namespace: "session" });
  }

  @Remote("prompt") async prompt(request: SessionPromptRequest) {
    try {
      const { worker, peer, signal } = binding(this.ctx, this.resolve, request.sessionId);
      return await worker.prompt(peer, request, signal);
    } catch (error) { return publicError(error); }
  }
}

/** Unregistered read-only recovery and worker lifecycle Remote. */
export class ChatLookupService extends TypertRemoteService {
  constructor(ctx: Context, private readonly resolve: ResolveChat) {
    super(ctx, "ompChat");
  }

  @Remote("lookup") async lookup(sessionId: string, requestId: string) {
    try {
      const { worker, peer, signal } = binding(this.ctx, this.resolve, sessionId);
      return chatRecovery.parse(await worker.lookup(peer, sessionId, requestId, signal));
    } catch (error) { return publicError(error); }
  }

  @Remote("state") async state(sessionId: string) {
    try {
      const { worker, peer, signal } = binding(this.ctx, this.resolve, sessionId);
      return chatState.parse(await worker.state(peer, sessionId, signal));
    } catch (error) { return publicError(error); }
  }
}
