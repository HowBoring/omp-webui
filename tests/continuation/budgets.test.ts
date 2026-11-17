import { expect,test } from "bun:test";
import { mkdtemp,rm,readdir,writeFile,truncate } from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {nativeFixture} from "../catalog/fixture.ts";
import {strictWorker,selectedDescriptor,negotiateStrict,isolatedRuntimeArgs} from "./worker.ts";

for(const bound of ["generations","retained-bytes"] as const)test(`native generation ${bound} refuses before publication and does not replay on close`,async()=>{
 const home=await mkdtemp(join(tmpdir(),"strict-budget-"));
 try{
  const root=await nativeFixture(home),cwd=join(home,"project"),selected=await selectedDescriptor(home),worker=strictWorker(home,cwd,isolatedRuntimeArgs);
  try{
   await negotiateStrict(worker);expect(await worker.request({type:"strict_start",intent:"continue",reference:selected.reference,expectedCwd:cwd})).toMatchObject({success:true});
   expect(await worker.request({type:"set_session_name",name:"Last committed title"})).toMatchObject({success:true});
   const directory=join(root,"bucket/.native-0000.jsonl.omp-generations");
   if(bound==="generations") for(let n=0;n<63;n++)await writeFile(join(directory,crypto.randomUUID()+".gen"),"x");
   else {const file=join(directory,crypto.randomUUID()+".gen");await writeFile(file,"");await truncate(file,512*1024*1024);}
   // Avoid hashing a deliberately sparse quota fixture; exact carrier/control identities and directory entries suffice here.
   const carrier=join(root,"bucket/native-0000.jsonl"),before=await Bun.file(carrier).text(),names=(await readdir(directory)).sort();
   expect(await worker.request({type:"set_session_name",name:"Must not publish"})).toMatchObject({success:false});
   expect(await Bun.file(carrier).text()).toBe(before);expect((await readdir(directory)).sort()).toEqual(names);
   await worker.close();expect(await Bun.file(carrier).text()).toBe(before);expect((await readdir(directory)).sort()).toEqual(names);
  }finally{worker.child.kill();await worker.child.exited;}
 }finally{await rm(home,{recursive:true,force:true});}
},20_000);
