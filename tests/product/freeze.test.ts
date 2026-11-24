import { expect, test } from "bun:test";
import { readFile, readdir, lstat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, relative } from "node:path";
import { verifyDshSource } from "../../scripts/dsh-source";

/**
 * Freeze drift gate for ticket 63: the recorded final-combination identities must still
 * describe the stock DSH product this worktree enrolls. It reads files and verifies the
 * authored DSH source; it launches no product.
 */
const root = join(import.meta.dir, "../..");
const at = (path: string) => join(root, path);
const read = async (path: string) => JSON.parse(await readFile(at(path), "utf8"));
const digest = async (path: string) => createHash("sha256").update(await readFile(at(path))).digest("hex");
const worktreeRelative = (value: string) => {
  const marker = value.lastIndexOf("/vendor/");
  return marker < 0 ? value : value.slice(marker + 1);
};
const closureEntry = (entry: { path: string; identity: string }) =>
  [entry.path.split("/").pop(), entry.identity] as const;
const canonicalInstallation = (manifest: typeof installation) => ({
  ...manifest,
  launcher: worktreeRelative(manifest.launcher),
  target: worktreeRelative(manifest.target),
  runtime: { ...manifest.runtime, path: "<runtime>" },
  assets: manifest.assets.map((asset: { path: string }) => ({ ...asset, path: worktreeRelative(asset.path) })),
  runtimeDependencies: manifest.runtimeDependencies.map(closureEntry),
});
const parseGraph = (text: string) => {
  const match = /^globalThis\["__DSH_BOOT__"\] = (.*);\s*$/s.exec(text);
  if (match === null) throw new Error("boot graph is not one __DSH_BOOT__ assignment");
  return JSON.parse(match[1]!);
};
async function files(path: string): Promise<string[]> {
  const out: string[] = [];
  for (const name of (await readdir(at(path))).sort()) {
    const child = `${path}/${name}`;
    if ((await lstat(at(child))).isDirectory()) out.push(...await files(child));
    else out.push(child);
  }
  return out.sort();
}

const freeze = await read("docs/evidence/ticket-63-freeze.json");
const installation = await read("vendor/product/installation.json");
const identity = await readFile(at("packages/contracts/generated/identity.ts"), "utf8");
const graphText = await readFile(at("vendor/dsh-product/boot/graph-__DSH_BOOT__.js"), "utf8");
const graph = parseGraph(graphText);
const routes = await read("vendor/dsh-product/plugins/routes.json");

test("the recorded combination is the ticket-63 stock-shell freeze", () => {
  expect(freeze.ticket).toBe(63);
  expect(freeze.kind).toBe("final-combination-freeze");
  expect(freeze.dsh.roster.packages).toBe(graph.entries.length);
});

test("installation manifest carries the frozen OMP source, patch and schema identity", () => {
  expect(installation.base).toBe(freeze.omp.source.base);
  expect(installation.patch).toBe(freeze.omp.source.patchSha256);
  expect(installation.schema).toBe(freeze.omp.source.schemaSha256);
  expect(freeze.omp.source.generatedIdentity).toBeUndefined();
  for (const value of [freeze.omp.source.base, freeze.omp.source.sourceSha256,
    freeze.omp.source.patchSha256, freeze.omp.source.schemaSha256]) expect(identity).toContain(value);
});

test("installation manifest carries the frozen launcher, runtime and native closure", () => {
  expect(worktreeRelative(installation.launcher)).toBe(freeze.omp.launcher);
  expect(worktreeRelative(installation.target)).toBe(freeze.omp.target);
  expect(installation.runtime.identity).toBe(freeze.omp.runtime.identity);
  expect(installation.assets.map((asset: { path: string; identity: string }) =>
    [worktreeRelative(asset.path), asset.identity]))
    .toEqual(freeze.omp.installationAssets.map((asset: { path: string; identity: string }) =>
      [asset.path, asset.identity]));
  expect(installation.runtimeDependencies.map(closureEntry))
    .toEqual(freeze.omp.nativeClosure.map(closureEntry));
});

test("the installation manifest still matches its checkout-portable frozen digest", () => {
  expect(createHash("sha256").update(JSON.stringify(canonicalInstallation(installation))).digest("hex"))
    .toBe(freeze.omp.installationManifest.sha256);
});

