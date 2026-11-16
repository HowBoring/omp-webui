/** Real filesystem changes challenge the owned append/source proof; no process attachment or internal mock. */
import { expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { nativeFixture, filesystemManifest } from "../catalog/fixture.ts";
import { controlledRuntime, decodeSubmission } from "./fixture.ts";
import { negotiateStrict, selectedDescriptor, strictWorker } from "../continuation/worker.ts";
for (const damage of ["same-size-carrier", "external-append", "same-size-generation"] as const)
 test(`cached native proof refuses ${damage} instead of adopting drift or executing another input`, async () => {
  const home=await fs.mkdtemp(path.join(os.tmpdir(),"submission-drift-"));
  try {
   const root=await nativeFixture(home),file=path.join(root,"bucket/native-0000.jsonl"),cwd=path.join(home,"project");
   await fs.appendFile(file,JSON.stringify({type:"custom",id:"padding",parentId:"entry-0",timestamp:"2026-01-01T00:00:00Z",customType:"fixture-padding",data:"x".repeat(32768)})+"\n");
   const selected=await selectedDescriptor(home),worker=strictWorker(home,cwd,controlledRuntime);
   try {
    await negotiateStrict(worker);await worker.request({type:"strict_start",intent:"continue",reference:selected.reference,expectedCwd:cwd});
    const command={type:"submission_submit",inputType:"prompt",message:"",preparationId:"literal",clientSubmissionId:"old-id",
      sourceId:selected.sourceId,instanceId:selected.instanceId,nativeSessionId:selected.nativeSessionId};
    expect(await worker.request(command)).toMatchObject({success:true,data:{terminal:true}});
    if(damage==="external-append") await fs.appendFile(file,JSON.stringify({type:"custom",id:"external",parentId:"entry-0",timestamp:"2026-01-01T00:00:00Z",customType:"external-change",data:{changed:true}})+"\n");
    else {
      let target=file;
      if(damage==="same-size-generation") {const directory=path.join(path.dirname(file),".native-0000.jsonl.omp-generations");const name=(await fs.readdir(directory)).find(name=>name.endsWith(".gen"));if(!name)throw Error("GENERATION_MISSING");target=path.join(directory,name);await fs.chmod(target,0o600);}
      const before=await fs.readFile(target),offset=damage==="same-size-generation"?before.length-8:before.indexOf(Buffer.from("Synthetic fixture input"));
      if(offset<0)throw Error("DRIFT_FIXTURE_OFFSET");
      const handle=await fs.open(target,"r+");try{await handle.write(Buffer.from([90]),0,1,offset);}finally{await handle.close();}
      expect((await fs.stat(target)).size).toBe(before.length);
    }
    const before=await filesystemManifest(root);
    expect(decodeSubmission(await worker.request({type:"submission_query",clientSubmissionId:"old-id"})))
      .toMatchObject({persistence:"unknown",reservation:"unknown",terminal:false});
    expect(await worker.request({...command,clientSubmissionId:"must-not-run",message:"literal"})).toMatchObject({success:false});
    expect(await filesystemManifest(root)).toEqual(before);
    expect(await Bun.file(path.join(home,"submission-provider-effects.json")).exists()).toBe(false);
   }finally{await worker.close().catch(()=>{});worker.child.kill();await worker.child.exited;}
  }finally{await fs.rm(home,{recursive:true,force:true});}
 },30000);
