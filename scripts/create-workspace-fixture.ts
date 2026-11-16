/** Explicit owned synthetic data authoring only; never imported by Host. */
import { mkdir, rm, symlink, rename, copyFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { nativeFixture, nativeTitleSlots, sessionManagerFixture } from "../tests/catalog/fixture.ts";
import { CatalogTransport } from "../packages/compatibility/catalog-transport.ts";
const home = resolve("vendor/workspace-fixture");
await rm(home, { recursive: true, force: true });
const source = await nativeFixture(home, 40);
await mkdir(join(home, "project", "child")); await mkdir(join(home, "project-other")); await mkdir(join(home, "outside"));
await symlink(join(home, "outside"), join(home, "project", "escape"));
await mkdir(join(home, "custom"));
const cases: [string, string | undefined][] = [["unknown", undefined], ["missing", join(home, "gone")],
  ["child", join(home, "project", "child")], ["prefix", join(home, "project-other")],
  ["escape", join(home, "project", "escape")]];
const slots = await nativeTitleSlots(cases.map(([id]) => id));
for (const [index, [id, cwd]] of cases.entries()) {
  await Bun.write(join(home, "custom", `${id}.jsonl`), slots[index] + JSON.stringify({ type: "session", version: 3,
    id, timestamp: "2026-01-01T00:00:00Z", ...(cwd ? { cwd } : {}) }) + "\n");
}
await Bun.write(join(source, "malformed.jsonl"), "not native metadata\n");
const native = await sessionManagerFixture(home);
await Bun.write(join(home, "fixture.json"), JSON.stringify({ home, source, native, rows: 47 }) + "\n");
// Synthetic Session Index input is authored explicitly, using only native public catalog descriptions.
const transport = await CatalogTransport.open({ argv: [process.execPath, "--no-env-file", resolve("vendor/omp-candidate/cli.js"), "--rpc-catalog"],
  cwd: home, env: { HOME: home, TMPDIR: home, BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0",
    OMP_CATALOG_SOURCES: JSON.stringify([join(home, "custom"), join(home, "missing-source")]) } });
try {
  let cursor: string | undefined;
  const items = [];
  do {
    const page = await transport.catalog.page({ ...(cursor ? { cursor } : {}) });
    items.push(...page.items); cursor = page.nextCursor;
  } while (cursor);
  const first = items.find(item => item.nativeSessionId === "native-0000")!;
  const second = items.find(item => item.nativeSessionId === "native-0001")!;
  const reference = JSON.parse(Buffer.from(first.reference, "base64url").toString("utf8"));
  const missing = Buffer.from(JSON.stringify({ ...reference, locator: "bucket/missing-session.jsonl" })).toString("base64url");
  const absentSource = Buffer.from(JSON.stringify({ ...reference, sourceId: "no-longer-configured" })).toString("base64url");
  await Bun.write(join(home, "index-metadata.json"), JSON.stringify([
    { id: "synthetic-registered-valid", reference: first.reference, nativeSessionId: first.nativeSessionId, title: "Remembered valid native title" },
    { id: "synthetic-registered-replaced", reference: second.reference, nativeSessionId: second.nativeSessionId, title: "Remembered replaced native title" },
    { id: "synthetic-registered-missing", reference: missing, nativeSessionId: "missing-native", title: "Remembered missing native title" },
    { id: "synthetic-registered-unknown-source", reference: absentSource, nativeSessionId: first.nativeSessionId, title: "Source removed" },
    { id: "synthetic-invalid-reference", reference: "invalid", nativeSessionId: "invalid-native", title: "Invalid persisted metadata reference" },
  ], null, 2));
  const replaced = join(source, "bucket", "native-0001.jsonl");
  await rename(replaced, join(home, "replaced-original.jsonl"));
  await copyFile(join(home, "replaced-original.jsonl"), replaced);
} finally { await transport.close(); }
console.log(JSON.stringify({ kind: "synthetic-workspace-profile", rows: 47, actualNativeManagerFiles: 2 }));
