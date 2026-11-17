import { expect, test } from "bun:test";
import { copyFile, mkdtemp, readdir, readFile, rm, chmod, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { CatalogTransport } from "../../packages/compatibility/catalog-transport.ts";
import { nativeFixture } from "../catalog/fixture.ts";
import { strictWorker, selectedDescriptor, negotiateStrict, isolatedRuntimeArgs } from "./worker.ts";

for (const damage of ["missing-meta", "missing-body", "prefix-corrupt", "copy-control-loss"] as const)
  test(`committed native ${damage} is refused by bounded discovery and strict continuation`, async () => {
    const home = await mkdtemp(join(tmpdir(), "strict-integrity-"));
    try {
      const root = await nativeFixture(home), file = join(root, "bucket/native-0000.jsonl"), cwd = join(home, "project");
      const selected = await selectedDescriptor(home), writer = strictWorker(home, cwd, isolatedRuntimeArgs);
      try {
        await negotiateStrict(writer);
        expect(await writer.request({ type: "strict_start", intent: "continue", reference: selected.reference, expectedCwd: cwd })).toMatchObject({ success: true });
        expect(await writer.request({ type: "set_session_name", name: "Older committed title" })).toMatchObject({ success: true });
        expect(await writer.request({ type: "set_session_name", name: "Committed integrity title" })).toMatchObject({ success: true });
        expect((await writer.close()).code).toBe(0);
      } finally { writer.child.kill(); await writer.child.exited; }
      const directory = join(root, "bucket/.native-0000.jsonl.omp-generations");
      // A long valid append tail must not hide the newest committed manifest from bounded discovery.
      const tail = JSON.stringify({type:"custom",id:"after-commit",parentId:"entry-0",timestamp:"2026-01-01T00:00:03Z",customType:"fixture-tail",data:"x".repeat(65536)})+"\n";
      await writeFile(file, tail, {flag:"a"});
      const entries = await readdir(directory);
      if (damage === "copy-control-loss") {
        await copyFile(file, file + ".copy"); await rm(file); await copyFile(file + ".copy", file); await rm(file + ".copy");
        await rm(directory, { recursive: true });
      } else {
        const latest = entries.filter(name => name.endsWith(".meta")).sort((left,right)=>Number(right.split("-")[0])-Number(left.split("-")[0]))[0];
        if (!latest) throw new Error("GENERATION_FIXTURE_META_MISSING");
        const value = JSON.parse(await readFile(join(directory, latest), "utf8"));
        const name = damage === "missing-meta" ? latest : value.token + ".gen";
        if (!name) throw new Error("GENERATION_FIXTURE_MISSING");
        const target = join(directory, name);
        if (damage.startsWith("missing")) await rm(target);
        else { const bytes = await readFile(target); const old = Buffer.from("Committed integrity title"), index = bytes.indexOf(old);
          expect(index).toBeGreaterThanOrEqual(0); bytes[index] = 88; await chmod(target, 0o600); await writeFile(target, bytes); }
      }
      const catalog = await CatalogTransport.open({ argv: [process.execPath, "--no-env-file", "--preload", resolve("compatibility/omp/fixtures/no-provider.ts"),
        resolve("vendor/omp-candidate/cli.js"), "--rpc-catalog"], env: { HOME: home, PATH: "/usr/bin:/bin", BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0" } });
      try { const page = await catalog.catalog.page(); expect(page.items).toHaveLength(0); expect(page.status).toBe("partial"); }
      finally { await catalog.close(); }
      const reader = strictWorker(home, cwd, isolatedRuntimeArgs);
      try { await negotiateStrict(reader);
        expect(await reader.request({ type: "strict_start", intent: "continue", reference: selected.reference, expectedCwd: cwd })).toMatchObject({ success: false });
        expect((await reader.close()).code).toBe(0);
      } finally { reader.child.kill(); await reader.child.exited; }
      expect((await readdir(join(root, "bucket"))).filter(name => name.endsWith(".jsonl"))).toEqual(["native-0000.jsonl"]);
    } finally { await rm(home, { recursive: true, force: true }); }
  }, 20_000);
