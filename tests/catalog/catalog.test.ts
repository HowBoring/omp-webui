import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, symlink, link, copyFile, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { CatalogTransport } from "../../packages/compatibility/catalog-transport.ts";
import { nativeFixture, filesystemManifest } from "./fixture.ts";

async function open(home:string,env:Record<string,string> = {}) {
  return CatalogTransport.open({argv:[process.execPath,"--no-env-file",resolve("vendor/omp-candidate/cli.js"),"--rpc-catalog"],
    env:{HOME:home,BUN_RUNTIME_TRANSPILER_CACHE_PATH:"0",...env},timeoutMs:3000});
}

test("all 1000 native Sessions remain reachable in bounded stable pages and readonly filesystem", async () => {
  const home = await mkdtemp(join(tmpdir(),"catalog-scale-"));
  try {
    await nativeFixture(home,1000,undefined,1000);
    const before = await filesystemManifest(home), client = await open(home);
    try {
      const sources = await client.catalog.sources();
      expect(sources.profile).toBe("default");
      const ids:string[] = []; let cursor:string|undefined; let examined = 0; let pages = 0;
      do {
        const page = await client.catalog.page({pageSize:32,...(cursor ? {cursor}:{})});
        expect(page.examined-examined).toBeLessThanOrEqual(256);
        expect(Buffer.byteLength(JSON.stringify(page))+1024).toBeLessThanOrEqual(262144);
        expect(page.failures).toEqual([]);
        examined = page.examined;
        ids.push(...page.items.map(item => item.nativeSessionId)); cursor = page.nextCursor; pages++;
      } while (cursor && pages<100);
      expect(cursor).toBeUndefined();
      expect(ids).toEqual(Array.from({length:1000},(_,index)=>`native-${String(index).padStart(4,"0")}`));
      expect(examined).toBe(2001);
      expect(await filesystemManifest(home)).toEqual(before);
    } finally { expect(await client.close()).toEqual({code:0,forced:false,stderrBytes:0}); }
  } finally { await rm(home,{recursive:true,force:true}); }
},15000);

test("profile and explicit custom sources exclude other profiles, merge verified aliases, retain same-ID copies and unknown cwd", async () => {
  const home = await mkdtemp(join(tmpdir(),"catalog-identities-"));
  try {
    const root = await nativeFixture(home,1,"selected");
    await nativeFixture(home,2);
    const custom = join(home,"custom"); await mkdir(custom);
    await copyFile(join(root,"bucket/native-0000.jsonl"),join(custom,"copy.jsonl"));
    await link(join(root,"bucket/native-0000.jsonl"),join(root,"bucket/hardlink.jsonl"));
    await symlink(join(root,"bucket/native-0000.jsonl"),join(root,"bucket/alias.jsonl"));
    await symlink(root,join(home,"source-alias"));
    await Bun.write(join(custom,"unknown.jsonl"),'{"type":"session","id":"unknown-cwd","timestamp":"2026-01-01T00:00:00Z"}\n');
    const client = await open(home,{OMP_PROFILE:"selected",OMP_CATALOG_SOURCES:JSON.stringify([custom,join(home,"source-alias")])});
    try {
      const sources = await client.catalog.sources(); expect(sources.sources.length).toBe(2);
      const page = await client.catalog.page(); expect(page.status).toBe("complete"); expect(page.items.length).toBe(3);
      const originals = page.items.filter(item=>item.nativeSessionId === "native-0000");
      expect(originals.length).toBe(2); expect(new Set(originals.map(item=>item.instanceId)).size).toBe(2);
      expect(originals.map(item=>item.aliases.length).sort()).toEqual([1,3]);
      expect(page.items.find(item=>item.nativeSessionId === "unknown-cwd")?.cwd).toEqual({status:"unknown"});
      for (const item of page.items) expect((await client.catalog.describe(item.reference)).status).toBe("verified");
    } finally { await client.close(); }
  } finally { await rm(home,{recursive:true,force:true}); }
});

test("missing and replaced references fail explicitly, outside-source symlinks are partial failures and directory changes stale pages", async () => {
  const home = await mkdtemp(join(tmpdir(),"catalog-replacement-"));
  try {
    const root = await nativeFixture(home,40);
    const outside = join(home,"outside.jsonl");
    await Bun.write(outside,'{"type":"session","id":"must-not-leak","timestamp":"2026-01-01T00:00:00Z"}\n');
    await symlink(outside,join(root,"escape.jsonl"));
    const client = await open(home,{OMP_CATALOG_SOURCES:JSON.stringify([join(home,"missing-source")])});
    try {
      const page = await client.catalog.page(); expect(page.status).toBe("partial");
      expect(page.failures.map(item=>item.code).sort()).toEqual(["INVALID_SOURCE","OUTSIDE_SOURCE"]);
      const item = page.items[0]!; const file = join(root,item.aliases[0]!);
      await copyFile(file,join(home,"replacement.jsonl"));
      await rename(join(home,"replacement.jsonl"),file);
      expect((await client.catalog.describe(item.reference)).status).toBe("replaced");
      await rm(file); expect((await client.catalog.describe(item.reference)).status).toBe("missing");
      await expect(client.catalog.page({cursor:page.nextCursor!})).rejects.toThrow("CATALOG_STALE");
      expect((await client.catalog.describe("../../etc/passwd")).status).toBe("invalid_reference");
      expect((await client.catalog.describe(Buffer.from(JSON.stringify({sourceId:item.sourceId,instanceId:item.instanceId,
        nativeSessionId:item.nativeSessionId,locator:"../outside.jsonl"})).toString("base64url"))).status).toBe("invalid_reference");
    } finally { await client.close(); }
  } finally { await rm(home,{recursive:true,force:true}); }
});

