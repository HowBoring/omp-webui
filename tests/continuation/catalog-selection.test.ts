import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { CatalogTransport } from "../../packages/compatibility/catalog-transport.ts";
import { StrictTransport } from "../../packages/compatibility/strict-transport.ts";
import { filesystemManifest, nativeFixture } from "../catalog/fixture.ts";
import { isolatedRuntimeArgs, selectedDescriptor } from "./worker.ts";

test("empty scanning pages with a repeated cursor still select and strictly continue the same native Session", async () => {
  const home = await mkdtemp(join(tmpdir(), "strict-catalog-selection-"));
  try {
    const root = await nativeFixture(home), cwd = join(home, "project");
    for (let index = 0; index < 600; index++) await mkdir(join(root, `empty-${index}`));
    const before = await filesystemManifest(root);
    const catalog = await CatalogTransport.open({ argv: [process.execPath, "--no-env-file", "--preload",
      resolve("compatibility/omp/fixtures/no-provider.ts"), resolve("vendor/omp-candidate/cli.js"), "--rpc-catalog"],
      env: { HOME: home, PATH: "/usr/bin:/bin", BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0" }, timeoutMs: 3000 });
    try {
      const first = await catalog.catalog.page();
      expect(first).toMatchObject({ status: "scanning", items: [], failures: [], examined: 256 });
      expect(first.nextCursor).toBeDefined();
      const second = await catalog.catalog.page({ cursor: first.nextCursor! });
      expect(second).toMatchObject({ status: "scanning", items: [], failures: [], examined: 512,
        snapshot: first.snapshot, nextCursor: first.nextCursor });
    } finally { expect((await catalog.close()).forced).toBe(false); }
    const selected = await selectedDescriptor(home);
    expect(selected).toMatchObject({ nativeSessionId: "native-0000", aliases: ["bucket/native-0000.jsonl"] });
    expect(await filesystemManifest(root)).toEqual(before);
    const worker = await StrictTransport.open({ argv: [process.execPath, "--no-env-file", "--preload",
      resolve("compatibility/omp/fixtures/no-provider.ts"), resolve("vendor/omp-candidate/cli.js"),
      "--mode", "rpc-ui", "--strict-start", ...isolatedRuntimeArgs], cwd,
      env: { HOME: home, PATH: "/usr/bin:/bin", TMPDIR: home, BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0",
        OPENAI_API_KEY: "synthetic-unused-no-provider-calls", PI_NOTIFICATIONS: "off" },
      timeoutMs: 10_000, readyTimeoutMs: 3000 });
    try {
      expect(await worker.startup.start({ intent: "continue", reference: selected.reference, expectedCwd: cwd }))
        .toMatchObject({ phase: "open", intent: "continue", nativeSessionId: "native-0000",
          binding: { instanceId: selected.instanceId } });
      expect(await worker.startup.state()).toMatchObject({ phase: "open", nativeSessionId: "native-0000" });
    } finally { expect((await worker.close()).forced).toBe(false); }
  } finally { await rm(home, { recursive: true, force: true }); }
});

for (const corrupted of [false, true]) test(corrupted
  ? "a failed native catalog preserves its failure instead of reporting a missing descriptor"
  : "a completed empty native catalog reports a missing descriptor without creating a Session", async () => {
  const home = await mkdtemp(join(tmpdir(), "strict-catalog-empty-"));
  try {
    const root = await nativeFixture(home, 0);
    if (corrupted) await Bun.write(join(root, "bucket/broken.jsonl"), "invalid native header\n");
    const before = await filesystemManifest(root);
    await expect(selectedDescriptor(home)).rejects.toThrow(corrupted
      ? "INVALID_METADATA" : "STRICT_FIXTURE_DESCRIPTOR_MISSING");
    expect(await filesystemManifest(root)).toEqual(before);
  } finally { await rm(home, { recursive: true, force: true }); }
});
