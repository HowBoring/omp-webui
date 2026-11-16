import { expect } from "bun:test";
import { startRawNativeInteractionProcess } from "./worker.ts";
// This process already has a synthetic HOME/cwd/profile before importing the public native client.
const { RpcClient }=await import(`${process.env.OMP_NATIVE_ROOT!}/modes/rpc/rpc-client.ts`);
const fixture=await startRawNativeInteractionProcess({root:process.env.OMP_WEB_ROOT!});
const client=new RpcClient({spawn:()=>({stdin:fixture.child.stdin,stdout:fixture.child.stdout,exited:fixture.child.exited,
  peekStderr:()=>"",kill:(signal?:Parameters<typeof fixture.child.kill>[0])=>fixture.child.kill(signal ?? "SIGTERM")})});
const startup=Promise.withResolvers<void>();
const selection=Promise.withResolvers<void>();
let readyVerified=false;
const mayAnswer=Promise.withResolvers<void>();
let answered=false;
const detach=client.onExtensionUIRequest((request:{method:string;id:string})=>{
  if(request.method === "select") {
    void(async()=>{
      // Deliberate public wire faults only in this isolated native test: the two
      // other response families must not consume an extension UI ID.
      fixture.child.stdin.write(JSON.stringify({type:"host_tool_result",id:request.id,result:{content:[]}})+"\n");
      fixture.child.stdin.write(JSON.stringify({type:"host_uri_result",id:request.id,content:"Allow"})+"\n");
      await fixture.child.stdin.flush();
      expect(await client.respondUI(request.id,{type:"value",value:"unknown"})).toEqual({status:"invalid"});
      expect(await Promise.all(["Allow","Deny"].map(value=>client.respondUI(request.id,{type:"value",value}))))
        .toEqual([{status:"answered"},{status:"stale"}]);
      selection.resolve();
    })().catch(selection.reject);
    return;
  }
  if(request.method !== "input")return;
  void(async()=>{
    expect(client.interactionPolicy).toMatchObject({explicitAnswersOnly:true,version:"1"});
    expect(Object.isFrozen(client.interactionPolicy)).toBe(true);readyVerified=true;
    const policy=await client.getInteractionPolicy();expect(policy).toEqual(client.interactionPolicy);
    await mayAnswer.promise;
    expect(await client.respondUI(request.id,{type:"confirm",confirmed:true})).toEqual({status:"invalid"});
    expect(await client.respondUI(request.id,{type:"value",value:"public client"})).toEqual({status:"answered"});
    expect(await client.respondUI(request.id,{type:"cancel"})).toEqual({status:"stale"});
    answered=true;startup.resolve();
  })().catch(startup.reject);
});
try {
  await client.start();expect(answered).toBe(false);mayAnswer.resolve();await startup.promise;
  expect(readyVerified).toBe(true);
  expect(await client.getState()).toMatchObject({model:{provider:"openai",id:"gpt-4o"}});
  await client.prompt("/s0-select");await selection.promise;
  const outcome=await fixture.close();expect(outcome).toMatchObject({code:0,forced:false});
}finally{detach();await client.stop();}
console.log("native-client: PASS");
