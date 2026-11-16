import { expect } from "bun:test";
import { z } from "zod";
import { startRawNativeInteractionProcess } from "./raw-client-process.ts";
// Both this native client process and its ordinary worker are guarded before imports.
const { RpcClient }=await import(`${process.env.OMP_NATIVE_ROOT!}/modes/rpc/rpc-client.ts`);
const fixture=await startRawNativeInteractionProcess({root:process.env.OMP_WEB_ROOT!,scripted:true});
const client=new RpcClient({spawn:()=>({stdin:fixture.child.stdin,stdout:fixture.child.stdout,exited:fixture.child.exited,
  peekStderr:fixture.peekStderr,kill:(signal?:Parameters<typeof fixture.child.kill>[0])=>fixture.child.kill(signal ?? "SIGTERM")})});
const sourceEvents:{method:string;id:string;timeout?:number;reason?:string;targetId?:string}[]=[];
let uiError:unknown;
const rootAnswer=Promise.withResolvers<void>();
client.onExtensionUIRequest((request:{method:string;id:string;title?:string;timeout?:number;reason?:string;targetId?:string})=>{
  sourceEvents.push(request);
  void(async()=>{
    if(request.method === "input" && request.title === "S0 isolated startup interaction") {
      expect(await client.getInteractionPolicy()).toMatchObject({explicitAnswersOnly:true});
      await client.respondUI(request.id,{type:"value",value:"start actual core"});rootAnswer.resolve();
    }else if(request.method === "select") {
      expect(request.timeout).toBeGreaterThan(0);expect(request.timeout).toBeLessThanOrEqual(1000);
      await Bun.sleep(200);
      expect(await client.respondUI(request.id,{type:"value",value:"chosen"})).toEqual({status:"answered"});
    }else if(request.method === "editor") {
      expect(request.timeout).toBeGreaterThan(0);expect(request.timeout).toBeLessThan(900);
      // Deliberate silence: the actual SDK's builtin AskTool must cancel, not submit the prefill.
    }
  })().catch(error=>{uiError=error;rootAnswer.reject(error);});
});
try {
  await client.start();await rootAnswer.promise;
  await client.setModel("s0-scripted","ask");
  expect(await client.getState()).toMatchObject({model:{provider:"s0-scripted",id:"ask"}});
  const events:unknown[]=await client.promptAndWait("S0_SCRIPTED_ASK",undefined,15000);
  if(uiError)throw uiError;
  const event=z.object({type:z.string()}).catchall(z.unknown());
  const ends=events.map(value=>event.parse(value)).filter(value=>value.type === "tool_execution_end" && value.toolName === "ask");
  expect(ends).toHaveLength(1);expect(ends[0]!.isError).toBe(true);
  expect(JSON.stringify(ends)).not.toContain('"answer":"default"');
  expect(JSON.stringify(ends)).not.toContain('"answer":"default reason"');
  const editor=sourceEvents.find(value=>value.method === "editor");expect(editor).toBeDefined();
  expect(sourceEvents.some(value=>value.method === "cancel" && value.targetId === editor!.id && value.reason === "expired")).toBe(true);
  expect(await fixture.close()).toMatchObject({code:0,forced:false,networkDenials:3});
}finally{await client.stop();}
console.log("native-core-loop: PASS");
