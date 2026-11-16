import {expect,test} from "bun:test";
import {mkdtemp,rm,copyFile,link,readdir} from "node:fs/promises";
import {join,resolve} from "node:path";
import {tmpdir} from "node:os";
import {nativeFixture,filesystemManifest} from "../catalog/fixture.ts";
import {CatalogTransport} from "../../packages/compatibility/catalog-transport.ts";
import {strictWorker,selectedDescriptor,negotiateStrict,isolatedRuntimeArgs} from "./worker.ts";

test("missing selected physical copy never continues its same-ID sibling",async()=>{
 const home=await mkdtemp(join(tmpdir(),"strict-copies-"));
 try{const root=await nativeFixture(home),file=join(root,"bucket/native-0000.jsonl"),selected=await selectedDescriptor(home),cwd=join(home,"project");
  await copyFile(file,join(root,"bucket/same-id-copy.jsonl"));await rm(file);const before=await filesystemManifest(root),worker=strictWorker(home,cwd,isolatedRuntimeArgs);
  try{await negotiateStrict(worker);expect(await worker.request({type:"strict_start",intent:"continue",reference:selected.reference,expectedCwd:cwd})).toMatchObject({success:false,code:"STRICT_MISSING"});expect(await filesystemManifest(root)).toEqual(before);expect((await worker.close()).code).toBe(0);}finally{worker.child.kill();await worker.child.exited;}
 }finally{await rm(home,{recursive:true,force:true});}
});

test("hardlink without the bound generation controls is partial while the original exact reference remains valid",async()=>{
 const home=await mkdtemp(join(tmpdir(),"strict-alias-"));
 try{const root=await nativeFixture(home),file=join(root,"bucket/native-0000.jsonl"),selected=await selectedDescriptor(home),cwd=join(home,"project"),worker=strictWorker(home,cwd,isolatedRuntimeArgs);
  try{await negotiateStrict(worker);expect(await worker.request({type:"strict_start",intent:"continue",reference:selected.reference,expectedCwd:cwd})).toMatchObject({success:true});expect(await worker.request({type:"set_session_name",name:"Original bound generation"})).toMatchObject({success:true});await worker.close();}finally{worker.child.kill();await worker.child.exited;}
  await link(file,join(root,"bucket/alias.jsonl"));
  const catalog=await CatalogTransport.open({argv:[process.execPath,"--no-env-file","--preload",resolve("compatibility/omp/fixtures/no-provider.ts"),resolve("vendor/omp-candidate/cli.js"),"--rpc-catalog"],env:{HOME:home,PATH:"/usr/bin:/bin",BUN_RUNTIME_TRANSPILER_CACHE_PATH:"0"}});
  try{const page=await catalog.catalog.page();expect(page.status).toBe("partial");expect(page.items).toHaveLength(1);expect(page.items[0]).toMatchObject({instanceId:selected.instanceId,title:"Original bound generation"});expect(await catalog.catalog.describe(selected.reference)).toMatchObject({status:"verified"});}finally{await catalog.close();}
  expect((await readdir(join(root,"bucket"))).filter(x=>x.endsWith(".jsonl"))).toEqual(["alias.jsonl","native-0000.jsonl"]);
 }finally{await rm(home,{recursive:true,force:true});}
},20_000);
