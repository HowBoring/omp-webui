import { expect, test } from "bun:test";
import { InteractionBridge, type InteractionPort } from "../../packages/interactions/bridge.ts";

/** Controlled public worker boundary: native processing/replies can progress independently. */
function controlledPort() {
  const listeners = new Set<(frame: {type:string;[key:string]:unknown})=>void>();
  const requests: {command:object;reply:ReturnType<typeof Promise.withResolvers<unknown>>}[]=[];
  const port:InteractionPort={frames:[{type:"ready",interactionPolicy:{version:"1",explicitAnswersOnly:true,
    nativeExpiry:"cancel",toolExpiry:"cancel",invalidAnswer:"pending"}}],
    subscribe(listener){listeners.add(listener);return ()=>{listeners.delete(listener);};},
    command(command){const reply=Promise.withResolvers<unknown>();requests.push({command,reply});return reply.promise;}};
  const emit=(frame:{type:string;[key:string]:unknown})=>{for(const listener of listeners)listener(frame);};
  const ask=(id:string)=>emit({type:"extension_ui_request",id,method:"input",title:"Synthetic"});
  return {port,requests,emit,ask};
}

test("only the first admitted settlement owns the native reply and later replies are stale",async()=>{
  const worker=controlledPort();const bridge=new InteractionBridge(worker.port);
  try {
    worker.ask("first");
    const head=bridge.answer(bridge.generation,"first",{type:"confirm",confirmed:true});
    const flood=await Promise.all(Array.from({length:512},()=>bridge.answer(bridge.generation,"first",{type:"value",value:"retry"})));
    expect(flood).toEqual(Array.from({length:512},()=>({status:"stale"})));
    expect(worker.requests).toHaveLength(1);
    worker.requests[0]!.reply.resolve({status:"invalid"});expect(await head).toEqual({status:"invalid"});
    expect(bridge.snapshot().pending).toHaveLength(1);
    const valid=bridge.answer(bridge.generation,"first",{type:"value",value:"explicit"});
    worker.emit({type:"extension_ui_request",id:"cancel-notice",method:"cancel",targetId:"first",reason:"aborted"});
    worker.requests[1]!.reply.resolve({status:"answered"});
    expect(await valid).toEqual({status:"answered"}); // notification order must not rewrite a native acknowledgement
    expect(await bridge.answer(bridge.generation,"first",{type:"value",value:"late"})).toEqual({status:"stale"});
    expect(bridge.snapshot().pending).toHaveLength(0);
  }finally{bridge.dispose();}
});

test("a cancellation racing a held answer settles stale without a second native command",async()=>{
  const worker=controlledPort();const bridge=new InteractionBridge(worker.port);
  try {
    worker.ask("cancel");const head=bridge.answer(bridge.generation,"cancel",{type:"value",value:"explicit"});
    const repeated=Array.from({length:512},()=>bridge.answer(bridge.generation,"cancel",{type:"cancel"}));
    expect(await Promise.all(repeated)).toEqual(Array.from({length:512},()=>({status:"stale"})));
    expect(worker.requests.map(item=>item.command)).toEqual([
      {type:"respond_ui",targetId:"cancel",answer:{type:"value",value:"explicit"}},
    ]);
    worker.requests[0]!.reply.resolve({status:"answered"});expect(await head).toEqual({status:"answered"});
    expect(bridge.snapshot().outcomes).toEqual([{id:"cancel",status:"answered",reason:"explicit-answer",stop:"none"}]);
  }finally{bridge.dispose();}
});

test("an answer racing a held cancellation settles stale in either arrival order",async()=>{
  for(const order of ["cancel-first","answer-first"] as const) {
    const worker=controlledPort();const bridge=new InteractionBridge(worker.port);
    try {
      worker.ask("race");
      const first=order === "cancel-first"
        ? bridge.answer(bridge.generation,"race",{type:"cancel"})
        : bridge.answer(bridge.generation,"race",{type:"value",value:"explicit"});
      const second=order === "cancel-first"
        ? bridge.answer(bridge.generation,"race",{type:"value",value:"explicit"})
        : bridge.answer(bridge.generation,"race",{type:"cancel"});
      expect(await second).toEqual({status:"stale"});
      expect(worker.requests).toHaveLength(1);
      worker.requests[0]!.reply.resolve({status:"answered"});expect(await first).toEqual({status:"answered"});
    }finally{bridge.dispose();}
  }
});

test("Host expiry sends cancellation and abort while an answer acknowledgement is held",async()=>{
  const worker=controlledPort();const bridge=new InteractionBridge(worker.port,{waitMs:20});
  try {
    worker.ask("expiry");const head=bridge.answer(bridge.generation,"expiry",{type:"value",value:"explicit"});
    await Bun.sleep(40);
    expect(worker.requests.map(item=>item.command)).toContainEqual({type:"respond_ui",targetId:"expiry",answer:{type:"cancel",timedOut:true}});
    expect(worker.requests.map(item=>item.command)).toContainEqual({type:"abort"});
    for(const item of worker.requests.slice(1))item.reply.resolve({status:"stale"});
    worker.requests[0]!.reply.resolve({status:"answered"});expect(await head).toEqual({status:"answered"});
    const stopped=bridge.snapshot();
    expect(stopped.pending).toHaveLength(0);
    expect(stopped.outcomes).toContainEqual({id:"worker-stop",status:"stopping",reason:"expired",stop:"acknowledged"});
    bridge.dispose();worker.ask("after-disposal");expect(bridge.snapshot().pending).toHaveLength(0);
  }finally{bridge.dispose();}
});


