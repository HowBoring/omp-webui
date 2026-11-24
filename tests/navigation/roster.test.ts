import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "bun:test";
import { ompPatches } from "../../scripts/omp-source.ts";
import { buildNavigationRoster } from "../../scripts/write-navigation-roster.ts";

/** The roster must fail loudly when a bundle, a contract artifact or the lock drifts; vendor/ is gitignored. */
if (!existsSync("vendor/dsh-navigation/manifest.json") || !existsSync("vendor/host-navigation/manifest.json"))
  throw new Error("NAVIGATION_BUNDLES_UNSTAGED: run bun apps/navigation-fixture/build.ts && bun scripts/build-navigation-host.ts");
const digestOf = async (path: string) => createHash("sha256").update(await readFile(resolve(path))).digest("hex");
const recorded = JSON.parse(await readFile(resolve("docs/evidence/ticket-41-navigation-roster.json"), "utf8"));

test("roster matches the checked-in candidate, the lock and the staged bundles", async () => {
  const roster = await buildNavigationRoster();
  expect(roster.page.lockSha256).toBe(await digestOf("upstreams.lock.json"));
  expect(roster.page.dshBase).not.toBeNull();
  expect(String(roster.page.dshBase)).toBe(String(roster.dshBase));
  expect(roster.dshSource.declaredTree).not.toBeNull();
  expect(String(roster.page.sourceTree)).toBe(String(roster.dshSource.declaredTree));
  expect(roster.dshSource.baseCommit).toBe(roster.dshBase);
  for (const digest of [...roster.page.digests, ...roster.host.digests]) expect(await digestOf(digest.path)).toBe(digest.sha256);
  expect(roster.host.bundle.sha256).toBe(await digestOf(roster.host.bundle.path));
  for (const artifact of roster.contract.artifacts) {
    expect(artifact.sha256).toBe(artifact.actual);
    expect((await readFile(resolve(artifact.path))).byteLength).toBe(artifact.bytes);
  }
  expect(roster.contract.sourcePatches.map(patch => patch.path))
    .toEqual(ompPatches.map(name => `compatibility/omp/${name}`));
  for (const patch of roster.contract.sourcePatches) {
    expect(patch.sha256).toBe(patch.actual);
    expect(patch.bytes).toBe(patch.actualBytes);
  }
  expect(roster.externalStages.every(stage => stage.enrolled === false)).toBe(true);
  expect(roster.excluded.some(entry => entry.path === "vendor/omp-strict")).toBe(true);
  expect(JSON.stringify(roster)).not.toContain("vendor/navigation-profile/");
});

test("checked-in roster is the current roster, not a stale copy", async () => {
  expect(recorded).toEqual(await buildNavigationRoster());
});
