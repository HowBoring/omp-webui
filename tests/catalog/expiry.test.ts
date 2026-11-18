import {test,expect} from "bun:test";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {CatalogTransport} from "../../packages/compatibility/catalog-transport.ts";
import {nativeFixture} from "./fixture.ts";

test("catalog cursors have an absolute real-time TTL and cannot cross child generations or page scope",async()=>{
  const home=await mkdtemp(join(tmpdir(),"catalog-ttl-"));
  const selection={argv:[process.execPath,"--no-env-file",resolve("vendor/omp-candidate/cli.js"),"--rpc-catalog"],
    env:{HOME:home,BUN_RUNTIME_TRANSPILER_CACHE_PATH:"0"}};
  let first:CatalogTransport|undefined, second:CatalogTransport|undefined;
  try {
    await nativeFixture(home,40); first=await CatalogTransport.open(selection); second=await CatalogTransport.open(selection);
    const page=await first.catalog.page(); expect(page.nextCursor).toBeDefined();
    await expect(first.catalog.page({cursor:page.nextCursor!,pageSize:1})).rejects.toThrow("CATALOG_CURSOR_SCOPE");
    await expect(second.catalog.page({cursor:page.nextCursor!})).rejects.toThrow("CATALOG_CURSOR_INVALID_OR_EXPIRED");
    await Bun.sleep(60500);
    await expect(first.catalog.page({cursor:page.nextCursor!})).rejects.toThrow("CATALOG_CURSOR_INVALID_OR_EXPIRED");
    const expectedIds = Array.from({ length: 40 }, (_, index) => `native-${String(index).padStart(4, "0")}`);
    const ids: string[] = [];
    let fresh = await first.catalog.page();
    expect(fresh.snapshot).not.toBe(page.snapshot);
    const snapshot = fresh.snapshot;
    // A scan window may return no items before the snapshot can serve its first page.
    for (let pages = 1; ; pages++) {
      expect(fresh.snapshot).toBe(snapshot);
      expect(fresh.failures).toEqual([]);
      ids.push(...fresh.items.map(item => item.nativeSessionId));
      if (!fresh.nextCursor || pages >= 100) break;
      fresh = await first.catalog.page({ cursor: fresh.nextCursor });
    }
    expect(fresh.nextCursor).toBeUndefined();
    expect(fresh.status).toBe("complete");
    expect(ids).toEqual(expectedIds);
  } finally {await first?.close();await second?.close();await rm(home,{recursive:true,force:true});}
},70000);
