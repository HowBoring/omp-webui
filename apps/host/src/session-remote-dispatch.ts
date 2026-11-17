import type { Context } from "@deepseek-ai/cordis";
import { Peer, clientRequestSchema } from "@deepseek-ai/dsh-client-connection";
import { sessionFailure } from "../../../packages/sessions/errors.ts";
import sessionContribution from "@deepseek-ai/dsh-api-session-controller/remote";
import { z } from "zod";
import { sessionsContribution } from "../../../packages/contracts/sessions.ts";
const methods = { ...sessionsContribution.methods, ...sessionContribution.methods };
export const sessionUnary = new Set([...Object.keys(sessionsContribution.methods), "session/list", "session/page", "session/projections"]);
const unary = sessionUnary;
const successfulReplies = new WeakSet<Response>();
export const isSuccessfulSessionReply = (response: Response): boolean => successfulReplies.has(response);

/** Shared carrier boundary: validate before invocation, preserve request correlation and sanitize failures. */
export async function dispatchSessionRequest(request: Request, ctx: Context, peer: Peer, current: () => boolean): Promise<Response> {
  if (request.headers.get("content-type")?.split(";", 1)[0] !== "application/json") {
    return new Response("JSON required", { status: 415 });
  }
  let decoded;
  try {
    const envelope = clientRequestSchema.parse(await request.json());
    const method = Object.entries(methods).find(([name]) => name === envelope.method)?.[1];
    if (!method || !unary.has(envelope.method) || new URL(request.url).pathname !== `/api/${envelope.method}`) throw new Error("endpoint mismatch");
    const payload = z.strictObject({args:z.record(z.string(),z.unknown())}).parse(envelope.payload);
    const args = z.record(z.string(),z.unknown()).parse(method.input({strict:true}).create().parse(payload.args));
    decoded = { envelope, method, args };
  } catch { return new Response("Invalid Session request", { status: 400 }); }
  const { envelope, method, args } = decoded;
  if (!current()) return new Response("Access invalidated", { status: 401 });
  try {
    request.signal.throwIfAborted();
    if (!current()) return new Response("Access invalidated", { status: 401 });
    const value = await ctx.typertGateway.invoke({namespace:method.namespace,method:method.method,
      args,peer,signal:request.signal});
    const response = Response.json({ type: "server-response", rpcId: envelope.rpcId, result: { ok: true, value } });
    successfulReplies.add(response); return response;
  } catch (error) {
    return Response.json({ type: "server-response", rpcId: envelope.rpcId,
      result: { ok: false, error: ctx.typertGateway.wireStream.failure(sessionFailure(error)) } });
  }
}
