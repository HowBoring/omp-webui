import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registeredPage } from "../../packages/workspaces/index.ts";
import { DirectoryGrants } from "../../packages/workspaces/grants.ts";
import { CatalogClient } from "../../packages/contracts/generated/catalog-client.ts";

test("readonly Session Index metadata keeps failed references visible without admitting history or registering discoveries", async () => {
  const home = await mkdtemp(join(tmpdir(), "omp-index-map-"));
  const grants = new DirectoryGrants(join(home, "state"));
  // Explicit public RPC system-boundary fault fixture, not native or browser acceptance evidence.
  const catalog = new CatalogClient(async () => ({ status: "missing", observedAt: "2026-01-01T00:00:00Z" }));
  try {
    const page = await registeredPage(catalog, grants, { page: async () => ({ records: [{
      id: "fixture-registration", reference: "stale", nativeSessionId: "native-before-delete", title: "Retained native title",
    }], nextCursor: "more" }) }, {});
    expect(page.items[0]).toMatchObject({ id: "fixture-registration", title: "Retained native title", nativeStatus: "missing",
      directory: { status: "unknown" }, admission: "blocked_pending_41_44" });
    expect(page.nextCursor).toBe("more");
  } finally { grants.close(); await rm(home, { recursive: true, force: true }); }
});
