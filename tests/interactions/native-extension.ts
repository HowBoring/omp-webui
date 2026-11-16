/** Copied inside the owned OMP package: public self exports resolve to the candidate source. */
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent/extensibility/extensions";
import { createAssistantMessageEventStream, type AssistantMessage } from "@oh-my-pi/pi-ai";
import { ToolContextStore } from "@oh-my-pi/pi-coding-agent/tools/context";
import { AskTool } from "@oh-my-pi/pi-coding-agent/tools/ask";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";

const questions = [{ id: "decision", question: "Synthetic decision?", options: [{ label: "Allow" }, { label: "Deny" }] }];
export default function interactions(pi: ExtensionAPI): void {
  // Established public provider boundary: literal messages only, no model/network implementation.
  pi.registerProvider("s0-scripted",{baseUrl:"http://provider.invalid/v1",apiKey:"synthetic-in-process-only",api:"s0-scripted-ask",
    models:[{id:"ask",name:"S0 deterministic stream fixture",reasoning:false,input:["text"],
      cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:32768,maxTokens:1024}],
    streamSimple:(model,context)=>{
      const stream=createAssistantMessageEventStream();
      const last=context.messages.findLast(message=>message.role === "user" || message.role === "toolResult");
      const message:AssistantMessage={role:"assistant",api:model.api,provider:model.provider,model:model.id,
        usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},
        timestamp:Date.now(),content:[{type:"text",text:"scripted boundary complete"}],stopReason:"stop"};
      const toolCall={type:"toolCall" as const,id:`s0-native-ask-${context.messages.length}`,name:"ask",arguments:{html:
        '<form><label>Pick<select name="pick"><option selected>default</option><option>chosen</option></select></label>'+
        '<label>Reason<input name="reason" value="default reason"></label></form>'}};
      if(last?.role === "user"){message.content=[toolCall];message.stopReason="toolUse";}
      stream.push({type:"start",partial:message});
      if(last?.role === "user"){
        stream.push({type:"toolcall_start",contentIndex:0,partial:message});
        stream.push({type:"toolcall_end",contentIndex:0,toolCall,partial:message});
      }
      stream.push({type:"done",reason:last?.role === "user" ? "toolUse" : "stop",message});return stream;
    },
  });
  pi.on("session_start", async (_event, ctx) => {
    const answer = await ctx.ui.input("S0 isolated startup interaction");
    ctx.ui.notify(`startup:${answer ?? "cancelled"}`);
  });
  pi.registerCommand("s0-ask", { handler: async (args, ctx) => {
    const result = await ctx.ui.askDialog?.(questions, Number(args) > 0 ? { timeout: Number(args) } : {});
    ctx.ui.notify(`ask:${result === undefined ? "cancelled" : JSON.stringify(result)}`);
  } });
  pi.registerCommand("s0-multi-ask", {handler:async(_args,ctx)=>{
    const result=await ctx.ui.askDialog?.([
      {id:"direction",question:"Direction?",options:[{label:"North"},{label:"South"}]},
      {id:"colors",question:"Colors?",multi:true,options:[{label:"Red"},{label:"Blue"},{label:"Green"}]},
    ]);
    ctx.ui.notify(`multi:${result === undefined ? "cancelled" : JSON.stringify(result)}`);
  }});
  pi.registerCommand("s0-confirm", {handler:async(_args,ctx)=>{
    const result=await ctx.ui.confirm("S0 confirmation","Explicit confirmation message must be visible");
    ctx.ui.notify(`confirm:${result}`);
  }});
  pi.registerCommand("s0-select", { handler: async (_args, ctx) => {
    const result = await ctx.ui.select("S0 exact approval labels", ["Allow", "Deny"]);
    ctx.ui.notify(`select:${result ?? "cancelled"}`);
  } });
  pi.registerCommand("s0-tool", { handler: async (args, ctx) => runTool(Number(args) || 0, ctx) });
}

async function runTool(timeout: number, ctx: ExtensionContext): Promise<void> {
  // Native tool contract fixture: in-memory settings only, no Agent/provider invocation.
  const settings = Settings.isolated({ "ask.timeout": timeout, "ask.notify": "off", "speech.enabled": false });
  const tool = new AskTool({ cwd: ctx.cwd, hasUI: true, getSessionFile: () => null, getSessionSpawns: () => "*", settings });
  let aborted = false;
  // The exact public core context store used by sdk.ts, with live native worker
  // state and its real UI; trackUserWaits must preserve the immutable getter.
  const store=new ToolContextStore(()=>({sessionManager:ctx.sessionManager,modelRegistry:ctx.modelRegistry,
    model:ctx.model,isIdle:()=>ctx.isIdle(),hasQueuedMessages:()=>ctx.hasPendingMessages(),settings,
    abort:()=>{aborted=true;ctx.abort();}}),dialog=>dialog());
  store.setUIContext(ctx.ui,true);
  const executionContext=store.getContext();
  if(!executionContext.ui || Reflect.get(executionContext.ui,"explicitAnswersOnly") !== true) {
    throw new Error("Native core tool context lost explicit-answer policy");
  }
  try {
    const result = await tool.execute("synthetic-tool-1", {html:
      '<form><label>Pick<select name="pick"><option selected>default</option><option>chosen</option></select></label>' +
      '<label>Reason<input name="reason" value="default reason"></label></form>'}, undefined, undefined,
      executionContext);
    ctx.ui.notify(`tool:submitted:${JSON.stringify(result.details)}`);
  } catch {
    ctx.ui.notify(`tool:cancelled:abort=${aborted}`);
  }
}
