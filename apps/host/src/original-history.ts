/**
 * Public read-only access to retained attachment Originals.
 *
 * The browser proves only its current cookie; the Host resolves the exact admitted Session and reads
 * the Native history itself. An Original is offered only for an entry the Native history still
 * retains, and the Store rechecks the browser/page/source/instance and the exact bytes on every call.
 */
import type { BrowserAccess } from "../../../packages/access/index.ts";
import type { OriginalHistoryScope, OriginalStore } from "../../../packages/attachments/store.ts";
import type { TreeHistory } from "../../../packages/tree/service.ts";

export interface OriginalHistorySession { scope: OriginalHistoryScope; history: TreeHistory }
export interface OriginalHistoryDeps {
  /** Must run before URL parsing or any Store work. */
  admit(request: Request): BrowserAccess | Response;
  /** Rechecks the browser, the directory grant and the exact open Native Session. */
  session(identity: BrowserAccess, sessionId: string): OriginalHistorySession;
  store: OriginalStore;
}

const token = /^[A-Za-z0-9_-]{1,256}$/;
const maxPages = 64, maxEntries = 20_000;
const status: Record<string, number> = {
  attachment_authority_unavailable: 403, attachment_binding_changed: 403, attachment_store_closed: 503,
  attachment_object_unavailable: 404, attachment_entry_unavailable: 404, attachment_original_unavailable: 404,
  attachment_canceled: 408, attachment_original_corrupt: 409, attachment_invalid_target: 400,
};
const headers = { "cache-control": "no-store" };

function failure(code: string): Response {
  return Response.json({ error: { code } }, { status: status[code] ?? 503, headers });
}

/** Bounded retention scan. The entry id is only trusted because this exact Native history contains it. */
async function retained(history: TreeHistory, entryIds: readonly string[]): Promise<Set<string>> {
  const wanted = new Set(entryIds), found = new Set<string>();
  const opened = await history.open("tree");
  try {
    let cursor = opened.cursor;
    for (let page = 0; page < maxPages && found.size < wanted.size; page++) {
      const current = await history.page(cursor);
      if (current.items.length > maxEntries) break;
      for (const item of current.items) {
        if (wanted.has(item.id)) found.add(item.id);
        if (item.entryId && wanted.has(item.entryId)) found.add(item.entryId);
      }
      if (!current.nextCursor) break;
      cursor = current.nextCursor;
    }
  } finally { await history.close(opened.snapshot).catch(() => {}); }
  return found;
}

function single(url: URL, name: string): string | undefined {
  const values = url.searchParams.getAll(name);
  if (values.length > 1) return;
  return values[0];
}

function fileName(value: string): string {
  const name = value.replace(/[\u0000-\u001f\u007f]/g, "_").slice(0, 255);
  const ascii = name.normalize("NFKD").replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^[._]+|[._]+$/g, "").slice(0, 80);
  return `filename="${ascii || "original"}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/** Entry and object URLs are unguessable; disposition is never taken from the stored name. */
export async function originalHistoryResponse(request: Request, deps: OriginalHistoryDeps): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return Response.json({ error: { code: "attachment_method_not_allowed" } }, { status: 405, headers });
  }
  const identity = deps.admit(request);
  if (identity instanceof Response) return identity;
  const url = new URL(request.url), path = url.pathname;
  const list = path === "/api/ompOriginals/history", read = path === "/api/ompOriginals/original";
  if (!list && !read) return Response.json({ error: { code: "not_found" } }, { status: 404, headers });
  const allowed = list ? ["sessionId", "entryId"] : ["sessionId", "entryId", "objectId", "disposition"];
  if ([...url.searchParams.keys()].some(key => !allowed.includes(key))) return failure("attachment_invalid_target");
  const sessionId = single(url, "sessionId"), entryId = single(url, "entryId");
  if (!sessionId || !entryId || !token.test(sessionId) || !token.test(entryId)) return failure("attachment_invalid_target");
  const objectId = read ? single(url, "objectId") : undefined;
  if (read && (!objectId || !/^[0-9a-f-]{36}$/.test(objectId))) return failure("attachment_invalid_target");
  const disposition = read ? single(url, "disposition") : undefined;
  if (disposition !== undefined && disposition !== "inline" && disposition !== "attachment") return failure("attachment_invalid_target");
  let session: OriginalHistorySession;
  try { session = deps.session(identity, sessionId); }
  catch { return failure("attachment_authority_unavailable"); }
  let present: Set<string>;
  try { present = await retained(session.history, [entryId]); }
  catch { return failure("attachment_authority_unavailable"); }
  if (!present.has(entryId)) return failure("attachment_entry_unavailable");
  const access = () => session.scope;
  try {
    if (list) {
      const items = deps.store.history(access, [entryId], request.signal);
      return Response.json({ status: "ok", entryId, items }, { headers });
    }
    const original = await deps.store.readHistorical(access, entryId, objectId!, [entryId], request.signal);
    const inline = disposition === "inline" && original.mediaType.startsWith("image/");
    const response = {
      "content-type": original.mediaType, "content-length": String(original.byteLength),
      "content-disposition": `${inline ? "inline" : "attachment"}; ${fileName(original.displayName)}`,
      "x-content-type-options": "nosniff", "content-security-policy": "sandbox",
      "cross-origin-resource-policy": "same-origin", "referrer-policy": "no-referrer",
      "cache-control": "no-store", "x-omp-original-sha256": original.sha256,
      "x-omp-original-state": "native-associated",
    };
    const bytes = original.bytes as Uint8Array<ArrayBuffer>;
    return new Response(request.method === "HEAD" ? null : new Blob([bytes]), { status: 200, headers: response });
  } catch (error) {
    const code = error instanceof Error && error.message in status ? error.message : "attachment_object_unavailable";
    return failure(code);
  }
}

export { retained as retainedEntries };
