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
    expect((await first.catalog.page()).items.length).toBe(32);
  } finally {await first?.close();await second?.close();await rm(home,{recursive:true,force:true});}
},70000);
