import { expect, test } from "bun:test";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { CatalogTransport } from "../../packages/compatibility/catalog-transport.ts";
import { filesystemManifest, sessionManagerFixture, nativeTitleSlots } from "./fixture.ts";

const open = (home: string) => CatalogTransport.open({
  argv: [process.execPath, "--no-env-file", resolve("vendor/omp-candidate/cli.js"), "--rpc-catalog"],
  env: { HOME: home, BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0" },
});

test("actual native empty and serialized titled Sessions are discovered and described without mutation", async () => {
  const home = await mkdtemp(join(tmpdir(), "catalog-actual-layout-"));
  try {
    const fixture = await sessionManagerFixture(home);
    const before = await filesystemManifest(home);
    const client = await open(home);
    try {
      const page = await client.catalog.page();
      expect(page.status).toBe("complete");
      expect(page.failures).toEqual([]);
      expect(page.items).toHaveLength(2);
      const titled = page.items.find(item => item.nativeSessionId === fixture.id)!;
      expect(titled.title).toBe("Actual native slot title");
      expect(titled.cwd).toEqual({ recorded: join(home, "project"), canonical: join(home, "project"), status: "known" });
      expect(page.items.find(item => item.nativeSessionId !== fixture.id)?.title).toBeUndefined();
      for (const item of page.items) {
        const description = await client.catalog.describe(item.reference);
        expect(description.status).toBe("verified");
        expect(description.item?.nativeSessionId).toBe(item.nativeSessionId);
        expect(description.item?.title).toBe(item.title);
      }
      expect(await filesystemManifest(home)).toEqual(before);
    } finally { expect(await client.close()).toEqual({ code: 0, forced: false, stderrBytes: 0 }); }
  } finally { await rm(home, { recursive: true, force: true }); }
}, 15000);


test("canonical title slots share the fixed header budget, override legacy titles and never hide corrupt leading metadata", async () => {
  const home = await mkdtemp(join(tmpdir(), "catalog-slot-boundary-"));
  try {
    const root = join(home, ".omp/agent/sessions/bucket"); await mkdir(root, { recursive: true });
    const [current, empty] = await nativeTitleSlots(["汉".repeat(20), ""]);
    if (current === undefined || empty === undefined) throw new Error("NATIVE_SLOT_FIXTURE_RESULT");
    expect(Buffer.byteLength(current!)).toBe(256);
    const header = (id: string) => ({type:"session",id,timestamp:"2026-01-01T00:00:00Z",title:"Stale header title"});
    const padded = JSON.stringify({...header("at-boundary"),pad:""});
    const exact = JSON.stringify({...header("at-boundary"),pad:"x".repeat(16384-256-Buffer.byteLength(padded)-1)})+"\n";
    const cases = {
      "legacy.jsonl": JSON.stringify({...header("legacy"),title:"Legacy header title"})+"\n",
      "current.jsonl": current+JSON.stringify(header("current"))+"\n"+"unparsed transcript tail\n".repeat(2000),
      "empty-title.jsonl": empty+JSON.stringify(header("empty-title"))+"\n",
      "boundary.jsonl": current+exact,
      "over-budget.jsonl": current+exact.replace('"pad":"', '"pad":"x'),
      "slot-only.jsonl": current!,
      "corrupt-slot.jsonl": current!.replace('"v":1','"v":2')+JSON.stringify(header("must-not-salvage"))+"\n",
      "two-slots.jsonl": current+empty+JSON.stringify(header("must-not-skip"))+"\n",
      "bad-header.jsonl": current+"malformed header\n"+JSON.stringify(header("must-not-search"))+"\n",
      "oversized-slot.jsonl": current!.trimEnd().slice(0,-1)+" ".repeat(16384)+"}\n"+exact,
    };
    expect(Buffer.byteLength(cases["boundary.jsonl"])).toBe(16384);
    for (const [file, contents] of Object.entries(cases)) await Bun.write(join(root,file),contents);
    await Bun.write(join(root,"invalid-utf8-header.jsonl"), Buffer.concat([Buffer.from(current!),Buffer.from([255,10])]));
    const before = await filesystemManifest(home), client = await open(home);
    try {
      const page = await client.catalog.page();
      expect(page.status).toBe("partial");
      expect(page.items.map(item=>item.nativeSessionId)).toEqual(["at-boundary","current","empty-title","legacy"]);
      expect(page.items.map(item=>item.title)).toEqual(["汉".repeat(20),"汉".repeat(20),undefined,"Legacy header title"]);
      expect(page.failures.map(failure=>failure.code).sort()).toEqual([
        "ERR_ENCODING_INVALID_ENCODED_DATA","HEADER_LIMIT","HEADER_LIMIT","HEADER_LIMIT",
        "INVALID_HEADER","INVALID_HEADER","INVALID_METADATA",
      ]);
      for (const item of page.items) expect((await client.catalog.describe(item.reference)).status).toBe("verified");
      expect(await filesystemManifest(home)).toEqual(before);
    } finally { await client.close(); }
  } finally { await rm(home,{recursive:true,force:true}); }
});
