import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registeredPage } from "../../packages/workspaces/index.ts";
import { syntheticIndex } from "../../packages/workspaces/fixture-index.ts";
import { DirectoryGrants } from "../../packages/workspaces/grants.ts";
import { CatalogClient } from "../../packages/contracts/generated/catalog-client.ts";
import type { CatalogDescriptor } from "../../packages/contracts/generated/omp-wire.ts";
import { SessionIndex } from "../../packages/sessions/index.ts";

const cachedAt = "2026-01-01T00:00:00Z", describedAt = "2026-01-02T00:00:00Z";
const selection: CatalogDescriptor = { reference: "opaque-reference", nativeSessionId: "native-id", sourceId: "source",
  instanceId: "instance", title: "Cached title", cwd: { status: "known", recorded: "/cached", canonical: "/cached" },
  aliases: [], createdAt: cachedAt, modifiedAt: cachedAt, observedAt: cachedAt,
  ownership: { state: "free", observedAt: cachedAt } };

test.each(["sourceId", "instanceId", "nativeSessionId"] as const)(
  "registered page shows cached metadata and unknown rights when the public description changes %s", async field => {
    await checkDescription({ [field]: "replacement" }, false);
  });

test("registered page uses current native metadata and directory rights on an exact identity match", async () => {
  await checkDescription({}, true);
});

async function checkDescription(identity: Partial<CatalogDescriptor>, matches: boolean): Promise<void> {
  const home = await mkdtemp(join(tmpdir(), "omp-index-identity-"));
  const state = join(home, "state"), cwd = join(home, "project");
  await mkdir(cwd);
  const grants = new DirectoryGrants(state), index = new SessionIndex(state);
  try {
    const { id } = index.register(selection);
    grants.confirm(grants.preview(cwd).confirmation);
    const catalog = new CatalogClient(async command => {
      if (command.type !== "describe_session" || command.reference !== "opaque-reference") {
        throw new Error("UNEXPECTED_PUBLIC_RPC");
      }
      return { status: "verified", observedAt: describedAt, item: { ...selection, ...identity, title: "Current title",
        cwd: { status: "known", recorded: cwd, canonical: cwd }, ownership: { state: "held", observedAt: describedAt } } };
    });
    expect(await registeredPage(catalog, grants, index, {})).toEqual({ items: [{ id, nativeSessionId: "native-id",
      ...(matches ? { nativeStatus: "verified", title: "Current title", workspace: cwd,
        directory: { status: "authorized", canonical: cwd }, ownership: { state: "held", observedAt: describedAt } }
        : { nativeStatus: "replaced", title: "Cached title", workspace: "/cached",
          directory: { status: "unknown" }, ownership: { state: "unknown", observedAt: describedAt } }),
      observedAt: describedAt, admission: "blocked_pending_41_44",
    }] });
  } finally { index.close(); grants.close(); await rm(home, { recursive: true, force: true }); }
}

test("legacy synthetic metadata cannot adopt the identity of a verified description", async () => {
  const home = await mkdtemp(join(tmpdir(), "omp-index-unbound-"));
  const grants = new DirectoryGrants(join(home, "state"));
  try {
    const file = join(home, "index-metadata.json");
    await Bun.write(file, JSON.stringify([{ id: "legacy", reference: selection.reference, nativeSessionId: selection.nativeSessionId,
      title: "Legacy title", cwd: "/legacy" }]));
    const index = await syntheticIndex(file);
    const catalog = new CatalogClient(async () => ({ status: "verified", observedAt: describedAt, item: selection }));
    expect((await registeredPage(catalog, grants, index, {})).items).toEqual([{ id: "legacy", nativeSessionId: "native-id",
      title: "Legacy title", workspace: "/legacy", nativeStatus: "invalid_reference", directory: { status: "unknown" },
      ownership: { state: "unknown", observedAt: describedAt }, observedAt: describedAt, admission: "blocked_pending_41_44" }]);
  } finally { grants.close(); await rm(home, { recursive: true, force: true }); }
});

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

test("registered page recomputes all directory rights after the final asynchronous catalog description", async () => {
  const home = await mkdtemp(join(tmpdir(), "omp-index-revoke-fault-"));
  try {
    const first: CatalogDescriptor = { ...selection, cwd: { status: "known", recorded: home, canonical: home } };
    const second = { ...first, reference: "other-reference", nativeSessionId: "other-id", instanceId: "other-instance" };
    const catalog = new CatalogClient(async command => {
      if (command.type !== "describe_session") throw new Error("UNEXPECTED_PUBLIC_RPC");
      return { status: "verified", observedAt: describedAt, item: command.reference === first.reference ? first : second };
    });
    await verifyRightsAfterRevoke(home, catalog, [first, second]);
  } finally { await rm(home, { recursive: true, force: true }); }
});

test("native registered descriptions recheck every directory right after a concurrent revoke before publishing the page", async () => {
  const { nativeFixture } = await import("../catalog/fixture.ts");
  const { CatalogTransport } = await import("../../packages/compatibility/catalog-transport.ts");
  const home = await mkdtemp(join(tmpdir(), "omp-index-revoke-"));
  await nativeFixture(home, 2);
  const transport = await CatalogTransport.open({ argv: [process.execPath, "--no-env-file", "vendor/omp-candidate/cli.js", "--rpc-catalog"],
    cwd: process.cwd(), env: { HOME: home, TMPDIR: home, BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0" } });
  try {
    const page = await transport.catalog.page();
    await verifyRightsAfterRevoke(home, transport.catalog, page.items);
  } finally { await transport.close(); await rm(home, { recursive: true, force: true }); }
});

async function verifyRightsAfterRevoke(home: string, catalog: CatalogClient, selections: CatalogDescriptor[]): Promise<void> {
  const state = join(home, "state"), grants = new DirectoryGrants(state), index = new SessionIndex(state);
  try {
    expect(selections).toHaveLength(2);
    for (const item of selections) index.register(item);
    const grant = grants.confirm(grants.preview(home).confirmation);
    const waiting = Promise.withResolvers<void>(), resume = Promise.withResolvers<void>();
    let requests = 0;
    // Hold the final response at the public RPC boundary so the earlier description precedes revocation.
    const delayed = new CatalogClient(async command => {
      if (command.type !== "describe_session") throw new Error("UNEXPECTED_PUBLIC_RPC");
      if (++requests === 2) { waiting.resolve(); await resume.promise; }
      return catalog.describe(command.reference);
    });
    expect((await registeredPage(catalog, grants, index, {})).items.map(item => item.directory.status))
      .toEqual(["authorized", "authorized"]);
    const pending = registeredPage(delayed, grants, index, {});
    const revoke = async () => {
      await waiting.promise;
      try { grants.revoke(grant.id); } finally { resume.resolve(); }
    };
    const [result] = await Promise.all([pending, revoke()]);
    expect(result.items.map(item => item.directory.status)).toEqual(["ungranted", "ungranted"]);
    expect(result.items.map(item => item.nativeStatus)).toEqual(["verified", "verified"]);
  } finally { index.close(); grants.close(); }
}
