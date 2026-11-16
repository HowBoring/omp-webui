import { test, expect } from "bun:test";
import { startNativeInteractionFixture } from "./worker.ts";
import validPolicy from "../../packages/contracts/generated/interaction-policy.js";

test("actual rpc-ui verifies policy during root startup and atomically answers native Session UI",async()=>{
  const worker=await startNativeInteractionFixture();
  try {
    const ready=await worker.wait(f=>f.type === "ready");
    expect(validPolicy(ready.interactionPolicy)).toBe(true);
    const startup=await worker.wait(f=>f.type === "extension_ui_request" && f.method === "input");
    expect((await worker.command({type:"negotiate_protocol",protocolVersion:2})).data).toEqual({protocolVersion:2});
    expect(worker.frames.some(f=>f.type === "extension_ui_request" && f.method === "cancel" && f.targetId === startup.id)).toBe(false);
    expect(worker.frames.some(f=>f.type === "extension_ui_request" && f.method === "notify" && f.message === "startup:cancelled")).toBe(false);
    expect((await worker.command({type:"get_interaction_policy"})).data).toEqual(ready.interactionPolicy);
    expect((await worker.command({type:"respond_ui",targetId:startup.id,answer:{type:"confirm",confirmed:true}})).data)
      .toEqual({status:"invalid"});
    expect((await worker.command({type:"respond_ui",targetId:startup.id,answer:{type:"value",value:"explicit startup"}})).data)
      .toEqual({status:"answered"});
    expect((await worker.command({type:"respond_ui",targetId:startup.id,answer:{type:"value",value:"late"}})).data)
      .toEqual({status:"stale"});
    expect((await worker.command({type:"negotiate_protocol",protocolVersion:2})).success).toBe(true);
    expect((await worker.command({type:"set_ask_dialog",enabled:true})).success).toBe(true);
    const state=await worker.command({type:"get_state"});
    expect(state.data).toMatchObject({model:{provider:"openai",id:"gpt-4o"}});
    const mark=worker.frames.length;
    const prompt=worker.command({type:"prompt",message:"/s0-ask 100"});
    const ask=await worker.wait(f=>f.type === "extension_ui_request" && f.method === "ask",mark);
    const cancelled=await worker.wait(f=>f.type === "extension_ui_request" && f.method === "cancel" && f.targetId === ask.id,mark);
    expect(cancelled.reason).toBe("expired");
    expect((await worker.command({type:"respond_ui",targetId:ask.id,answer:{type:"ask",answers:[{id:"decision",selectedOptions:["Allow"]}]}})).data)
      .toEqual({status:"stale"});
    await prompt;
    expect((await worker.wait(f=>f.type === "extension_ui_request" && f.method === "notify" && f.message === "ask:cancelled",mark)).message)
      .toBe("ask:cancelled");
  } finally { expect(await worker.close()).toMatchObject({code:0,stdoutDrained:true}); }
},30_000);

test("startup abort invalidates the native question before ordinary startup commands can finish",async()=>{
  const worker=await startNativeInteractionFixture();
  try {
    const startup=await worker.wait(f=>f.type === "extension_ui_request" && f.method === "input");
    const mark=worker.frames.length;
    const abort=worker.command({type:"abort"});
    expect(await worker.wait(f=>f.type === "extension_ui_request" && f.method === "cancel" && f.targetId === startup.id,mark))
      .toMatchObject({reason:"aborted"});
    expect((await worker.command({type:"respond_ui",targetId:startup.id,answer:{type:"value",value:"late"}})).data)
      .toEqual({status:"stale"});
    expect((await abort).success).toBe(true);
  }finally{expect(await worker.close()).toMatchObject({code:0,stdoutDrained:true});}
},30_000);

test("EOF with pending startup UI drains and exits without a synthesized answer",async()=>{
  const worker=await startNativeInteractionFixture();
  await worker.wait(f=>f.type === "extension_ui_request" && f.method === "input");
  expect(await worker.close()).toMatchObject({code:0,stdoutDrained:true});
  expect(worker.frames.some(f=>f.type === "extension_ui_request" && f.method === "notify" &&
    typeof f.message === "string" && f.message.startsWith("startup:"))).toBe(false);
},30_000);