test("worker answer capacity remains bounded across interactions and disposal",async()=>{
  const worker=controlledPort();const bridge=new InteractionBridge(worker.port);
  const accepted:Promise<unknown>[]=[];
  for(let n=0;n<16;n++)worker.ask(`worker-${n}`);
  for(let n=0;n<8;n++)accepted.push(bridge.answer(bridge.generation,`worker-${n}`,{type:"value",value:"explicit"}));
  expect(await bridge.answer(bridge.generation,"worker-8",{type:"value",value:"excess"}))
    .toEqual({status:"overloaded",code:"INTERACTION_ANSWER_LIMIT"});
  expect(worker.requests).toHaveLength(8);
  bridge.dispose();
  expect(bridge.snapshot().pending).toHaveLength(0);
  expect(await bridge.answer(bridge.generation,"worker-8",{type:"cancel"})).toEqual({status:"stale"});
  for(const request of worker.requests)request.reply.resolve({status:"stale"});
  expect(await Promise.all(accepted)).toEqual(Array.from({length:8},()=>({status:"stale"})));
  worker.ask("after-disposal");expect(bridge.snapshot().pending).toHaveLength(0);
});

test("a Host deadline reached before its timer callback sends cancellation and returns the actual native result",async()=>{
  const original=Object.getOwnPropertyDescriptor(performance,"now");
  const worker=controlledPort();let now=0;
  Object.defineProperty(performance,"now",{value:()=>now,configurable:true});
  const bridge=new InteractionBridge(worker.port,{waitMs:60_000});
  try {
    worker.ask("deadline-before-timer");now=60_000;
    const reply=bridge.answer(bridge.generation,"deadline-before-timer",{type:"value",value:"too late"});
    expect(worker.requests.map(item=>item.command)).toEqual([
      {type:"respond_ui",targetId:"deadline-before-timer",answer:{type:"cancel",timedOut:true}},
      {type:"abort"},
    ]);
    worker.requests[0]!.reply.resolve({status:"stale"});
    expect(await reply).toEqual({status:"stale"});
    worker.requests[1]!.reply.resolve({});
  }finally {
    bridge.dispose();
    if(original)Object.defineProperty(performance,"now",original);else Reflect.deleteProperty(performance,"now");
  }
});

test("default wait is 30 minutes from creation, a native timeout configures the next request, and snapshots never renew",async()=>{
  const worker=controlledPort();const bridge=new InteractionBridge(worker.port);
  try {
    worker.ask("default");
    const first=bridge.snapshot().pending[0]!;
    expect(first.deadline-first.createdAt).toBe(30*60*1000);
    worker.emit({type:"extension_ui_request",id:"configured",method:"input",title:"Configured",timeout:45_000});
    const second=bridge.snapshot().pending.find(card=>card.id === "configured")!;
    expect(second.deadline-second.createdAt).toBe(45_000);
    const before=bridge.snapshot();
    expect(bridge.snapshot()).toEqual(before);
    expect(worker.requests).toHaveLength(0);
  }finally{bridge.dispose();}
});

test("host tool, URI and presentation families never enter the interaction map or receive respond_ui",async()=>{
  const worker=controlledPort();const bridge=new InteractionBridge(worker.port);
  try {
    worker.emit({type:"host_tool_call",id:"tool",toolName:"synthetic",args:{}});
    worker.emit({type:"host_tool_cancel",id:"tool-cancel",targetId:"tool"});
    worker.emit({type:"host_uri_request",id:"uri",operation:"read",url:"synthetic://resource"});
    worker.emit({type:"host_uri_cancel",id:"uri-cancel",targetId:"uri"});
    worker.emit({type:"extension_ui_request",id:"notify",method:"notify",message:"Synthetic"});
    expect(bridge.snapshot().pending).toHaveLength(0);
    expect(worker.requests).toHaveLength(0);
  }finally{bridge.dispose();}
});

test("an invalid public UI frame requests Stop with an observable reason and acknowledgement",async()=>{
  const worker=controlledPort();const bridge=new InteractionBridge(worker.port);
  try {
    worker.emit({type:"extension_ui_request",id:"invalid",method:"input",title:42});
    worker.requests[0]!.reply.resolve({});
    await Bun.sleep(0);
    expect(bridge.snapshot().pending).toHaveLength(0);
    expect(bridge.snapshot().outcomes).toEqual([
      {id:"worker-stop",status:"stopping",reason:"invalid-ui-contract",stop:"acknowledged"},
    ]);
  }finally{bridge.dispose();}
});
