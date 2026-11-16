import { expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { nativeFixture } from "../catalog/fixture.ts";
import { controlledRuntime, decodeSubmission, terminalSubmission } from "./fixture.ts";
import { negotiateStrict, selectedDescriptor, strictWorker } from "../continuation/worker.ts";
test("committed input generation remains knowable while execution and terminal receipt are still unresolved",async()=>{
 const home=await fs.mkdtemp(path.join(os.tmpdir(),"submission-generated-"));
 try{
  await nativeFixture(home);const target=await selectedDescriptor(home),cwd=path.join(home,"project"),worker=strictWorker(home,cwd,controlledRuntime);
  try{
   await negotiateStrict(worker);await worker.request({type:"strict_start",intent:"continue",reference:target.reference,expectedCwd:cwd});
   expect(await worker.request({type:"submission_submit",clientSubmissionId:"generated-before-terminal",preparationId:"literal",inputType:"prompt",message:"slow-input",
    sourceId:target.sourceId,instanceId:target.instanceId,nativeSessionId:target.nativeSessionId})).toMatchObject({success:true});
   let observed;
   for(let attempt=0;attempt<80;attempt++){
    observed=decodeSubmission(await worker.request({type:"submission_query",clientSubmissionId:"generated-before-terminal"}));
    if(observed.relations.some(relation=>relation.role==="input"&&relation.persistence==="committed"))break;
    await Bun.sleep(5);
   }
   expect(observed?.terminal).toBe(false);
   expect(observed?.inputOutcome).toBe("generated");
   expect(observed?.persistence).toBe("unresolved");
   expect(await terminalSubmission(worker,"generated-before-terminal")).toMatchObject({inputOutcome:"generated",persistence:"committed",terminal:true});
   expect((await worker.close()).code).toBe(0);
  }finally{worker.child.kill();await worker.child.exited;}
 }finally{await fs.rm(home,{recursive:true,force:true});}
},30000);
