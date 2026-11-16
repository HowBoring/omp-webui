import { expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { nativeFixture } from "../catalog/fixture.ts";
import { controlledRuntime, terminalSubmission } from "./fixture.ts";
import { negotiateStrict, selectedDescriptor, strictWorker } from "../continuation/worker.ts";
for (const fault of ["submission-drop-ack", "submission-receipt-crash"] as const) test(`literal native ${fault} recovers through query without replay`, async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "submission-wire-"));
  try {
    const root = await nativeFixture(home), target = path.join(root,"bucket/native-0000.jsonl"), cwd = path.join(home,"project"), selected = await selectedDescriptor(home);
    const command = {type:"submission_submit",inputType:"prompt",message:"literal",preparationId:"wire-preparation",clientSubmissionId:"wire-id",
      sourceId:selected.sourceId,instanceId:selected.instanceId,nativeSessionId:selected.nativeSessionId};
    let worker = strictWorker(home,cwd,controlledRuntime,undefined,{name:fault,target});
    try {
      await negotiateStrict(worker); await worker.request({type:"strict_start",intent:"continue",reference:selected.reference,expectedCwd:cwd});
      worker.send({...command,id:"lost-reply"});
      if(fault==="submission-drop-ack") {
        const result=await terminalSubmission(worker,command.clientSubmissionId);expect(result.persistence).toBe("committed");
        expect(worker.frames.some(frame=>frame.id==="lost-reply"&&frame.type==="response")).toBe(false);
        expect((await worker.close()).code).toBe(0);
      } else {
        await expect(terminalSubmission(worker,command.clientSubmissionId)).rejects.toThrow("STRICT_FIXTURE_EXIT_92");
        expect(await worker.child.exited).toBe(92);
      }
      expect(JSON.parse(await fs.readFile(path.join(home,"submission-wire-fault.json"),"utf8"))).toEqual({fault,fired:true});
    } finally {worker.child.kill();await worker.child.exited;}
    const before=await fs.readFile(path.join(home,"submission-provider-effects.json"),"utf8");
    worker=strictWorker(home,cwd,controlledRuntime);
    try {await negotiateStrict(worker);expect(await worker.request({type:"strict_start",intent:"continue",reference:selected.reference,expectedCwd:cwd})).toMatchObject({success:true});
      expect(await worker.request(command)).toMatchObject({success:true,data:{duplicate:true,terminal:true,persistence:"committed"}});
      expect((await worker.close()).code).toBe(0);
    }finally{worker.child.kill();await worker.child.exited;}
    expect(await fs.readFile(path.join(home,"submission-provider-effects.json"),"utf8")).toBe(before);
  }finally{await fs.rm(home,{recursive:true,force:true});}
},30000);
