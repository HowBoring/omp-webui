import {expect,test} from "bun:test";
import {mkdtemp,rm,rename,mkdir,copyFile} from "node:fs/promises";
import {join,resolve} from "node:path";
import {tmpdir} from "node:os";
import {nativeFixture,filesystemManifest} from "../catalog/fixture.ts";
import {strictWorker,selectedDescriptor,negotiateStrict,isolatedRuntimeArgs} from "./worker.ts";

for(const invalid of ["reference","cwd"] as const)test(`startup extension effects cannot precede ${invalid} validation and ownership`,async()=>{
 const home=await mkdtemp(join(tmpdir(),"strict-order-"));
 try{const root=await nativeFixture(home),selected=await selectedDescriptor(home),cwd=join(home,"project"),before=await filesystemManifest(root);
  const args=isolatedRuntimeArgs.filter(arg=>arg!=="--no-extensions").concat(["--extension",resolve("tests/continuation/startup-extension.ts")]);const worker=strictWorker(home,cwd,args);
  try{await negotiateStrict(worker);expect(await worker.request({type:"strict_start",intent:"continue",reference:invalid==="reference"?"invalid":selected.reference,expectedCwd:invalid==="cwd"?home:cwd})).toMatchObject({success:false});
   expect(await Bun.file(join(home,"strict-extension-effect.json")).exists()).toBe(false);expect(await filesystemManifest(root)).toEqual(before);await worker.close();
  }finally{worker.child.kill();await worker.child.exited;}
 }finally{await rm(home,{recursive:true,force:true});}
});

test("cancelling a genuine startup UI after extension effects never claims a clean rollback",async()=>{
 const home=await mkdtemp(join(tmpdir(),"strict-order-ui-"));
 try{const root=await nativeFixture(home),selected=await selectedDescriptor(home),cwd=join(home,"project"),before=await filesystemManifest(root);
  const worker=strictWorker(home,cwd,isolatedRuntimeArgs.filter(arg=>arg!=="--no-extensions").concat(["--extension",resolve("tests/continuation/startup-extension.ts")]));
  try{await negotiateStrict(worker);worker.send({id:"opening-ui",type:"strict_start",intent:"continue",reference:selected.reference,expectedCwd:cwd});
   await worker.wait(frame=>frame.type==="extension_ui_request"&&frame.method==="input");
   expect(await Bun.file(join(home,"strict-extension-effect.json")).json()).toEqual({nativeSessionId:"native-0000",cwd});
   expect(await worker.request({type:"get_strict_state"})).toMatchObject({data:{phase:"opening"}});
   expect(await worker.request({type:"cancel_strict_start"})).toMatchObject({data:{phase:"cancelling",code:"STRICT_CANCEL_REQUESTED"}});
   const drain=await worker.close();expect(drain.code).not.toBe(137);expect(worker.frames.some(frame=>frame.command==="strict_start"&&frame.success===true)).toBe(false);
   expect(await filesystemManifest(root)).toEqual(before);
  }finally{worker.child.kill();await worker.child.exited;}
 }finally{await rm(home,{recursive:true,force:true});}
},20_000);

for(const area of ["cwd","source","bucket"] as const)test(`owned ${area} namespace replacement cannot redirect a native rewrite`,async()=>{
 const home=await mkdtemp(join(tmpdir(),"strict-namespace-"));
 try{const root=await nativeFixture(home),selected=await selectedDescriptor(home),cwd=join(home,"project"),worker=strictWorker(home,cwd,isolatedRuntimeArgs);
  try{await negotiateStrict(worker);expect(await worker.request({type:"strict_start",intent:"continue",reference:selected.reference,expectedCwd:cwd})).toMatchObject({success:true});
   const target=area==="cwd"?cwd:area==="source"?root:join(root,"bucket");await rename(target,target+".held");await mkdir(target);
   const replacement=area==="source"?join(target,"bucket/native-0000.jsonl"):area==="bucket"?join(target,"native-0000.jsonl"):undefined;
   if(replacement){await mkdir(join(replacement,".."),{recursive:true});await copyFile(area==="source"?join(target+".held","bucket/native-0000.jsonl"):join(target+".held","native-0000.jsonl"),replacement);}
   const before=await filesystemManifest(target);
   expect(await worker.request({type:"set_session_name",name:"Must not redirect"})).toMatchObject({success:false});expect(await worker.request({type:"get_strict_state"})).toMatchObject({data:{phase:"outcome_unknown"}});expect(await filesystemManifest(target)).toEqual(before);
  }finally{await worker.close();worker.child.kill();await worker.child.exited;}
 }finally{await rm(home,{recursive:true,force:true});}
},20_000);
