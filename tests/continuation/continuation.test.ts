import { z } from "zod";
import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { CatalogTransport } from "../../packages/compatibility/catalog-transport.ts";
import { nativeFixture } from "../catalog/fixture.ts";
import { strictWorker } from "./worker.ts";

async function descriptor(home: string) {
  const catalog = await CatalogTransport.open({ argv: [process.execPath, "--no-env-file", "--preload",
    resolve("compatibility/omp/fixtures/no-provider.ts"), resolve("vendor/omp-candidate/cli.js"), "--rpc-catalog"],
    env: { HOME: home, PATH: "/usr/bin:/bin", BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0" }, timeoutMs: 3000 });
  try {
    const page = await catalog.catalog.page();
    expect(page.status).toBe("complete"); expect(page.items).toHaveLength(1); return page.items[0]!;
  } finally { await catalog.close(); }
}

test("a genuine rpc-ui worker continues the selected native identity with its existing history", async () => {
  const home = await mkdtemp(join(tmpdir(), "strict-native-"));
  try {
    await nativeFixture(home);
    const selected = await descriptor(home), cwd = join(home, "project");
    const worker = strictWorker(home, cwd, ["--offline", "--provider", "openai", "--model", "gpt-4o",
      "--no-extensions", "--no-skills", "--no-rules", "--no-tools", "--no-context-files"]);
    try {
      await worker.wait(frame => frame.type === "ready");
      await worker.request({ type: "negotiate_protocol", protocolVersion: 2 });
      expect(await worker.request({ type: "strict_start", intent: "continue", reference: selected.reference, expectedCwd: cwd }))
        .toMatchObject({ success: true, data: { phase: "open", intent: "continue", nativeSessionId: "native-0000",
          binding: { instanceId: selected.instanceId, sourceId: selected.sourceId } } });
      expect(await worker.request({ type: "get_state" })).toMatchObject({ success: true, data: { sessionId: "native-0000" } });
      expect(await worker.request({ type: "get_entries" })).toMatchObject({ success: true,
        data: { entries: expect.arrayContaining([expect.objectContaining({ id: "entry-0" })]) } });
      expect((await worker.close()).code).toBe(0);
    } finally { worker.child.kill(); await worker.child.exited; }
  } finally { await rm(home, { recursive: true, force: true }); }
}, 20000);

test("only explicit New creates another native identity and public state distinguishes it from Continue", async () => {
  const home = await mkdtemp(join(tmpdir(), "strict-new-"));
  try {
    await nativeFixture(home);
    const original = await descriptor(home), cwd = join(home, "project");
    const worker = strictWorker(home, cwd, ["--offline", "--provider", "openai", "--model", "gpt-4o",
      "--no-extensions", "--no-skills", "--no-rules", "--no-tools", "--no-context-files"]);
    try {
      await worker.wait(frame => frame.type === "ready");
      await worker.request({ type: "negotiate_protocol", protocolVersion: 2 });
      const opened = await worker.request({ type: "strict_start", intent: "new", expectedCwd: cwd });
      expect(opened).toMatchObject({ success: true, data: { phase: "open", intent: "new", cwd } });
      const identity = z.object({ nativeSessionId: z.string().uuid(), binding: z.object({ nativeSessionId: z.string(), instanceId: z.string() }) }).parse(opened.data);
      expect(identity.nativeSessionId).not.toBe(original.nativeSessionId);
      expect(identity.binding.nativeSessionId).toBe(identity.nativeSessionId);
      expect(await worker.request({ type: "get_strict_state" })).toMatchObject({ data: { intent: "new", nativeSessionId: identity.nativeSessionId } });
      expect(await worker.request({ type: "get_state" })).toMatchObject({ data: { sessionId: identity.nativeSessionId } });
      expect((await worker.close()).code).toBe(0);
    } finally { worker.child.kill(); await worker.child.exited; }
  } finally { await rm(home, { recursive: true, force: true }); }
}, 20000);
