/** The bounded receipt/append cache must preserve the current logical-header cwd guard. */
import { expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { nativeFixture } from "../catalog/fixture.ts";
import { controlledRuntime, decodeSubmission } from "./fixture.ts";
import { negotiateStrict, selectedDescriptor, strictWorker } from "../continuation/worker.ts";
test("cached submission lookup/admission rejects a relative current header cwd before it can adopt changed source",async()=>{
 const home=await fs.mkdtemp(path.join(os.tmpdir(),"submission-cwd-"));
 try{
  const root=await nativeFixture(home),file=path.join(root,"bucket/native-0000.jsonl"),cwd=path.join(home,"project"),selected=await selectedDescriptor(home),worker=strictWorker(home,cwd,controlledRuntime);
  try{
   await negotiateStrict(worker);expect(await worker.request({type:"strict_start",intent:"continue",reference:selected.reference,expectedCwd:cwd})).toMatchObject({success:true});
   expect(decodeSubmission(await worker.request({type:"submission_query",clientSubmissionId:"not-yet-admitted"})).found).toBe(false);
   const before=await fs.readFile(file,"utf8"),needle=JSON.stringify(cwd);
   if(!before.includes(needle))throw Error("SYNTHETIC_HEADER_CWD_MISSING");
   await fs.writeFile(file,before.replace(needle,JSON.stringify(".")));
   expect(await worker.request({type:"submission_submit",inputType:"prompt",message:"must not run",preparationId:"literal",clientSubmissionId:"must-not-admit",
    sourceId:selected.sourceId,instanceId:selected.instanceId,nativeSessionId:selected.nativeSessionId})).toMatchObject({success:false,code:"STRICT_CWD_CHANGED"});
   expect(decodeSubmission(await worker.request({type:"submission_query",clientSubmissionId:"not-yet-admitted"}))).toMatchObject({reservation:"unknown",persistence:"unknown",terminal:false});
   expect(await Bun.file(path.join(home,"submission-provider-effects.json")).exists()).toBe(false);
  }finally{await worker.close().catch(()=>{});worker.child.kill();await worker.child.exited;}
 }finally{await fs.rm(home,{recursive:true,force:true});}
},30000);
