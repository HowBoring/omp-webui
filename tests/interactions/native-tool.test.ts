import { test,expect } from "bun:test";
import { startNativeInteractionFixture } from "./worker.ts";

async function open() {
  const worker=await startNativeInteractionFixture();
  const startup=await worker.wait(f=>f.type === "extension_ui_request" && f.method === "input");
  await worker.command({type:"respond_ui",targetId:startup.id,answer:{type:"value",value:"start"}});
  await worker.command({type:"set_ask_dialog",enabled:true});
  return worker;
}

test("actual native HTML fallback cancels partial expiry and near-deadline explicit cancellation",async()=>{
  const worker=await open();
  try {
    const mark=worker.frames.length;
    const operation=worker.command({type:"prompt",message:"/s0-tool 0.15"});
    const select=await worker.wait(f=>f.type === "extension_ui_request" && f.method === "select",mark);
    expect((await worker.command({type:"respond_ui",targetId:select.id,answer:{type:"value",value:"chosen"}})).data)
      .toEqual({status:"answered"});
    const input=await worker.wait(f=>f.type === "extension_ui_request" && ["input","editor"].includes(String(f.method)),mark);
    await worker.wait(f=>f.type === "extension_ui_request" && f.method === "cancel" && f.targetId === input.id,mark);
    await worker.wait(f=>f.type === "extension_ui_request" && f.message === "tool:cancelled:abort=true",mark);
    await operation;
    expect(worker.frames.slice(mark).some(f=>typeof f.message === "string" && f.message.startsWith("tool:submitted"))).toBe(false);
    expect((await worker.command({type:"respond_ui",targetId:input.id,answer:{type:"value",value:"late default"}})).data)
      .toEqual({status:"stale"});
    const again=worker.frames.length;
    const cancellation=worker.command({type:"prompt",message:"/s0-tool 0.15"});
    const choice=await worker.wait(f=>f.type === "extension_ui_request" && f.method === "select",again);
    expect((await worker.command({type:"respond_ui",targetId:choice.id,answer:{type:"cancel"}})).data).toEqual({status:"cancelled"});
    await worker.wait(f=>f.type === "extension_ui_request" && f.message === "tool:cancelled:abort=true",again);
    await cancellation;
  } finally {expect(await worker.close()).toMatchObject({code:0,stdoutDrained:true});}
},30_000);

test("actual rpc-ui races two valid answers and keeps extension/tool/URI correlations separate",async()=>{
  const worker=await open();
  try {
    const mark=worker.frames.length;
    const operation=worker.command({type:"prompt",message:"/s0-select"});
    const select=await worker.wait(f=>f.type === "extension_ui_request" && f.method === "select",mark);
    worker.send({type:"host_tool_result",id:select.id,result:{content:[]}});
    worker.send({type:"host_uri_result",id:select.id,content:"Allow"});
    expect((await worker.command({type:"respond_ui",targetId:select.id,answer:{type:"value",value:"unknown"}})).data)
      .toEqual({status:"invalid"});
    const replies=await Promise.all(["Allow","Deny"].map(value=>worker.command({type:"respond_ui",targetId:select.id,answer:{type:"value",value}})));
    expect(replies.map(reply=>reply.data)).toEqual([{status:"answered"},{status:"stale"}]);
    await operation;
    expect((await worker.wait(f=>f.type === "extension_ui_request" && f.method === "notify" && f.message === "select:Allow",mark)).message)
      .toBe("select:Allow");
  } finally {expect(await worker.close()).toMatchObject({code:0,stdoutDrained:true});}
},30_000);
