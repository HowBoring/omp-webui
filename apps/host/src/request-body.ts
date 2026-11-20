const timeoutMs = 5000;
const authorityCheckMs = 250;
const failures = { 401: "Access invalidated", 408: "Request body timed out", 413: "Request body too large" };

export class RequestBodyError extends Error {
  constructor(readonly status: keyof typeof failures) { super(failures[status]); }
}

/** An unavailable authority check invalidates the request. */
export function hasCurrentRequestAuthority(current: () => boolean): boolean {
  try { return current() === true; }
  catch { return false; }
}

/** Bound bytes actually read, even when the Request has no trusted outer HTTP carrier. */
export async function readBoundedRequestBody(request: Request, signal: AbortSignal, current: () => boolean,
  maxBytes: number): Promise<unknown> {
  if (signal.aborted || !hasCurrentRequestAuthority(current)) throw new RequestBodyError(401);
  const length = declaredLength(request, maxBytes);
  const reader = request.body?.getReader();
  if (!reader) throw new Error("request body required");

  const deadline = performance.now() + timeoutMs;
  const interrupted = Promise.withResolvers<never>();
  const invalidate = () => interrupted.reject(new RequestBodyError(401));
  signal.addEventListener("abort", invalidate, { once: true });
  const timer = setTimeout(() => interrupted.reject(new RequestBodyError(408)), timeoutMs);
  const check = setInterval(() => { if (!hasCurrentRequestAuthority(current)) invalidate(); }, authorityCheckMs);
  try {
    if (signal.aborted) invalidate();
    const bytes = await Promise.race([readBytes(reader, deadline, maxBytes), interrupted.promise]);
    if (!hasCurrentRequestAuthority(current)) throw new RequestBodyError(401);
    if (length !== undefined && length !== bytes.byteLength) throw new Error("Invalid request length");
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

function declaredLength(request: Request, maxBytes: number): number | undefined {
  const header = request.headers.get("content-length");
  if (header === null) return;
  if (!/^\d+$/.test(header)) throw new Error("Invalid request length");
  const length = Number(header);
  if (length > maxBytes) throw new RequestBodyError(413);
  return length;
}

async function readBytes(reader: ReadableStreamDefaultReader<Uint8Array>, deadline: number,
  maxBytes: number): Promise<Uint8Array> {
  let bytes = new Uint8Array(0);
  let length = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (performance.now() >= deadline) throw new RequestBodyError(408);
    if (done) return bytes.subarray(0, length);
    if (!(value instanceof Uint8Array)) throw new Error("Invalid request chunk");
    const next = length + value.byteLength;
    if (next > maxBytes) throw new RequestBodyError(413);
    if (next > bytes.byteLength) {
      const expanded = new Uint8Array(Math.min(maxBytes, Math.max(next, 4096, bytes.byteLength * 2)));
      expanded.set(bytes);
      bytes = expanded;
    }
    bytes.set(value, length);
    length = next;
  }
}
