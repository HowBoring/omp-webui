import type { CatalogClient } from "../contracts/generated/catalog-client.ts";
import type { CatalogPageInput } from "../contracts/catalog.ts";
import { sameNativeSession, type NativeSessionIdentity } from "../contracts/catalog-identity.ts";
import { catalogDirectoryAccess } from "./catalog.ts";
import type { DirectoryGrants } from "./grants.ts";

/** Metadata only, supplied by the Session Index owner (#44). This component never registers discoveries. */
export type IndexedSession = NativeSessionIdentity & {
  id: string; reference: string; title?: string | undefined; cwd?: string | undefined;
};
/** Historical explicit fixture rows can lack a trusted source and instance. */
type UnboundFixtureSession = Omit<IndexedSession, "sourceId" | "instanceId"> & { sourceId?: never; instanceId?: never };
export interface SessionIndexReader {
  page(options: CatalogPageInput): Promise<{ records: (IndexedSession | UnboundFixtureSession)[]; nextCursor?: string }>;
}
export const emptySessionIndex: SessionIndexReader = { page: async () => ({ records: [] }) };
/** Every retained index reference gets a current public native description, including honest missing/replaced failures. */
export async function registeredPage(catalog: CatalogClient, grants: DirectoryGrants, index: SessionIndexReader,
  options: CatalogPageInput) {
  const page = await index.page(options);
  if (page.records.length > 32) throw new Error("INDEX_PAGE_LIMIT");
  const descriptions = [];
  for (const record of page.records) {
    descriptions.push({ record, description: await catalog.describe(record.reference) });
  }
  // Compute all current rights after the final asynchronous native lookup, immediately before publication.
  const items = descriptions.map(({ record, description }) => {
    if (description.status === "verified" && !description.item) throw new Error("CATALOG_RESULT_SCHEMA");
    const described = description.status === "verified" ? description.item : undefined;
    const native = described && record.sourceId !== undefined && sameNativeSession(record, described) ? described : undefined;
    const nativeStatus = !described || native ? description.status
      : record.sourceId === undefined ? "invalid_reference" as const : "replaced" as const;
    return { id: record.id, nativeSessionId: record.nativeSessionId, title: native?.title ?? record.title ?? record.nativeSessionId,
      nativeStatus, workspace: native?.cwd.canonical ?? native?.cwd.recorded ?? record.cwd ?? "Unknown working directory",
      observedAt: description.observedAt,
      directory: native ? catalogDirectoryAccess(grants, native.cwd)
        : { status: "unknown" as const },
      ownership: native?.ownership ?? { state: "unknown" as const, observedAt: description.observedAt },
      admission: "blocked_pending_41_44" as const };
  });
  return { items, ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }) };
}
