import { z } from "zod";
import {expect,test} from "bun:test";
import {mkdtemp,rm,mkdir,rename,writeFile,readdir,readFile,chmod} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {CatalogTransport} from "../../packages/compatibility/catalog-transport.ts";
import {nativeFixture,filesystemManifest} from "../catalog/fixture.ts";
import {strictWorker,negotiateStrict,isolatedRuntimeArgs} from "./worker.ts";

async function fixture(home:string){
 const root=await nativeFixture(home,2),cwd=join(home,"project");
 const catalog=await CatalogTransport.open({argv:[process.execPath,"--no-env-file","--preload",resolve("compatibility/omp/fixtures/no-provider.ts"),resolve("vendor/omp-candidate/cli.js"),"--rpc-catalog"],env:{HOME:home,PATH:"/usr/bin:/bin",BUN_RUNTIME_TRANSPILER_CACHE_PATH:"0"}});
 let items;try{items=(await catalog.catalog.page()).items;}finally{await catalog.close();}
 for(const item of items){const worker=strictWorker(home,cwd,isolatedRuntimeArgs);try{await negotiateStrict(worker);expect(await worker.request({type:"strict_start",intent:"continue",reference:item.reference,expectedCwd:cwd})).toMatchObject({success:true});expect(await worker.request({type:"set_session_name",name:item.nativeSessionId==="native-0000"?"Parent generation":"Child generation"})).toMatchObject({success:true});await worker.close();}finally{worker.child.kill();await worker.child.exited;}}
 const parent=join(root,"bucket/native-0000.jsonl"),artifacts=parent.slice(0,-6),child=join(artifacts,"child.jsonl");await mkdir(artifacts);
 await rename(join(root,"bucket/native-0001.jsonl"),child);await rename(join(root,"bucket/.native-0001.jsonl.omp-generations"),join(artifacts,".child.jsonl.omp-generations"));
 await writeFile(join(artifacts,"tool.log.jsonl"),'{"tool":"fixture","result":"kept"}\n');
 return {root,cwd,parent,artifacts,child};
}
for(const operation of ["copy","fork","branch","new_session"] as const)test(`native ${operation} preserves valid nested generation history using complete fresh files`,async()=>{
 const home=await mkdtemp(join(tmpdir(),"strict-nested-"));
 try{const value=await fixture(home),before=await filesystemManifest(value.artifacts);let destination:string|undefined;
  if(operation==="copy"){
   destination=join(home,"explicit-copy");
   const source=resolve("vendor/omp/packages/coding-agent/src/session/session-manager.ts");
   const copy=Bun.spawn([process.execPath,"--no-env-file","--preload",resolve("compatibility/omp/fixtures/no-provider.ts"),"-e",`import {copySessionArtifacts} from ${JSON.stringify(source)};await copySessionArtifacts(${JSON.stringify(value.parent)},${JSON.stringify(destination+".jsonl")});`],{cwd:value.cwd,env:{HOME:home,TMPDIR:home,PATH:"/usr/bin:/bin",BUN_RUNTIME_TRANSPILER_CACHE_PATH:"0"},stdout:"pipe",stderr:"pipe"});
   const errors=await new Response(copy.stderr).text();if(await copy.exited)throw new Error(errors);
  }else if(operation==="branch"){
   const source=resolve("vendor/omp/packages/coding-agent/src/session/session-manager.ts");
   const branch=Bun.spawn([process.execPath,"--no-env-file","--preload",resolve("compatibility/omp/fixtures/no-provider.ts"),"-e",`import {SessionManager} from ${JSON.stringify(source)};const manager=await SessionManager.open(${JSON.stringify(value.parent)},undefined,undefined,{throwIfMissing:true,suppressBreadcrumb:true});try{const file=manager.createBranchedSession("entry-0",{copyArtifacts:true});await manager.flush();console.log(JSON.stringify({file}));}finally{await manager.close();}`],{cwd:value.cwd,env:{HOME:home,TMPDIR:home,PATH:"/usr/bin:/bin",BUN_RUNTIME_TRANSPILER_CACHE_PATH:"0"},stdout:"pipe",stderr:"pipe"});
   const output=await new Response(branch.stdout).text(),errors=await new Response(branch.stderr).text();if(await branch.exited)throw new Error(errors);destination=z.object({file:z.string()}).parse(JSON.parse(output)).file.slice(0,-6);
  }else{
   const worker=strictWorker(home,value.cwd,isolatedRuntimeArgs,value.parent);
   try{await negotiateStrict(worker);expect(await worker.request({type:operation})).toMatchObject({success:true,data:{cancelled:false}});
    const state=await worker.request({type:"get_state"});const data=z.object({sessionId:z.string(),sessionFile:z.string()}).parse(state.data);expect(data.sessionId).not.toBe("native-0000");destination=data.sessionFile.slice(0,-6);expect((await worker.close()).code).toBe(0);
   }finally{worker.child.kill();await worker.child.exited;}
  }
  if(operation!=="new_session"){const bytes=await readFile(join(destination!,"child.jsonl"),"utf8");expect(bytes).toContain('"type":"session"');expect(bytes).not.toContain('"type":"ompgen1"');expect(bytes).toContain("Child generation");expect(bytes).toContain('"id":"entry-1"');expect(await Bun.file(join(destination!,"tool.log.jsonl")).text()).toContain('"result":"kept"');expect((await readdir(destination!)).some(name=>name.includes("omp-generations"))).toBe(false);}
  expect(await filesystemManifest(value.artifacts)).toEqual(before);
 }finally{await rm(home,{recursive:true,force:true});}
},30_000);