test("a foreign native closure, asset or roster fails the recorded identities", () => {
  const foreignClosure = installation.runtimeDependencies.map((entry: { path: string; identity: string }, index: number) =>
    index === 0 ? { ...entry, identity: "0".repeat(64) } : entry);
  expect(createHash("sha256").update(JSON.stringify(canonicalInstallation({ ...installation,
    runtimeDependencies: foreignClosure }))).digest("hex")).not.toBe(freeze.omp.installationManifest.sha256);
  expect(freeze.omp.installationAssets.map((asset: { identity: string }) => asset.identity))
    .not.toEqual(freeze.omp.installationAssets.map((asset: { identity: string }, index: number) =>
      index === 0 ? "0".repeat(64) : asset.identity));
  expect(graph.entries.map((entry: { id: string }) => entry.id))
    .not.toEqual(freeze.dsh.roster.ids.slice(1));
});

test("the authored DSH source still verifies and matches the frozen patch set", async () => {
  const source = await verifyDshSource(at("vendor/dsh"), "candidate");
  const manifest = await read("compatibility/dsh/patches.json");
  expect(source.baseCommit).toBe(freeze.dsh.base);
  expect(source.mode).toBe("candidate");
  expect(source.sourceTree).toBe(freeze.dsh.sourceTree);
  expect(source.patches).toEqual(freeze.dsh.patches);
  expect(manifest.patches).toEqual(freeze.dsh.patches);
  expect(source.sourceSha256).toBe(freeze.dsh.sourceSha256);
  expect(await digest("upstreams.lock.json")).toBe(freeze.dsh.lockSha256);
  expect(await digest("packages/contracts/chat-component.ts")).toBe(freeze.dsh.contractSha256);
});

test("the built boot graph reports the frozen source tree, roster and dependency edges", async () => {
  expect(graph.release.commit).toBe(freeze.dsh.sourceTree);
  expect(graph.rev).toBe(freeze.dsh.graph.rev);
  expect(graph.release).toEqual(freeze.dsh.graph.release);
  expect(graph.entries.map((entry: { id: string }) => entry.id)).toEqual(freeze.dsh.roster.ids);
  expect(Object.fromEntries(graph.entries.map((entry: { id: string; inject: string[] }) =>
    [entry.id, entry.inject]))).toEqual(freeze.dsh.roster.edges);
  for (const entry of graph.entries) expect(routes[`/${entry.url.replace(/^\.?\//, "")}`]).toBeDefined();
  expect(await digest("vendor/dsh-product/boot/graph-__DSH_BOOT__.js")).toBe(freeze.dsh.graph.sha256);
  expect(await digest("vendor/dsh-product/plugins/routes.json")).toBe(freeze.dsh.routes.sha256);
});

test("the served product is exactly the frozen stock DSH asset set", async () => {
  const built = await files("vendor/dsh-product");
  expect(built).toEqual(freeze.dsh.assets.map((asset: { path: string }) => asset.path));
  for (const asset of freeze.dsh.assets as { path: string; sha256: string }[])
    expect(await digest(asset.path)).toBe(asset.sha256);
  expect(createHash("sha256").update(JSON.stringify(freeze.dsh.assets)).digest("hex"))
    .toBe(freeze.dsh.product.sha256);
  expect(freeze.dsh.product.files).toBe(built.length);
});

test("the stock shell serves no custom full-page OMP client", async () => {
  await expect(readFile(at("vendor/dsh-product/client.js"))).rejects.toThrow();
  expect(Object.keys(routes)).not.toContain("/client.js");
  const index = await readFile(at("vendor/dsh-product/index.html"), "utf8");
  expect(index).toContain("boot/graph-__DSH_BOOT__.js");
  expect(index).not.toContain("apps/chat");
  for (const path of await files("vendor/dsh-product")) {
    const text = await readFile(at(path), "utf8").catch(() => "");
    expect(text).not.toContain("data-chat-native-session");
    expect(text).not.toContain("data-chat-settlement");
  }
});

test("recorded harness, evidence and historical freeze digests still match their files", async () => {
  const entries = [
    ...Object.entries(freeze.evidence as Record<string, string>).map(([path, sha256]) => ({ path, sha256 })),
    ...Object.values(freeze.harness as Record<string, { path: string; sha256: string }>),
  ];
  for (const { path, sha256 } of entries) expect(await digest(path)).toBe(sha256);
  expect(await digest("docs/evidence/ticket-61-freeze.json"))
    .toBe(freeze.history["docs/evidence/ticket-61-freeze.json"]);
});
