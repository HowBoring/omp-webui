import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";

/**
 * Freeze drift gate: the recorded final-combination identities must still describe the
 * installation this worktree enrolls. It reads files only; it launches no product.
 */

const root = join(import.meta.dir, "../..");
const read = async (path: string) => JSON.parse(await readFile(join(root, path), "utf8"));
const digest = async (path: string) =>
  createHash("sha256").update(await readFile(join(root, path))).digest("hex");

const freeze = await read("docs/evidence/ticket-61-freeze.json");
const installation = await read("vendor/product/installation.json");
const dsh = await read("vendor/dsh-product/manifest.json");
const identity = await readFile(join(root, "packages/contracts/generated/identity.ts"), "utf8");

test("installation manifest carries the frozen OMP source, patch and schema identity", () => {
  expect(installation.base).toBe(freeze.omp.source.base);
  expect(installation.patch).toBe(freeze.omp.source.patchSha256);
  expect(installation.schema).toBe(freeze.omp.source.schemaSha256);
  expect(identity).toContain(freeze.omp.source.base);
  expect(identity).toContain(freeze.omp.source.sourceSha256);
  expect(identity).toContain(freeze.omp.source.patchSha256);
  expect(identity).toContain(freeze.omp.source.schemaSha256);
});

test("installation manifest carries the frozen launcher, runtime and native closure", () => {
  expect(installation.launcher).toBe(freeze.omp.launcher);
  expect(installation.target).toBe(freeze.omp.target);
  expect(installation.runtime.identity).toBe(freeze.host.runtime.sha256);
  expect(installation.assets.map((asset: { path: string; identity: string }) => [asset.path, asset.identity]))
    .toEqual(freeze.omp.installationAssets.map((asset: { path: string; identity: string }) => [asset.path, asset.identity]));
  expect(installation.runtimeDependencies.map((entry: { identity: string }) => entry.identity))
    .toEqual(freeze.omp.nativeClosure.map((entry: { identity: string }) => entry.identity));
});

test("installation manifest still matches its frozen digest and the built DSH assets", async () => {
  expect(await digest("vendor/product/installation.json")).toBe(freeze.omp.installationManifest.sha256);
  expect(await digest("vendor/dsh-product/manifest.json")).toBe(freeze.dsh.manifest.sha256);
  for (const asset of freeze.dsh.assets as { path: string; sha256: string }[])
    expect(await digest(asset.path)).toBe(asset.sha256);
  expect(dsh.assets["client.js"]).toBe(freeze.dsh.assets.find((a: { path: string }) => a.path.endsWith("client.js"))?.sha256);
});

test("frozen DSH source, patches and roster still describe the built client", () => {
  expect(dsh.dshBase).toBe(freeze.dsh.base);
  expect(dsh.dshSource.sourceTree).toBe(freeze.dsh.sourceTree);
  expect(dsh.dshSource.patches).toEqual(freeze.dsh.patches);
  expect(new Set(dsh.inputs.map((input: { package: string; version: string }) => `${input.package}@${input.version}`)).size)
    .toBe(freeze.dsh.roster.packages);
});

test("recorded harness and evidence digests still match their files", async () => {
  const entries = [
    ...Object.entries(freeze.evidence as Record<string, string>).map(([path, sha256]) => ({ path, sha256 })),
    ...Object.values(freeze.harness as Record<string, { path: string; sha256: string }>),
  ];
  for (const { path, sha256 } of entries) expect(await digest(path)).toBe(sha256);
});