test("an occupied native child refuses parent fork before publishing another parent or copying incomplete artifacts",async()=>{
 const home=await mkdtemp(join(tmpdir(),"strict-nested-owned-"));
 try{const value=await fixture(home),owner=strictWorker(home,value.cwd,isolatedRuntimeArgs,value.child),parent=strictWorker(home,value.cwd,isolatedRuntimeArgs,value.parent);
  try{await negotiateStrict(owner);await owner.request({type:"get_state"});await negotiateStrict(parent);await parent.request({type:"get_state"});const before=await filesystemManifest(value.root);
   expect(await parent.request({type:"fork"})).toMatchObject({success:false});expect(await parent.request({type:"get_state"})).toMatchObject({data:{sessionId:"native-0000",sessionFile:value.parent}});expect(await filesystemManifest(value.root)).toEqual(before);expect(owner.child.exitCode).toBeNull();
  }finally{await parent.close();await owner.close();parent.child.kill();owner.child.kill();await Promise.all([parent.child.exited,owner.child.exited]);}
 }finally{await rm(home,{recursive:true,force:true});}
},30_000);

for(const damage of ["corrupt-child","occupied-destination"] as const)test(`native logical copy refuses ${damage} before publishing final files`,async()=>{
 const home=await mkdtemp(join(tmpdir(),"strict-nested-refusal-"));
 try{const value=await fixture(home),destination=join(home,"new-artifacts");
  if(damage==="corrupt-child"){const directory=join(value.artifacts,".child.jsonl.omp-generations"),body=(await readdir(directory)).find(name=>name.endsWith(".gen"));if(!body)throw new Error("NO_CHILD_GENERATION");const file=join(directory,body),bytes=await readFile(file);bytes[bytes.length-10]=88;await chmod(file,0o600);await writeFile(file,bytes);}
  else{await mkdir(destination);await writeFile(join(destination,"child.jsonl"),"existing replacement must survive");}
  const before=await filesystemManifest(value.artifacts),source=resolve("vendor/omp/packages/coding-agent/src/session/session-manager.ts");
  const child=Bun.spawn([process.execPath,"--no-env-file","--preload",resolve("compatibility/omp/fixtures/no-provider.ts"),"-e",`import {copySessionArtifacts} from ${JSON.stringify(source)};try{await copySessionArtifacts(${JSON.stringify(value.parent)},${JSON.stringify(destination+".jsonl")});console.log(JSON.stringify({success:true}));}catch(error){console.log(JSON.stringify({success:false,code:error.message}));}`],{cwd:value.cwd,env:{HOME:home,TMPDIR:home,PATH:"/usr/bin:/bin",BUN_RUNTIME_TRANSPILER_CACHE_PATH:"0"},stdout:"pipe",stderr:"pipe"});
  const output=await new Response(child.stdout).text(),errors=await new Response(child.stderr).text();if(await child.exited)throw new Error(errors);expect(JSON.parse(output)).toMatchObject({success:false});expect(await filesystemManifest(value.artifacts)).toEqual(before);
  if(damage==="corrupt-child")expect(await Bun.file(join(destination,"child.jsonl")).exists()).toBe(false);
  else{expect(await Bun.file(join(destination,"child.jsonl")).text()).toBe("existing replacement must survive");expect(await readdir(destination)).toEqual(["child.jsonl"]);}
 }finally{await rm(home,{recursive:true,force:true});}
},30_000);

test("actual short write to an anonymous nested copy cannot publish a partial native child",async()=>{
 const home=await mkdtemp(join(tmpdir(),"strict-nested-short-"));
 try{const value=await fixture(home),before=await filesystemManifest(value.artifacts),worker=strictWorker(home,value.cwd,isolatedRuntimeArgs,value.parent,{name:"short-new-copy",target:value.parent});
  try{await negotiateStrict(worker);await worker.request({type:"get_state"});expect(await worker.request({type:"fork"})).toMatchObject({success:false});
   expect(await Bun.file(join(home,"strict-syscalls.log")).text()).toContain('"event":"short-new-copy","actual_written":20');
   const state=await worker.request({type:"get_state"}),data=z.object({sessionFile:z.string()}).parse(state.data);expect(await Bun.file(join(data.sessionFile.slice(0,-6),"child.jsonl")).exists()).toBe(false);expect(await filesystemManifest(value.artifacts)).toEqual(before);
  }finally{await worker.close();worker.child.kill();await worker.child.exited;}
 }finally{await rm(home,{recursive:true,force:true});}
},30_000);
