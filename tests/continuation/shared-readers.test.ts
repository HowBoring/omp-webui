import { expect, test } from "bun:test";
import { mkdtemp, rm, appendFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { nativeFixture } from "../catalog/fixture.ts";
import { strictWorker, selectedDescriptor, negotiateStrict, isolatedRuntimeArgs } from "./worker.ts";

test("large native loaders, logical byte readers and flattened archive export agree on the committed generation", async () => {
  const home = await mkdtemp(join(tmpdir(), "strict-readers-"));
  try {
    const root = await nativeFixture(home), file = join(root, "bucket/native-0000.jsonl"), cwd = join(home, "project");
    await appendFile(file, JSON.stringify({type:"custom",id:"fixture-padding",parentId:"entry-0",timestamp:"2026-01-01T00:00:02Z",customType:"fixture-padding",data:{padding:"x".repeat(9*1024*1024)}})+"\n");
    const selected = await selectedDescriptor(home), worker = strictWorker(home, cwd, isolatedRuntimeArgs);
    try { await negotiateStrict(worker);
      expect(await worker.request({type:"strict_start",intent:"continue",reference:selected.reference,expectedCwd:cwd})).toMatchObject({success:true});
      expect(await worker.request({type:"set_session_name",name:"Large committed native title"})).toMatchObject({success:true});
      expect((await worker.close()).code).toBe(0);
    } finally { worker.child.kill(); await worker.child.exited; }
    const source = resolve("vendor/omp/packages/coding-agent/src"), archive = join(home,"native.tar"), out = join(home,"flattened");await mkdir(out);
    const probe = Bun.spawn([process.execPath,"--no-env-file","--preload",resolve("compatibility/omp/fixtures/no-provider.ts"),"-e",`
      import {loadSessionFile,visitEntriesFromFileStream} from ${JSON.stringify(join(source,"session/session-loader.ts"))};
      import {FileSessionStorage} from ${JSON.stringify(join(source,"session/session-storage.ts"))};
      import {readRpcSubagentTranscript} from ${JSON.stringify(join(source,"modes/rpc/rpc-subagents.ts"))};
      import {packSession} from ${JSON.stringify(join(source,"session/session-transfer.ts"))};
      const file=${JSON.stringify(file)};const loaded=await loadSessionFile(file);let visited=0;await visitEntriesFromFileStream(file,()=>{visited++;});
      const storage=new FileSessionStorage(),text=await storage.readText(file),stats=storage.statSync(file),rpc=await readRpcSubagentTranscript(file);
      const resumed=await readRpcSubagentTranscript(file,rpc.nextByte);
      const packed=await packSession(file,${JSON.stringify(archive)});
      console.log(JSON.stringify({invalid:loaded?.invalidHeader,ids:loaded?.entries.map(e=>e.id),visited,logicalBytes:Buffer.byteLength(text),statBytes:stats?.size,rpcBytes:rpc.nextByte,resumedReset:resumed.reset,resumedBytes:resumed.nextByte,title:loaded?.titleSlot?.title,carrierLeaked:text.includes('"type":"ompgen1"'),packed:packed.id}));
    `],{cwd,env:{HOME:home,TMPDIR:home,PATH:"/usr/bin:/bin",BUN_RUNTIME_TRANSPILER_CACHE_PATH:"0"},stdin:"ignore",stdout:"pipe",stderr:"pipe"});
    const [output,errors,code] = await Promise.all([new Response(probe.stdout).text(),new Response(probe.stderr).text(),probe.exited]);
    if(code) throw new Error(errors);const value=JSON.parse(output);
    expect(value).toMatchObject({invalid:false,title:"Large committed native title",carrierLeaked:false,packed:"native-0000"});
    expect(value.ids).toContain("fixture-padding");expect(value.ids).toContain("entry-0");
    expect(value.logicalBytes).toBeGreaterThan(8*1024*1024);expect(value.statBytes).toBe(value.logicalBytes);expect(value.rpcBytes).toBe(value.logicalBytes);expect(value.resumedReset).toBe(true);expect(value.resumedBytes).toBe(value.logicalBytes);
    const unpack=Bun.spawn(["tar","-xf",archive,"-C",out,"session.jsonl"],{stdout:"pipe",stderr:"pipe"});expect(await unpack.exited).toBe(0);
    const flat=await Bun.file(join(out,"session.jsonl")).text();expect(flat).toContain('"type":"session"');expect(flat).not.toContain('"type":"ompgen1"');expect(flat).toContain("Large committed native title");
  } finally {await rm(home,{recursive:true,force:true});}
},30_000);
