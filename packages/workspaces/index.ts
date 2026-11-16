import type { CatalogClient } from "../contracts/generated/catalog-client.ts";
import type { CatalogPageInput } from "../contracts/catalog.ts";
import type { DirectoryGrants } from "./grants.ts";

/** Metadata only, supplied by the Session Index owner (#44). This component never registers discoveries. */
export interface IndexedSession {
  id: string; reference: string; nativeSessionId: string; title?: string | undefined; cwd?: string | undefined;
}
export interface SessionIndexReader {
  page(options: CatalogPageInput): Promise<{ records: IndexedSession[]; nextCursor?: string }>;
}
export const emptySessionIndex: SessionIndexReader = { page: async () => ({ records: [] }) };
/** Every retained index reference gets a current public native description, including honest missing/replaced failures. */
export async function registeredPage(catalog: CatalogClient, grants: DirectoryGrants, index: SessionIndexReader,
  options: CatalogPageInput) {
  const page = await index.page(options);
  if (page.records.length > 32) throw new Error("INDEX_PAGE_LIMIT");
  const items = [];
  for (const record of page.records) {
    const description = await catalog.describe(record.reference);
    const native = description.status === "verified" ? description.item : undefined;
    const identityMatches = native?.nativeSessionId === record.nativeSessionId;
    const nativeStatus = native && !identityMatches ? "replaced" as const : description.status;
    items.push({ id: record.id, nativeSessionId: record.nativeSessionId, title: native?.title ?? record.title ?? record.nativeSessionId,
      nativeStatus, observedAt: description.observedAt,
      directory: native && identityMatches ? grants.authorize(native.cwd.recorded, native.cwd.canonical)
        : { status: "unknown" as const },
      ownership: native?.ownership ?? { state: "unknown" as const, observedAt: description.observedAt },
      admission: "blocked_pending_41_44" as const });
  }
  return { items, ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }) };
}
