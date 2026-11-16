import {expect,test} from "bun:test";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {nativeFixture,filesystemManifest} from "../catalog/fixture.ts";
import {strictWorker,selectedDescriptor,negotiateStrict,isolatedRuntimeArgs} from "./worker.ts";

test("generation-v1 maintenance refuses without partially deleting, moving or compressing native data",async()=>{
 const home=await mkdtemp(join(tmpdir(),"strict-maintenance-"));
 try{const root=await nativeFixture(home),cwd=join(home,"project"),file=join(root,"bucket/native-0000.jsonl"),selected=await selectedDescriptor(home),worker=strictWorker(home,cwd,isolatedRuntimeArgs);
  try{await negotiateStrict(worker);expect(await worker.request({type:"strict_start",intent:"continue",reference:selected.reference,expectedCwd:cwd})).toMatchObject({success:true});expect(await worker.request({type:"set_session_name",name:"Retained native generation"})).toMatchObject({success:true});await worker.close();}finally{worker.child.kill();await worker.child.exited;}
  const before=await filesystemManifest(root);
  const gc=Bun.spawn([process.execPath,"--no-env-file","--preload",resolve("compatibility/omp/fixtures/no-provider.ts"),resolve("vendor/omp-candidate/cli.js"),"gc","--apply","--json"],{cwd,env:{HOME:home,TMPDIR:home,PATH:"/usr/bin:/bin",BUN_RUNTIME_TRANSPILER_CACHE_PATH:"0"},stdin:"ignore",stdout:"pipe",stderr:"pipe"});
  const [output,errors,code]=await Promise.all([new Response(gc.stdout).text(),new Response(gc.stderr).text(),gc.exited]);expect(code).not.toBe(0);expect(output+errors).toContain("GENERATION_MAINTENANCE_UNSUPPORTED");expect(await filesystemManifest(root)).toEqual(before);
  const source=resolve("vendor/omp/packages/coding-agent/src/session/session-manager.ts");
  const operations=Bun.spawn([process.execPath,"--no-env-file","--preload",resolve("compatibility/omp/fixtures/no-provider.ts"),"-e",`
   import {SessionManager} from ${JSON.stringify(source)};const manager=await SessionManager.open(${JSON.stringify(file)},undefined,undefined,{throwIfMissing:true,suppressBreadcrumb:true});let code;
   try{await manager.dropSession(${JSON.stringify(file)});}catch(error){code=error.message;}finally{await manager.close();}console.log(JSON.stringify({code}));
  `],{cwd,env:{HOME:home,TMPDIR:home,PATH:"/usr/bin:/bin",BUN_RUNTIME_TRANSPILER_CACHE_PATH:"0"},stdin:"ignore",stdout:"pipe",stderr:"pipe"});
  const body=await new Response(operations.stdout).text(),error=await new Response(operations.stderr).text();if(await operations.exited)throw new Error(error);expect(JSON.parse(body)).toMatchObject({code:"STRICT_DELETE_FORBIDDEN"});expect(await filesystemManifest(root)).toEqual(before);
 }finally{await rm(home,{recursive:true,force:true});}
},20_000);
