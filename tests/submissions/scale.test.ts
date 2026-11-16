/** Real 100 MiB native history and 1,024 permanent identities; no provider calls or synthetic protocol success. */
import { expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { nativeFixture } from "../catalog/fixture.ts";
import { isolatedRuntimeArgs, negotiateStrict, selectedDescriptor, strictWorker } from "../continuation/worker.ts";
import { decodeSubmission } from "./fixture.ts";
test("100 MiB / 10,000 native entries survive 1,024 append-only reservations without generation quota growth or tombstone loss", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "submission-scale-"));
  try {
    const root = await nativeFixture(home), file = path.join(root, "bucket/native-0000.jsonl"), cwd = path.join(home, "project");
    const handle = await fs.open(file, "a");
    try {
      for (let index = 1; index < 10000; index++) await handle.write(JSON.stringify({ type: "message", id: `scale-${index}`, parentId: index === 1 ? "entry-0" : `scale-${index-1}`,
        timestamp: "2026-01-01T00:00:00.000Z", message: {role:"user", content:`${index}:`+"x".repeat(10490), timestamp:index} })+"\n");
    } finally { await handle.close(); }
    const initialBytes = (await fs.stat(file)).size;
    expect(initialBytes).toBeGreaterThanOrEqual(100*1024*1024);
    const selected = await selectedDescriptor(home);
    let worker = strictWorker(home, cwd, isolatedRuntimeArgs);
    let generationCount = 0;
    const samples: number[] = [];
    const command = { type: "submission_submit", inputType: "prompt", message: "", preparationId: "literal-scale-preparation", clientSubmissionId: "scale-key-0",
      sourceId: selected.sourceId, instanceId: selected.instanceId, nativeSessionId: selected.nativeSessionId };
    try {
      await negotiateStrict(worker);
      expect(await worker.request({ type: "strict_start", intent: "continue", reference: selected.reference, expectedCwd: cwd })).toMatchObject({ success: true });
      for (let index = 0; index < 1024; index++) {
        const started = performance.now();
        const result = decodeSubmission(await worker.request({ ...command, clientSubmissionId: `scale-key-${index}` }));
        if (!result.terminal || result.persistence !== "committed" || result.inputOutcome !== "no_input") throw Error(`SCALE_NATIVE_RECEIPT_${index}`);
        samples.push(performance.now()-started);
        if (index === 0) generationCount = (await fs.readdir(path.join(path.dirname(file), ".native-0000.jsonl.omp-generations"))).filter(name=>name.endsWith(".gen")).length;
      }
      expect((await fs.readdir(path.join(path.dirname(file), ".native-0000.jsonl.omp-generations"))).filter(name=>name.endsWith(".gen")).length).toBe(generationCount);
      expect(decodeSubmission(await worker.request(command)).duplicate).toBe(true);
      expect((await worker.close()).code).toBe(0);
    } finally { worker.child.kill(); await worker.child.exited; }
    worker = strictWorker(home, cwd, isolatedRuntimeArgs);
    try {
      await negotiateStrict(worker);
      expect(await worker.request({ type: "strict_start", intent: "continue", reference: selected.reference, expectedCwd: cwd })).toMatchObject({ success: true });
      for (const index of [0, 511, 1023]) expect(decodeSubmission(await worker.request({ type: "submission_query", clientSubmissionId: `scale-key-${index}` })))
        .toMatchObject({ found: true, terminal: true, inputOutcome: "no_input", persistence: "committed" });
      expect(decodeSubmission(await worker.request(command)).duplicate).toBe(true);
      expect((await worker.close()).code).toBe(0);
    } finally { worker.child.kill(); await worker.child.exited; }
    await fs.mkdir("vendor/submission-evidence", {recursive:true});
    await Bun.write("vendor/submission-evidence/scale.json", JSON.stringify({kind:"actual-native-scale-component", nativeEntries:10000, initialBytes, permanentKeys:1024,
      generationCount, physicalBytes:(await fs.stat(file)).size, samplesMs:samples, maximumMs:Math.max(...samples),
      p95Ms:[...samples].sort((a,b)=>a-b)[Math.ceil(samples.length*0.95)-1], formalMvpPerformance:false},null,2));
  } finally { await fs.rm(home,{recursive:true,force:true}); }
}, 180000);

