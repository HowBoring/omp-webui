import { expect } from "bun:test";
const base = process.env.OMP_NATIVE_ROOT!;
const { requestRpcAskDialog, requestRpcSelect, requestRpcEditor, requestRpcInput } = await import(`${base}/modes/rpc/rpc-mode.ts`);
const { requestExplicitRpcDialog, replyRpcInteraction, rpcInteractionPolicy } = await import(`${base}/modes/rpc/rpc-interactions.ts`);
const { AskTool } = await import(`${base}/tools/ask.ts`);
const { Settings } = await import(`${base}/config/settings.ts`);
let now = 0;
let next = 0;
const timers = new Map<number, { at: number; callback: () => void }>();
Object.defineProperty(performance, "now", { value: () => now });
globalThis.setTimeout = ((callback: () => void, duration: number) => {
  const id = ++next; timers.set(id, { at: now + duration, callback }); return id;
}) as unknown as typeof setTimeout;
globalThis.clearTimeout = ((id: number) => { timers.delete(id); }) as unknown as typeof clearTimeout;
function advance(duration: number, callbacks = true): void {
  now += duration;
  if (!callbacks) return;
  for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.callback(); }
}
const questions = [{id:"q", question:"Confirm?", options:[{label:"default", recommended:true},{label:"explicit"}]}];
const frames: Record<string, unknown>[] = [];
const pending = new Map();
const output = (frame: Record<string, unknown>) => { frames.push(frame); };
const answer = (id: string, value: string) => ({type:"extension_ui_response", id, answers:[{id:"q", selectedOptions:[value]}]});
expect(Object.isFrozen(rpcInteractionPolicy)).toBe(true);
const p = requestRpcAskDialog(pending, output, questions, {timeout:1_800_000});
const id = frames.at(-1)!.id as string;
advance(1_799_999);
expect(pending.has(id)).toBe(true);
expect(replyRpcInteraction(pending, answer(id, "wrong"))).toEqual({status:"invalid"});
expect(pending.has(id)).toBe(true);
advance(1, false); // Worker event loop has not delivered the native timer yet.
expect(replyRpcInteraction(pending, answer(id, "explicit"))).toEqual({status:"expired"});
expect(await p).toBeUndefined();
expect(replyRpcInteraction(pending, answer(id, "explicit"))).toEqual({status:"stale"});
expect(frames.at(-1)).toMatchObject({method:"cancel", targetId:id, reason:"expired"});
advance(1001);
expect(replyRpcInteraction(pending, answer(id,"default"))).toEqual({status:"stale"});

for (const timedOut of [false, true]) {
  const result = requestRpcAskDialog(pending, output, questions, {timeout:100});
  const target = frames.at(-1)!.id as string;
  expect(replyRpcInteraction(pending, {type:"extension_ui_response",id:target,cancelled:true,timedOut}))
    .toEqual({status: timedOut ? "expired" : "cancelled"});
  expect(await result).toBeUndefined();
}
const mutable=[{id:"original",question:"Original question",options:[{label:"Original"},{label:"Other"}]}];
const immutable=requestRpcAskDialog(pending,output,mutable);
const immutableId=frames.at(-1)!.id as string;
mutable[0]!.id="replaced";mutable[0]!.options[0]!.label="replaced";
expect(replyRpcInteraction(pending,{type:"extension_ui_response",id:immutableId,answers:[
  {id:"original",selectedOptions:["Original"]}]})).toEqual({status:"answered"});
expect(await immutable).toMatchObject({kind:"submit",results:[{id:"original",options:["Original","Other"],selectedOptions:["Original"]}]});

const controller = new AbortController();
const aborted = requestRpcAskDialog(pending, output, questions, {signal:controller.signal,timeout:100});
const abortId = frames.at(-1)!.id as string;
const captured = pending.get(abortId)!;
controller.abort();
advance(100);
expect(await aborted).toBeUndefined();
expect(captured.resolve(answer(abortId,"explicit"))).toEqual({status:"stale"});
expect(frames.at(-1)).toMatchObject({reason:"aborted"});

const explicit = requestRpcAskDialog(pending, output, questions, {timeout:100});
const target = frames.at(-1)!.id as string;
expect(replyRpcInteraction(pending, answer(target,"explicit"))).toEqual({status:"answered"});
expect(replyRpcInteraction(pending, answer(target,"default"))).toEqual({status:"stale"});
advance(100);
expect(await explicit).toMatchObject({kind:"submit",results:[{selectedOptions:["explicit"]}]});

const confirm = requestExplicitRpcDialog(pending, output, undefined, false, {method:"confirm"},
  (response: {confirmed:boolean}) => response.confirmed);
const confirmId = frames.at(-1)!.id as string;
expect(replyRpcInteraction(pending, {type:"extension_ui_response",id:confirmId,value:"yes"})).toEqual({status:"invalid"});
expect(replyRpcInteraction(pending, {type:"extension_ui_response",id:confirmId,confirmed:false})).toEqual({status:"answered"});
expect(await confirm).toBe(false);

const form = '<form><label>Pick<select name="pick"><option selected>default</option><option>explicit</option></select></label>'+
  '<label>Explain<input name="text" value="default reason"></label></form>';
for (const kind of ["fallback", "formDialog"]) {
  let stopped = false;
  const tool = new AskTool({cwd:process.cwd(),hasUI:true,settings:Settings.isolated({"ask.timeout":1,"ask.notify":"off"})});
  const ui = {
    explicitAnswersOnly:true,
    select:(title: string, options: string[], opts: object) => requestRpcSelect(pending,output,title,options,opts),
    input:(title: string, placeholder: string, opts: object) => requestRpcInput(pending,output,title,placeholder,opts),
    editor:(title: string, prefill: string, opts: object) => requestRpcEditor(pending,output,title,prefill,opts),
    ...(kind === "formDialog" ? {formDialog: async () => ({data:{pick:"default",text:"default reason"},timedOut:true})} : {}),
  };
  const result = tool.execute("tool",{html:form},undefined,undefined,{hasUI:true,ui,abort:()=>{stopped=true;}})
    .then(() => "submitted", () => "cancelled");
  await Promise.resolve(); await Promise.resolve();
  if (kind === "fallback") {
    const first = frames.at(-1)!.id as string;
    advance(750);
    expect(replyRpcInteraction(pending,{type:"extension_ui_response",id:first,value:"explicit"})).toEqual({status:"answered"});
    // Allow the real fallback to move to its second field; the form deadline remains original.
    for (let n=0;n<10;n++) await Promise.resolve();
    const second=frames.at(-1)!;
    expect(second.timeout).toBe(250);
    advance(250,false); // Reply races before either the form timer or field timer callback.
    expect(replyRpcInteraction(pending,{type:"extension_ui_response",id:second.id,value:"too late"})).toEqual({status:"expired"});
    advance(0);
  }
  expect(await result).toBe("cancelled");
  expect(stopped).toBe(true);
}
const failed=requestRpcAskDialog(pending,()=>{throw new Error("fixture output failed");},questions,{timeout:3000});
await expect(failed).rejects.toThrow("fixture output failed");
expect(pending.size).toBe(0);
expect(timers.size).toBe(0);
console.log("controlled-clock: PASS");
