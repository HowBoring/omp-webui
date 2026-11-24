import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { nativeFixture } from "../catalog/fixture.ts";
import { selectedDescriptor, isolatedRuntimeArgs } from "./worker.ts";
import { StrictTransport } from "../../packages/compatibility/strict-transport.ts";

test("the same-source strict client uses bounded shared transport against the actual deferred worker", async () => {
  const home = await mkdtemp(join(tmpdir(), "strict-client-"));
  try {
    await nativeFixture(home);
    const selected = await selectedDescriptor(home), cwd = join(home, "project");
    const client = await StrictTransport.open({ argv: [process.execPath, "--no-env-file", "--preload",
      resolve("compatibility/omp/fixtures/no-provider.ts"), resolve("vendor/omp-candidate/cli.js"),
      "--mode", "rpc-ui", "--strict-start", ...isolatedRuntimeArgs], cwd,
      env: { HOME: home, PATH: "/usr/bin:/bin", TMPDIR: home, BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0",
        OPENAI_API_KEY: "synthetic-unused-no-provider-calls", PI_NOTIFICATIONS: "off" }, timeoutMs: 10_000, readyTimeoutMs: 3000 });
    try {
      expect(await client.startup.state()).toMatchObject({ phase: "waiting" });
      expect(await client.startup.start({ intent: "continue", reference: selected.reference, expectedCwd: cwd }))
        .toMatchObject({ phase: "open", intent: "continue", nativeSessionId: "native-0000", binding: { instanceId: selected.instanceId } });
      expect(await client.startup.state()).toMatchObject({ phase: "open", nativeSessionId: "native-0000" });
      expect((await client.close()).forced).toBe(false);
    } finally { await client.close(); }
  } finally { await rm(home, { recursive: true, force: true }); }
}, 20000);

test("a dropped successful native start result is unknown until a readonly query verifies the same live worker",async()=>{
 const home=await mkdtemp(join(tmpdir(),"strict-lost-"));
 try{await nativeFixture(home);const selected=await selectedDescriptor(home),cwd=join(home,"project");
  const client=await StrictTransport.open({argv:[process.execPath,"--no-env-file","--preload",resolve("compatibility/omp/fixtures/no-provider.ts"),"--preload",resolve("tests/continuation/native-faults.ts"),resolve("vendor/omp-candidate/cli.js"),"--mode","rpc-ui","--strict-start",...isolatedRuntimeArgs],cwd,
   env:{HOME:home,TMPDIR:home,PATH:"/usr/bin:/bin",BUN_RUNTIME_TRANSPILER_CACHE_PATH:"0",PI_NOTIFICATIONS:"off",OPENAI_API_KEY:"synthetic-unused-no-provider-calls",OMP_STRICT_FIXTURE_HOME:home,OMP_STRICT_FAULT:"drop-start-result",OMP_STRICT_FAULT_TARGET:join(home,"wire-fault")},timeoutMs:10000,readyTimeoutMs:3000},{startTimeoutMs:150});
  try{const pid=client.processId;await expect(client.startup.start({intent:"continue",reference:selected.reference,expectedCwd:cwd})).rejects.toThrow("RPC_REQUEST_TIMEOUT");
   let state=await client.startup.state();for(let n=0;n<30&&state.phase!=="open";n++){await new Promise(resolve=>setTimeout(resolve,100));state=await client.startup.state();}
   expect(state).toMatchObject({phase:"open",nativeSessionId:"native-0000",binding:{instanceId:selected.instanceId}});expect(client.processId).toBe(pid);
   expect(await Bun.file(join(home,"strict-wire-fault.json")).json()).toMatchObject({nativeResult:"strict_start_success_dropped"});expect((await client.close()).forced).toBe(false);
  }finally{await client.close();}
 }finally{await rm(home,{recursive:true,force:true});}
},20000);
