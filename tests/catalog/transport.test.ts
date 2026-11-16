/** Public stdio fault evidence, distinct from actual native catalog tests. */
import{test,expect,spyOn}from"bun:test";
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
  const client=await fixture("resume-read",200);
  try{
    const timedOut:string[]=[];
    let blocked=false;
    for(let wave=0;wave<8&&!blocked;wave++){
      const references=Array.from({length:32},(_,index)=>`wave-${wave}-${index}-`.padEnd(4090,"r"));
      const outcomes=await Promise.all(references.map(reference=>client.catalog.describe(reference).then(
        ()=>"RESPONSE",error=>error instanceof Error?error.message:"UNKNOWN")));
      timedOut.push(...references.filter((_,index)=>outcomes[index]==="RPC_REQUEST_TIMEOUT"));
      // Previous waves have settled. A refusal now proves write capacity remains occupied under backpressure.
      // A whole wave may be refused, so a mixed timeout/refusal wave is not required.
      blocked=outcomes.includes("RPC_PENDING_LIMIT");
    }
    expect(blocked).toBe(true);
    expect(timedOut.length).toBeGreaterThan(0);
    // Only our public fault peer is signalled; its pre-ready latch makes release explicit.
    process.kill(client.processId,"SIGUSR1");
    const releasedDeadline=performance.now()+2000;
    for(;;){
      try{expect((await client.catalog.describe("probe:released")).status).toBe("missing");break;}
      catch(error){
        if(!(error instanceof Error)||error.message!=="RPC_PENDING_LIMIT"||performance.now()>=releasedDeadline)throw error;
        await Bun.sleep(10);
      }
    }
    let suppressed=0;
    for(const reference of timedOut){
      // Some writes reached the sink before expiry. At least one expired queued write must be suppressed.
      const status=(await client.catalog.describe(`probe:${reference}`)).status;
      expect(["missing","replaced"]).toContain(status);
      if(status==="missing")suppressed++;
    }
    expect(suppressed).toBeGreaterThan(0);
    expect(await client.close()).toEqual({code:0,forced:false,stderrBytes:0});
  }finally{await client.close();}
},10000);


test("catalog correlates concurrent readonly responses completed in reverse order", async () => {
  const client = await fixture("out-of-order", 500);
  try {
    const order: string[] = [];
    const first = client.catalog.describe("first").then(result => { order.push("first"); return result; });
    const second = client.catalog.describe("second").then(result => { order.push("second"); return result; });
    expect((await first).status).toBe("missing");
    expect((await second).status).toBe("missing");
    expect(order).toEqual(["second", "first"]);
  } finally { await client.close(); }
});

for (const mode of ["wrong-id", "wrong-command", "unknown-notification"]) {
  test(`catalog rejects ${mode} through its readonly policy`, async () => {
    const client = await fixture(mode, 500);
    try { await expect(client.catalog.describe("fixture-reference")).rejects.toThrow("RPC_PROTOCOL"); }
    finally { await client.close(); }
  });
}

test("catalog partial EOF fails terminal drain after a valid description", async () => {
  const client = await fixture("tail", 500);
  await client.catalog.describe("fixture-reference");
  expect((await client.close()).protocolFailure).toBe("RPC_PROTOCOL");
});

test("catalog cancellation rejects pending readonly work and reaps the child", async () => {
  const abort = new AbortController();
  const client = await CatalogTransport.open({ argv: [process.execPath, "tests/fixtures/catalog-peer.ts", "no-response"],
    env: {}, signal: abort.signal });
  const request = client.catalog.describe("fixture-reference");
  const outcome = request.catch(error => error instanceof Error ? error.message : "UNKNOWN");
  abort.abort(); expect(await outcome).toBe("RPC_CANCELLED");
  expect((await client.close()).protocolFailure).toBe("RPC_CANCELLED");
  expect(() => process.kill(client.processId, 0)).toThrow();
});

test("catalog rejects a duplicate generated ID without replacing its pending waiter", async () => {
  const client = await fixture("late", 500);
  const uuid = spyOn(crypto, "randomUUID").mockReturnValue("00000000-0000-4000-8000-000000000031");
  try {
    const first = client.catalog.describe("first");
    await expect(client.catalog.describe("second")).rejects.toThrow("RPC_DUPLICATE_ID");
    expect((await first).status).toBe("missing");
    expect(await client.close()).toEqual({ code: 0, forced: false, stderrBytes: 0 });
  } finally { uuid.mockRestore(); await client.close(); }
});


test("catalog still rejects chunks adjacent to a valid negotiation ack", async () => {
  const client = await fixture("chunk-after-ack", 500);
  try { await expect(client.catalog.describe("fixture-reference")).rejects.toThrow("RPC_PROTOCOL"); }
  finally { expect((await client.close()).protocolFailure).toBe("RPC_PROTOCOL"); }
});
