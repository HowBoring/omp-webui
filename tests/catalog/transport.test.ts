/** Public stdio fault evidence, distinct from actual native catalog tests. */
import{test,expect}from"bun:test";
import{CatalogTransport}from"../../packages/compatibility/catalog-transport.ts";

const fixture=(mode:string,timeoutMs=50,readyDelayMs=0,negotiateDelayMs=0)=>CatalogTransport.open({
  argv:[process.execPath,"tests/fixtures/catalog-peer.ts",mode,String(readyDelayMs),String(negotiateDelayMs)],
  env:{},timeoutMs,readyTimeoutMs:3000,
});

test("catalog startup can be slower than its unchanged short request budget",async()=>{
  const client=await fixture("late",50,150,150);
  try{await expect(client.catalog.describe("fixture-reference")).rejects.toThrow("RPC_REQUEST_TIMEOUT");}
  finally{await client.close();}
});

test("catalog ready and negotiation share the independently selected startup deadline",async()=>{
  const started=performance.now();
  await expect(CatalogTransport.open({argv:[process.execPath,"tests/fixtures/catalog-peer.ts","late","150","150"],
    env:{},timeoutMs:1000,readyTimeoutMs:200}).then(async client=>{await client.close();})).rejects.toThrow("RPC_READY_TIMEOUT");
  expect(performance.now()-started).toBeLessThan(1200);
});

test("catalog startup without an override retains the selected default deadline",async()=>{
  await expect(CatalogTransport.open({argv:[process.execPath,"tests/fixtures/catalog-peer.ts","late","150"],
    env:{},timeoutMs:50})).rejects.toThrow("RPC_READY_TIMEOUT");
});

test("catalog blocked stdin bounds queued and inflight writes independently of expired pending requests",async()=>{
  const client=await fixture("never-read",50);
  try{
    // Eight waves offer over 1 MiB of schema-valid readonly commands (4096-byte references).
    // The non-reader consumes none; only a real blocked flush may keep queue capacity exhausted.
    for(let wave=0;wave<8;wave++)await Promise.allSettled(Array.from({length:32},()=>client.catalog.describe("r".repeat(4096))));
    await expect(client.catalog.describe("fixture-reference")).rejects.toThrow("RPC_PENDING_LIMIT");
  }finally{
    const started=performance.now();const result=await client.close();
    expect(result.forced).toBe(true);expect(result.code).not.toBe(0);
    expect(result.protocolFailure).toBe("RPC_STDIN");
    expect(performance.now()-started).toBeLessThan(1200);
  }
},10000);


test("catalog requests that expire while queued are not published when a real blocked reader resumes",async()=>{
  const client=await fixture("resume-read",50);
  try{
    let knownQueued:string[]=[];
    for(let wave=0;wave<8;wave++){
      const references=Array.from({length:32},(_,index)=>`wave-${wave}-${index}-`.padEnd(4090,"r"));
      const outcomes=await Promise.all(references.map(reference=>client.catalog.describe(reference).then(
        ()=>"RESPONSE",error=>error instanceof Error?error.message:"UNKNOWN")));
      // A mixed wave proves a prior write is still blocked: independent queue capacity refuses some calls,
      // while the newly admitted calls time out behind that same blocked predecessor.
      if(outcomes.includes("RPC_PENDING_LIMIT")&&outcomes.includes("RPC_REQUEST_TIMEOUT"))
        knownQueued=references.filter((_,index)=>outcomes[index]==="RPC_REQUEST_TIMEOUT");
    }
    expect(knownQueued.length).toBeGreaterThan(0);
    await Bun.sleep(1200);
    for(const reference of knownQueued){
      // The fixture's public description probes its received-reference set after it resumes reading.
      expect((await client.catalog.describe(`probe:${reference}`)).status).toBe("missing");
    }
    expect(await client.close()).toEqual({code:0,forced:false,stderrBytes:0});
  }finally{await client.close();}
},10000);
