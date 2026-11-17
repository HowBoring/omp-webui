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

test("native registered descriptions recheck every directory right after a concurrent revoke before publishing the page", async () => {
  const { nativeFixture } = await import("../catalog/fixture.ts");
  const { CatalogTransport } = await import("../../packages/compatibility/catalog-transport.ts");
  const home = await mkdtemp(join(tmpdir(), "omp-index-revoke-"));
  const grants = new DirectoryGrants(join(home, "state"));
  await nativeFixture(home, 2);
  const transport = await CatalogTransport.open({ argv: [process.execPath, "--no-env-file", "vendor/omp-candidate/cli.js", "--rpc-catalog"],
    cwd: process.cwd(), env: { HOME: home, TMPDIR: home, BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0" } });
  try {
    const page = await transport.catalog.page();
    const grant = grants.confirm(grants.preview(home).confirmation);
    const waiting = Promise.withResolvers<void>(), resume = Promise.withResolvers<void>();
    let requests = 0;
    // Deliberate public RPC latency fixture; every description still comes from the actual native child.
    const delayed = new CatalogClient(async command => {
      if (command.type !== "describe_session") throw new Error("UNEXPECTED_PUBLIC_RPC");
      if (++requests === 2) { waiting.resolve(); await resume.promise; }
      return transport.catalog.describe(command.reference);
    });
    const pending = registeredPage(delayed, grants, { page: async () => ({ records: page.items.map(item => ({
      id: `registered-${item.nativeSessionId}`, reference: item.reference, nativeSessionId: item.nativeSessionId,
    })) }) }, {});
    await waiting.promise; grants.revoke(grant.id); resume.resolve();
    const result = await pending;
    expect(result.items.map(item => item.directory.status)).toEqual(["ungranted", "ungranted"]);
    expect(result.items.map(item => item.nativeStatus)).toEqual(["verified", "verified"]);
  } finally { await transport.close(); grants.close(); await rm(home, { recursive: true, force: true }); }
});
