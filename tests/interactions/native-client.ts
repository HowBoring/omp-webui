import { expect } from "bun:test";
import { startNativeInteractionFixture } from "./worker.ts";
// This process already has a synthetic HOME/cwd/profile before importing the public native client.
const { RpcClient }=await import(`${process.env.OMP_NATIVE_ROOT!}/modes/rpc/rpc-client.ts`);
const fixture=await startNativeInteractionFixture({root:process.env.OMP_WEB_ROOT!,readProtocol:false});
const client=new RpcClient({spawn:()=>({stdin:fixture.child.stdin,stdout:fixture.child.stdout,exited:fixture.child.exited,
  peekStderr:()=>"",kill:(signal?:Parameters<typeof fixture.child.kill>[0])=>fixture.child.kill(signal ?? "SIGTERM")})});
const startup=Promise.withResolvers<void>();
let readyVerified=false;
const detach=client.onExtensionUIRequest((request:{method:string;id:string})=>{
  if(request.method !== "input")return;
  void(async()=>{
    expect(client.interactionPolicy).toMatchObject({explicitAnswersOnly:true,version:"1"});
    expect(Object.isFrozen(client.interactionPolicy)).toBe(true);readyVerified=true;
    const policy=await client.getInteractionPolicy();expect(policy).toEqual(client.interactionPolicy);
    expect(await client.respondUI(request.id,{type:"confirm",confirmed:true})).toEqual({status:"invalid"});
    expect(await client.respondUI(request.id,{type:"value",value:"public client"})).toEqual({status:"answered"});
    expect(await client.respondUI(request.id,{type:"cancel"})).toEqual({status:"stale"});
    startup.resolve();
  })().catch(startup.reject);
});
try {
  await client.start();await startup.promise;
  expect(readyVerified).toBe(true);
  expect(await client.getState()).toMatchObject({model:{provider:"openai",id:"gpt-4o"}});
  const outcome=await fixture.close();expect(outcome.code).toBe(0);
}finally{detach();await client.stop();}
console.log("native-client: PASS");