test("native ownership observations see another process without acquiring or writing a lease", async () => {
  const home = await mkdtemp(join(tmpdir(),"catalog-owner-"));
  try {
    await nativeFixture(home);
    const lockModule = resolve("vendor/omp-runtime/node_modules/@oh-my-pi/pi-utils/src/file-lock.ts");
    const holder = Bun.spawn([process.execPath,"--no-env-file","-e",`import {tryAcquireFileLock} from ${JSON.stringify(lockModule)};
      const lock=tryAcquireFileLock(${JSON.stringify(join(home,".omp/run/session-owners/native-0000"))});
      if(!lock)process.exit(4);console.log("held");for await(const _ of Bun.stdin.stream()){};lock.release();`],
      {env:{HOME:home,BUN_RUNTIME_TRANSPILER_CACHE_PATH:"0"},stdin:"pipe",stdout:"pipe",stderr:"pipe"});
    const reader = holder.stdout.getReader(); expect(new TextDecoder().decode((await reader.read()).value)).toContain("held");
    const before = await filesystemManifest(home), client = await open(home);
    try {
      const page = await client.catalog.page(); const item = page.items[0]!;
      expect(item.ownership.state).toBe("held"); expect(Number.isFinite(Date.parse(item.ownership.observedAt))).toBe(true);
      expect((await client.catalog.describe(item.reference)).item?.ownership.state).toBe("held");
      holder.stdin.end(); expect(await holder.exited).toBe(0);
      expect((await client.catalog.describe(item.reference)).item?.ownership.state).toBe("free");
      expect(await filesystemManifest(home)).toEqual(before);
    } finally { holder.kill(); await client.close(); }
  } finally { await rm(home,{recursive:true,force:true}); }
});

test("native scan cost limit is explicit and oversized/corrupt headers stay partial", async () => {
  const home = await mkdtemp(join(tmpdir(),"catalog-cost-"));
  try {
    const root = await nativeFixture(home);
    await Bun.write(join(root,"bucket/huge.jsonl"),JSON.stringify({type:"session",id:"huge",timestamp:"2026-01-01T00:00:00Z",title:"x".repeat(20000)})+"\n");
    await Bun.write(join(root,"bucket/bad.jsonl"),"bad header\n");
    for (let index=0;index<8200;index++) await Bun.write(join(root,`ignored-${index}`),"");
    const client = await open(home);
    try {
      let cursor:string|undefined, examined=0, limited=false, steps=0;
      do {
        const page = await client.catalog.page({...(cursor ? {cursor}:{})});
        expect(page.examined-examined).toBeLessThanOrEqual(256); expect(page.examined).toBeLessThanOrEqual(8192);
        examined=page.examined; cursor=page.nextCursor; limited ||= page.failures.some(item=>item.code === "SCAN_LIMIT"); steps++;
      } while(cursor && steps<100);
      expect(cursor).toBeUndefined(); expect(limited).toBe(true);
    } finally {await client.close();}
    // A separate clean snapshot proves distinct native parse/byte failures without depending on directory enumeration order.
    for (let index=0;index<8200;index++) await rm(join(root,`ignored-${index}`));
    const clean = await open(home);
    try {
      const page=await clean.catalog.page(); expect(page.status).toBe("partial");
      expect(page.failures.map(item=>item.code).sort()).toEqual(["HEADER_LIMIT","INVALID_METADATA"]);
      expect(page.items.map(item=>item.nativeSessionId)).toEqual(["native-0000"]);
    } finally {await clean.close();}
  } finally {await rm(home,{recursive:true,force:true});}
},15000);

test("source root replacement never redirects a durable reference into a different tree", async () => {
  const home = await mkdtemp(join(tmpdir(),"catalog-root-swap-"));
  try {
    const root=await nativeFixture(home); const client=await open(home);
    try {
      const item=(await client.catalog.page()).items[0]!;
      await rename(root,`${root}-original`); await nativeFixture(home);
      expect((await client.catalog.describe(item.reference)).status).toBe("source_unavailable");
      await expect(client.catalog.page()).rejects.toThrow("CATALOG_STALE");
    } finally {await client.close();}
  } finally {await rm(home,{recursive:true,force:true});}
});

test("native lease backend errors surface unknown rather than free (real syscall fault)",async()=>{
  const home=await mkdtemp(join(tmpdir(),"catalog-unknown-"));
  try {
    await nativeFixture(home);
    const client=await CatalogTransport.open({argv:["/usr/bin/strace","-f","-e","inject=socket:error=EMFILE","-o",join(home,"native-socket.trace"),
      process.execPath,"--no-env-file",resolve("vendor/omp-candidate/cli.js"),"--rpc-catalog"],
      env:{HOME:home,BUN_RUNTIME_TRANSPILER_CACHE_PATH:"0"}});
    try { expect((await client.catalog.page()).items[0]?.ownership.state).toBe("unknown"); }
    finally {await client.close();}
  } finally {await rm(home,{recursive:true,force:true});}
});