test("a retained 100 MiB history supports 1,000 actual text turns and recoverable permanent origins without generation exhaustion", async () => {
  const { controlledRuntime, terminalSubmission } = await import("./fixture.ts");
  const home=await fs.mkdtemp(path.join(os.tmpdir(),"submission-text-scale-"));
  try {
    const root=await nativeFixture(home),file=path.join(root,"bucket/native-0000.jsonl"),cwd=path.join(home,"project"),handle=await fs.open(file,"a");
    try {
      for(let index=1;index<10000;index++)await handle.write(JSON.stringify({type:"message",id:`scale-${index}`,parentId:index===1?"entry-0":`scale-${index-1}`,
        timestamp:"2026-01-01T00:00:00.000Z",message:{role:"user",content:`${index}:`+"x".repeat(10490),timestamp:index}})+"\n");
      // Native reset boundary retains the full tree while placing old history outside the model window.
      await handle.write(JSON.stringify({type:"reset_boundary",id:"scale-reset",parentId:"scale-9999",timestamp:"2026-01-01T00:00:01.000Z"})+"\n");
    }finally{await handle.close();}
    const initialBytes=(await fs.stat(file)).size,selected=await selectedDescriptor(home),samples:number[]=[];
    let worker=strictWorker(home,cwd,controlledRuntime,undefined,undefined,undefined,60_000),generations=0;
    const command={type:"submission_submit",inputType:"prompt",message:"literal",preparationId:"literal-text-scale",clientSubmissionId:"text-scale-0",
      sourceId:selected.sourceId,instanceId:selected.instanceId,nativeSessionId:selected.nativeSessionId};
    try{
      await negotiateStrict(worker);expect(await worker.request({type:"strict_start",intent:"continue",reference:selected.reference,expectedCwd:cwd})).toMatchObject({success:true});
      for(let index=0;index<1000;index++){
        const started=performance.now(),id=`text-scale-${index}`;
        const admitted=await worker.request({...command,clientSubmissionId:id}).catch(async failure=>{
          await fs.mkdir("vendor/submission-evidence",{recursive:true});
          await Bun.write("vendor/submission-evidence/text-scale-failure.json",JSON.stringify({index,frames:worker.frames.slice(-20).map(frame=>({type:frame.type,command:frame.command,id:frame.id,error:frame.error,code:frame.code})),error:String(failure)},null,2));
          throw failure;
        });
        if(admitted.success!==true)throw Error(`TEXT_SCALE_ADMISSION_${index}`);
        const result=await terminalSubmission(worker,id);
        if(result.inputOutcome!=="generated"||result.persistence!=="committed"||!result.relations.some(relation=>relation.role==="input"&&relation.persistence==="committed"))throw Error(`TEXT_SCALE_RECEIPT_${index}`);
        samples.push(performance.now()-started);
        if(index===0)generations=(await fs.readdir(path.join(path.dirname(file),".native-0000.jsonl.omp-generations"))).filter(name=>name.endsWith(".gen")).length;
      }
      expect((await fs.readdir(path.join(path.dirname(file),".native-0000.jsonl.omp-generations"))).filter(name=>name.endsWith(".gen")).length).toBe(generations);
      expect((await worker.close()).code).toBe(0);
    }finally{worker.child.kill();await worker.child.exited;}
    const effects=JSON.parse(await fs.readFile(path.join(home,"submission-provider-effects.json"),"utf8"));
    expect(effects).toEqual({calls:1000,realInference:false});
    worker=strictWorker(home,cwd,controlledRuntime,undefined,undefined,undefined,60_000);
    try{
      await negotiateStrict(worker);expect(await worker.request({type:"strict_start",intent:"continue",reference:selected.reference,expectedCwd:cwd})).toMatchObject({success:true});
      expect(decodeSubmission(await worker.request(command))).toMatchObject({duplicate:true,terminal:true,inputOutcome:"generated",persistence:"committed"});
      expect((await worker.close()).code).toBe(0);
    }finally{worker.child.kill();await worker.child.exited;}
    expect(JSON.parse(await fs.readFile(path.join(home,"submission-provider-effects.json"),"utf8"))).toEqual(effects);
    await fs.mkdir("vendor/submission-evidence",{recursive:true});
    await Bun.write("vendor/submission-evidence/text-scale.json",JSON.stringify({kind:"actual-controlled-native-text-scale",initialBytes,retainedEntries:10001,textSubmissions:1000,
      generationCount:generations,physicalBytes:(await fs.stat(file)).size,controlledProvider:effects,samplesMs:samples,
      maximumMs:Math.max(...samples),p95Ms:[...samples].sort((a,b)=>a-b)[Math.ceil(samples.length*0.95)-1],formalMvpPerformance:false},null,2));
  }finally{await fs.rm(home,{recursive:true,force:true});}
},480000);
