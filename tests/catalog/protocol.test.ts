import{test,expect}from"bun:test";
import{mkdtemp,rm}from"node:fs/promises";
import{tmpdir}from"node:os";
import{join,resolve}from"node:path";
import{CatalogTransport}from"../../packages/compatibility/catalog-transport.ts";
import{nativeFixture,filesystemManifest}from"./fixture.ts";

test("catalog-only mode refuses ordinary Session commands, oversize input and partial EOF without native effects",async()=>{
  const home=await mkdtemp(join(tmpdir(),"catalog-protocol-"));
  try{
    await nativeFixture(home);const before=await filesystemManifest(home);
    for(const input of ['{"id":"bad","type":"new_session"}\n','x'.repeat(16385),'{"id":"partial"']){
      const child=Bun.spawn([process.execPath,"--no-env-file",resolve("vendor/omp-candidate/cli.js"),"--rpc-catalog"],{
        env:{HOME:home,BUN_RUNTIME_TRANSPILER_CACHE_PATH:"0"},stdin:"pipe",stdout:"pipe",stderr:"pipe"});
      child.stdin.write(input);child.stdin.end();await new Response(child.stdout).text();
      expect(await child.exited).not.toBe(0);
    }
    expect(await filesystemManifest(home)).toEqual(before);
  }finally{await rm(home,{recursive:true,force:true});}
});

test("cancelled readonly catalog child is drained and reaped, and no prior cursor is replayed after restart",async()=>{
  const home=await mkdtemp(join(tmpdir(),"catalog-cancel-"));
  try{
    await nativeFixture(home,300);const signal=new AbortController();
    const client=await CatalogTransport.open({argv:[process.execPath,"--no-env-file",resolve("vendor/omp-candidate/cli.js"),"--rpc-catalog"],
      env:{HOME:home,BUN_RUNTIME_TRANSPILER_CACHE_PATH:"0"},signal:signal.signal});
    const page=await client.catalog.page();expect(page.status).toBe("scanning");
    signal.abort();await expect(client.catalog.page({cursor:page.nextCursor!})).rejects.toThrow("RPC_CANCELLED");
    const drain=await client.close();expect(drain.protocolFailure).toBe("RPC_CANCELLED");
    expect(()=>process.kill(client.processId,0)).toThrow();
  }finally{await rm(home,{recursive:true,force:true});}
});
