// A 256 KiB UTF-8 prompt can take six bytes per ASCII character in JSON. Leave room for the DSH envelope.
const maxBytes = 2 * 1024 * 1024;
const timeoutMs = 5000;
const authorityCheckMs = 250;
const failures = { 401: "Access invalidated", 408: "Chat request body timed out", 413: "Chat request body too large" };

export class ChatBodyError extends Error {
  constructor(readonly status: keyof typeof failures) { super(failures[status]); }
}

/** An unavailable authority check invalidates the opt-in Chat request. */
export function hasCurrentChatAuthority(current: () => boolean): boolean {
  try { return current() === true; }
  catch { return false; }
}

/** Bound bytes actually read, even when the Request has no trusted outer HTTP carrier. */
export async function readChatRequestBody(request: Request, signal: AbortSignal, current: () => boolean): Promise<unknown> {
  if (signal.aborted || !hasCurrentChatAuthority(current)) throw new ChatBodyError(401);
  const length = declaredLength(request);
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Chat request body required");

  const deadline = performance.now() + timeoutMs;
  const interrupted = Promise.withResolvers<never>();
  const invalidate = () => interrupted.reject(new ChatBodyError(401));
  signal.addEventListener("abort", invalidate, { once: true });
  const timer = setTimeout(() => interrupted.reject(new ChatBodyError(408)), timeoutMs);
  const check = setInterval(() => { if (!hasCurrentChatAuthority(current)) invalidate(); }, authorityCheckMs);
  try {
    if (signal.aborted) invalidate();
    const bytes = await Promise.race([readBytes(reader, deadline), interrupted.promise]);
    if (!hasCurrentChatAuthority(current)) throw new ChatBodyError(401);
    if (length !== undefined && length !== bytes.byteLength) throw new Error("Invalid Chat request length");
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } finally {
    clearTimeout(timer);
    clearInterval(check);
    signal.removeEventListener("abort", invalidate);
    // The underlying source can leave its cancel promise pending. Never hold the request open for it.
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function declaredLength(request: Request): number | undefined {
  const header = request.headers.get("content-length");
  if (header === null) return;
  if (!/^\d+$/.test(header)) throw new Error("Invalid Chat request length");
  const length = Number(header);
  if (length > maxBytes) throw new ChatBodyError(413);
  return length;
}

async function readBytes(reader: ReadableStreamDefaultReader<Uint8Array>, deadline: number): Promise<Uint8Array> {
  let bytes = new Uint8Array(0);
  let length = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (performance.now() >= deadline) throw new ChatBodyError(408);
    if (done) return bytes.subarray(0, length);
    if (!(value instanceof Uint8Array)) throw new Error("Invalid Chat request chunk");
    const next = length + value.byteLength;
    if (next > maxBytes) throw new ChatBodyError(413);
    if (next > bytes.byteLength) {
      const expanded = new Uint8Array(Math.min(maxBytes, Math.max(next, 4096, bytes.byteLength * 2)));
      expanded.set(bytes);
      bytes = expanded;
    }
    bytes.set(value, length);
    length = next;
  }
}
