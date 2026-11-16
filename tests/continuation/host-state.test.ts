import {expect,test} from "bun:test";
import {mkdtemp,rm,copyFile,mkdir} from "node:fs/promises";
import {join,resolve} from "node:path";
import {tmpdir} from "node:os";
import {nativeFixture} from "../catalog/fixture.ts";
import {CatalogTransport} from "../../packages/compatibility/catalog-transport.ts";
import {StrictTransport} from "../../packages/compatibility/strict-transport.ts";
import {ContinuationFixture} from "../../packages/continuation/fixture.ts";
import {isolatedRuntimeArgs} from "./worker.ts";

test("the actual Host adapter preserves terminal knowledge, marks lost workers unknown and restores registration without replay",async()=>{
 const home=await mkdtemp(join(tmpdir(),"strict-host-state-"));
 try{await nativeFixture(home);const cwd=join(home,"project"),env={HOME:home,TMPDIR:home,PATH:"/usr/bin:/bin",BUN_RUNTIME_TRANSPILER_CACHE_PATH:"0",PI_NOTIFICATIONS:"off",OPENAI_API_KEY:"synthetic-unused-no-provider-calls"};
  const argv=[process.execPath,"--no-env-file","--preload",resolve("compatibility/omp/fixtures/no-provider.ts"),resolve("vendor/omp-candidate/cli.js")];
  const catalog=await CatalogTransport.open({argv:[...argv,"--rpc-catalog"],env,cwd});let owned:StrictTransport|undefined,starts=0;
  const options={catalog:catalog.catalog,cwd,indexFile:join(home,"index/registrations.json"),launch:async()=>{starts++;owned=await StrictTransport.open({argv:[...argv,"--mode","rpc-ui","--strict-start",...isolatedRuntimeArgs],env,cwd,timeoutMs:10000,readyTimeoutMs:3000});return owned;}};
  const fixture=new ContinuationFixture(options);
  try{const discovered=await fixture.act({type:"discover"}),choice=discovered.choices[0];if(!choice)throw new Error("NO_FIXTURE_SELECTION");
   const opened=await fixture.act({type:"continue",selectionId:choice.selectionId});expect(opened.state).toMatchObject({phase:"open",nativeSessionId:"native-0000"});
   expect((await fixture.act({type:"cancel"})).state?.phase).toBe("open");
   const indexCopy=join(home,"restart-index/registrations.json");await mkdir(join(home,"restart-index"));await copyFile(options.indexFile,indexCopy);
   const restored=new ContinuationFixture({...options,indexFile:indexCopy});await restored.restore();
   expect(restored.snapshot()).toMatchObject({worker:{status:"none",starts:0},registrations:[{attempt:"outcome_unknown",code:"STRICT_HOST_RESTARTED"}]});
   await restored.act({type:"discover"});expect(starts).toBe(1);
   if(!owned)throw new Error("NO_OWNED_WORKER");process.kill(owned.processId,"SIGKILL");await owned.exited;await new Promise(resolve=>setTimeout(resolve,20));
   expect(fixture.snapshot()).toMatchObject({state:{phase:"outcome_unknown",code:"STRICT_WORKER_EXITED"},registrations:[{attempt:"outcome_unknown"}],worker:{status:"outcome_unknown",starts:1}});
   expect((await fixture.act({type:"recheck"})).state?.phase).toBe("outcome_unknown");expect(starts).toBe(1);
  }finally{await fixture.close();await catalog.close();}
 }finally{await rm(home,{recursive:true,force:true});}
},20_000);
