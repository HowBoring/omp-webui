import { Context } from "@deepseek-ai/cordis";
import { apply as connection } from "@deepseek-ai/dsh-client-connection/client";
import { apply as registry } from "@deepseek-ai/dsh-typert-registry/client";
import { apply as gateway } from "@deepseek-ai/dsh-api-gateway/client";
import { apply as renderer } from "@deepseek-ai/dsh-client-ui-renderer/client";
import { useEffect, useState } from "react";
import type { PropsRenderSlots, StandardSourceBinding, HostObservable } from "@deepseek-ai/dsh-client-ui-slots";
import { interactionsContribution, type InteractionSnapshot, type UIAnswer, type PendingInteraction,
  type InteractionScenario } from "../../../packages/contracts/interactions.ts";

declare module "@deepseek-ai/dsh-client-ui-slots" {
  interface SlotMap { "s0.interactions":{kind:"single";scope:"root";owner:Record<never,never>} }
}
const ctx=new Context();
connection(ctx);registry(ctx);gateway(ctx);renderer(ctx);
// The renderer requires a public optional-scope adapter even with no Session.
// Explicit absence has no identity, Session object, methods or controller.
const absent:StandardSourceBinding={key:undefined,hooks:{},keyedHooks:{},props:{}};
const absentSource:HostObservable<StandardSourceBinding>={getSnapshot:()=>absent,subscribe:()=>()=>{}};
ctx.slots.installScope("session",{current:absentSource,bindingSource:target=>{
  if(target !== undefined)throw new Error("S0 fixture has no client Session binding");return absentSource;
}});
let refresh:()=>Promise<void>=async()=>{};
function Shell({renderSlot}:PropsRenderSlots<"s0.interactions">) {
  return <main data-s0-root-slot="true"><h1>S0 isolated native interactions</h1>
    <p>Session admission: blocked. Synthetic native fixtures only.</p>{renderSlot("s0.interactions",{})}</main>;
}
function InteractionCard({card,onAnswer}:{card:PendingInteraction;onAnswer:(answer:UIAnswer)=>Promise<void>}) {
  const [value,setValue]=useState("");
  return <section data-interaction-id={card.id} data-created-at={card.createdAt} data-scope={card.scope.kind}>
    <h2>{card.title}</h2><p>{card.scope.kind === "startup" ? "Startup context — no Session required" : `Native Session ${card.scope.sessionId}`}</p>
    <p data-deadline={card.deadline}>Original deadline: {new Date(card.deadline).toISOString()}</p>
    {card.method === "select" ? card.options?.map(option=><button key={option} onClick={()=>void onAnswer({type:"value",value:option})}>{option}</button>)
      : card.method === "confirm" ? <><button onClick={()=>void onAnswer({type:"confirm",confirmed:true})}>Confirm</button>
        <button onClick={()=>void onAnswer({type:"confirm",confirmed:false})}>Deny</button></>
      : card.method === "ask" ? card.questions?.map(question=><div key={question.id}><p>{question.question}</p>
        {question.options.map(option=><button key={option.label} onClick={()=>void onAnswer({type:"ask",answers:
          card.questions!.map(q=>({id:q.id,selectedOptions:[option.label]}))})}>{option.label}</button>)}</div>)
      : <><input aria-label="Explicit answer" value={value} onChange={event=>setValue(event.target.value)}/>
        <button onClick={()=>void onAnswer({type:"value",value})}>Submit explicit answer</button></>}
    <button onClick={()=>void onAnswer({type:"cancel"})}>Cancel interaction</button>
  </section>;
}
function Surface() {
  const [snapshot,setSnapshot]=useState<InteractionSnapshot>();
  const [result,setResult]=useState("");
  const [error,setError]=useState("");
  useEffect(()=>{
    let live=true;
    refresh=async()=>{
      const response=await ctx.remote.ompInteractions.snapshot();
      if(!live)return;
      if(response.ok){setSnapshot(response.value);setError("");}else setError(response.error.code);
    };
    void refresh();const timer=setInterval(()=>void refresh(),200);
    return()=>{live=false;clearInterval(timer);};
  },[]);
  const start=async(scenario:InteractionScenario)=>{
    const response=await ctx.remote.ompInteractions.start(scenario);
    if(!response.ok)setError(response.error.code);else setSnapshot(response.value);
  };
  return <div data-s0-interaction-surface="true"><p data-policy-verified={snapshot?.policyVerified ?? false}>
    Effective explicit-answer policy: {snapshot?.policyVerified ? "verified" : "pending"}</p>
    <p role="alert">{error}</p><p role="status" data-answer-result="true">{result}</p>
    {snapshot?.pending.map(card=><InteractionCard key={card.id} card={card} onAnswer={async answer=>{
      const reply=await ctx.remote.ompInteractions.answer(card.generation,card.id,answer);
      setResult(reply.ok ? reply.value.status : reply.error.code);await refresh();
    }}/>)}
    <nav>{(["ask","timed-ask","select","tool","timed-tool"] as const).map(scenario=>
      <button key={scenario} onClick={()=>void start(scenario)} disabled={!snapshot?.policyVerified || !!snapshot.pending.length}>
        Start {scenario}</button>)}</nav>
    <ol data-outcomes="true">{snapshot?.outcomes.map((outcome,index)=><li key={`${outcome.id}-${index}`}>{outcome.status}: {outcome.reason}</li>)}</ol>
  </div>;
}
await ctx.remote.$mount(interactionsContribution);
// This isolated shell owns the root; no stock AppFrame/Session controller is mounted.
ctx.slots.register({name:"root",children:{"s0.interactions":{kind:"single",scope:"root"}}},Shell);
ctx.slots.register({name:"s0.interactions"},Surface);
const mount=document.querySelector<HTMLElement>("#app");if(!mount)throw new Error("Missing mount");
const unmount=ctx.uiRenderer.mount(mount);
window.addEventListener("pagehide",()=>{unmount();void ctx.fiber.dispose();},{once:true});
