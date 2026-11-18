import { hasCurrentRequestAuthority, readBoundedRequestBody, RequestBodyError } from "./request-body.ts";

// A 256 KiB UTF-8 prompt can take six bytes per ASCII character in JSON. Leave room for the DSH envelope.
const maxBytes = 2 * 1024 * 1024;
const failures = { 401: "Access invalidated", 408: "Chat request body timed out", 413: "Chat request body too large" };

export class ChatBodyError extends Error {
  constructor(readonly status: keyof typeof failures) { super(failures[status]); }
}

export const hasCurrentChatAuthority = hasCurrentRequestAuthority;

export async function readChatRequestBody(request: Request, signal: AbortSignal, current: () => boolean): Promise<unknown> {
  try { return await readBoundedRequestBody(request, signal, current, maxBytes); }
  catch (error) {
    if (error instanceof RequestBodyError) throw new ChatBodyError(error.status);
    throw error;
  }
}
