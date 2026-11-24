import { expect, test } from "bun:test";
import { Context } from "@deepseek-ai/cordis";
import { installConnection } from "@deepseek-ai/dsh-client-connection/client";
import { apply as registry } from "@deepseek-ai/dsh-typert-registry/client";
import { apply as gateway } from "@deepseek-ai/dsh-api-gateway/client";
import { interactionsContribution } from "../../packages/contracts/interactions.ts";
import { type InteractionPort } from "../../packages/interactions/bridge.ts";
import { startInteractionsFixtureCarrier } from "../../apps/host/src/interactions-fixture-server.ts";

/** Public native boundary with a held acknowledgement, independent of HTTP callers. */
function heldCancellationPort() {
  const cancellation=Promise.withResolvers<unknown>();
  const abort=Promise.withResolvers<unknown>();
  const commands:object[]=[];
  const listeners=new Set<(frame:{type:string;[key:string]:unknown})=>void>();
  const port:InteractionPort={frames:[{type:"ready",interactionPolicy:{version:"1",explicitAnswersOnly:true,
    nativeExpiry:"cancel",toolExpiry:"cancel",invalidAnswer:"pending"}}],
    subscribe(listener){listeners.add(listener);return ()=>{listeners.delete(listener);};},
    command(command){
      commands.push(command);
      if("type" in command && command.type === "abort")return abort.promise;
      return cancellation.promise;
    }};
  return {port,commands,cancellation,abort,ask(){
    for(const listener of listeners)listener({type:"extension_ui_request",id:"held",method:"input",title:"Synthetic"});
  }};
}

test.each(["explicit","deadline"] as const)("HTTP DSH Remote bounds cancel/late-answer waiters behind held %s cancellation",async(initial)=>{
  const worker=heldCancellationPort();
  const carrier=await startInteractionsFixtureCarrier(worker.port,{port:0,waitMs:100});
  const ctx=new Context();
  let dispatched=0;
  installConnection(ctx,{interactions:"none",transport:{fetch:async(url,init)=>{
    dispatched++;
    return fetch(new URL(url,carrier.server.url),{...init,headers:{...init.headers,origin:carrier.server.url.origin}});
  },openStream:async function*(){}}});
  registry(ctx);gateway(ctx);await ctx.remote.$mount(interactionsContribution);
  // This is the public identity binding that a real native get_state supplies.
  carrier.bridge.bindSession("synthetic-session");worker.ask();
  const snapshot=await ctx.remote.ompInteractions.snapshot();
  if(!snapshot.ok)throw new Error("snapshot rejected");
  const generation=snapshot.value.generation;
  const answer=(cancel:boolean)=>ctx.remote.ompInteractions.answer(generation,"held",
    cancel ? {type:"cancel"} : {type:"value",value:"too late"});
  if(initial === "deadline")await Bun.sleep(120);
  let headSettled=false;
  const head=answer(initial === "explicit").then(result=>{headSettled=true;return result;});
  try {
    for(let n=0;n<100 && worker.commands.length===0;n++)await Bun.sleep(1);
    const nativeAnswer=initial === "explicit" ? {type:"cancel"} : {type:"cancel",timedOut:true};
    expect(worker.commands).toEqual([
      {type:"respond_ui",targetId:"held",answer:nativeAnswer},...(initial === "deadline" ? [{type:"abort"}] : []),
    ]);
    for(const cancel of [true,false]) {
      if(!cancel)await Bun.sleep(120); // Real Host deadline, while acknowledgement is still held.
      // Bun 1.4.4 native fetch drops larger loopback bursts before dispatch; retain all 512
      // Host calls in eight-request windows. The bridge suite covers 512 concurrent callers.
      const flood=(async()=>{
        const results=[];
        for(let offset=0;offset<512;offset+=8) {
          results.push(...await Promise.all(Array.from({length:8},()=>answer(cancel))));
        }
        return results;
      })();
      const result=await Promise.race([flood,Bun.sleep(2000).then(()=>"pending" as const)]);
      expect(result).toEqual(Array.from({length:512},()=>({ok:true,
        value:{status:"overloaded",code:"INTERACTION_ANSWER_LIMIT"}})));
    }
    expect(dispatched).toBe(1026);
    expect(worker.commands).toEqual([
      {type:"respond_ui",targetId:"held",answer:nativeAnswer},{type:"abort"},
    ]);
    expect(headSettled).toBe(false);
    worker.cancellation.resolve({status:"cancelled"});
    expect(await head).toEqual({ok:true,value:{status:"cancelled"}});
    const settled=await ctx.remote.ompInteractions.snapshot();
    expect(settled.ok && settled.value.pending).toEqual([]);
    expect(await answer(false)).toEqual({ok:true,value:{status:"stale"}});
  }finally {
    worker.cancellation.resolve({status:"cancelled"});worker.abort.resolve({});
    await head;await ctx.fiber.dispose();await carrier.stop();
    worker.ask();expect(carrier.bridge.snapshot().pending).toEqual([]);
  }
},10000);
