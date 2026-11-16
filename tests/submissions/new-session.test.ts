/** First native publication does not wait for an assistant to make a lazy Session materialize. */
import { expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { z } from "zod";
import { nativeFixture } from "../catalog/fixture.ts";
import { isolatedRuntimeArgs, negotiateStrict, strictWorker } from "../continuation/worker.ts";
import { decodeSubmission } from "./fixture.ts";
test("a new native Session commits no-input metadata before any assistant and recovers after losing its first receipt",async()=>{
 const home=await fs.mkdtemp(path.join(os.tmpdir(),"submission-first-write-"));
 try{
  await nativeFixture(home);const cwd=path.join(home,"project"),target=path.join(home,"owned-wire-boundary"),worker=strictWorker(home,cwd,isolatedRuntimeArgs,undefined,{name:"submission-receipt-crash",target});
  let reference:string,command:object;
  try{
   await negotiateStrict(worker);const opened=await worker.request({type:"strict_start",intent:"new",expectedCwd:cwd});
   const selected=z.object({binding:z.object({reference:z.string(),sourceId:z.string(),instanceId:z.string(),nativeSessionId:z.string()})}).parse(opened.data).binding;reference=selected.reference;
   const before=await worker.request({type:"get_entries"});
   command={type:"submission_submit",inputType:"prompt",message:"",preparationId:"empty-prepared",clientSubmissionId:"first-write",
    sourceId:selected.sourceId,instanceId:selected.instanceId,nativeSessionId:selected.nativeSessionId};
   expect(await worker.request(command)).toMatchObject({success:true,data:{inputOutcome:"no_input",persistence:"committed"}});
   expect((await worker.request({type:"get_entries"})).data).toEqual(before.data);
   await expect(worker.request({type:"submission_query",clientSubmissionId:"first-write"})).rejects.toThrow("STRICT_FIXTURE_EXIT_92");
   expect(await worker.child.exited).toBe(92);
  }finally{worker.child.kill();await worker.child.exited;}
  const reopened=strictWorker(home,cwd,isolatedRuntimeArgs);
  try{
   await negotiateStrict(reopened);expect(await reopened.request({type:"strict_start",intent:"continue",reference:reference!,expectedCwd:cwd})).toMatchObject({success:true});
   expect(decodeSubmission(await reopened.request({type:"submission_query",clientSubmissionId:"first-write"}))).toMatchObject({inputOutcome:"no_input",terminal:true,persistence:"committed"});
   expect(decodeSubmission(await reopened.request(command!)).duplicate).toBe(true);
   expect((await reopened.close()).code).toBe(0);
  }finally{reopened.child.kill();await reopened.child.exited;}
 }finally{await fs.rm(home,{recursive:true,force:true});}
},30000);
