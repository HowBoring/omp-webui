import type { CatalogClient } from "../contracts/generated/catalog-client.ts";
import type { CatalogPageInput } from "../contracts/catalog.ts";
import type { WorkspacePage } from "../contracts/workspaces.ts";
import type { DirectoryGrants } from "./grants.ts";

/** Native metadata is authoritative. No paths select sources, no Session files are opened by this adapter. */
export async function workspacePage(catalog: CatalogClient, grants: DirectoryGrants,
  options: CatalogPageInput): Promise<WorkspacePage> {
  try {
    const page = await catalog.page({ ...(options.cursor === undefined ? {} : { cursor: options.cursor }),
      ...(options.pageSize === undefined ? {} : { pageSize: options.pageSize }) });
    const access = page.items.map(item => ({ sourceId: item.sourceId, instanceId: item.instanceId,
      directory: item.cwd.status === "known" ? grants.authorize(item.cwd.recorded, item.cwd.canonical)
        : { status: item.cwd.status === "invalid" ? "inaccessible" as const : item.cwd.status },
      registration: "discovered" as const, admission: "blocked_pending_41_44" as const }));
    return { status: "ok", page, access };
  } catch (error) {
    return { status: "error", code: error instanceof Error && /^CATALOG_[A-Z_]+$/.test(error.message)
      ? error.message : "CATALOG_UNAVAILABLE" };
  }
}
