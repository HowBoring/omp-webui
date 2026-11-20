/** Root-safe UI rendering follows the accepted #33 public Interaction contract. */
import { useState } from "react";
import type { PendingInteraction, UIAnswer } from "../../../packages/contracts/interactions.ts";
export function NativeInteractionCard({card,onAnswer}:{card:PendingInteraction;onAnswer:(answer:UIAnswer)=>Promise<void>}) {
  const [value,setValue]=useState(card.prefill ?? "");
  return <section data-interaction-id={card.id} data-generation={card.generation} data-created-at={card.createdAt} data-scope={card.scope.kind}>
    <h2>{card.title}</h2>{card.message && <p>{card.message}</p>}<p>{card.scope.kind === "startup" ? "Startup context — no Session required" : `Native Session ${card.scope.sessionId}`}</p>
    <p data-deadline={card.deadline}>Original deadline: {new Date(card.deadline).toISOString()}</p>
    {card.method === "select" ? card.options?.map(option=><button key={option} onClick={()=>void onAnswer({type:"value",value:option})}>{option}</button>)
      : card.method === "confirm" ? <><button onClick={()=>void onAnswer({type:"confirm",confirmed:true})}>Confirm</button>
        <button onClick={()=>void onAnswer({type:"confirm",confirmed:false})}>Deny</button></>
      : card.method === "ask" ? <AskAnswers card={card} onAnswer={onAnswer}/>
      : <>{card.method === "editor" && !card.promptStyle ?
        <textarea aria-label="Explicit answer" rows={6} value={value} onChange={event=>setValue(event.target.value)}/> :
        <input type={card.secret ? "password":"text"} aria-label="Explicit answer" value={value} onChange={event=>setValue(event.target.value)}/>}
        <button onClick={()=>void onAnswer({type:"value",value})}>Submit explicit answer</button></>}
    <button onClick={()=>void onAnswer({type:"cancel"})}>Cancel interaction</button>
  </section>;
}
function AskAnswers({card,onAnswer}:{card:PendingInteraction;onAnswer:(answer:UIAnswer)=>Promise<void>}) {
  const questions=card.questions ?? [];
  const [answers,setAnswers]=useState(()=>questions.map(question=>({id:question.id,selectedOptions:[] as string[],customInput:""})));
  if(questions.length === 1 && !questions[0]!.multi) {
    const question=questions[0]!;
    return <div><p>{question.question}</p>{question.options.map(option=><button key={option.label}
      onClick={()=>void onAnswer({type:"ask",answers:[{id:question.id,selectedOptions:[option.label]}]})}>{option.label}</button>)}
      <input aria-label={`Custom answer: ${question.question}`} value={answers[0]!.customInput}
        onChange={event=>setAnswers([{id:question.id,selectedOptions:[],customInput:event.target.value}])}/>
      <button disabled={!answers[0]!.customInput.trim()} onClick={()=>void onAnswer({type:"ask",answers:[{
        id:question.id,selectedOptions:[],customInput:answers[0]!.customInput.trim()}]})}>Submit custom answer</button></div>;
  }
  return <div>{questions.map((question,index)=><fieldset key={question.id}><legend>{question.question}</legend>
    {question.options.map(option=><label key={option.label}><input type={question.multi ? "checkbox":"radio"}
      name={question.id} checked={answers[index]!.selectedOptions.includes(option.label)} onChange={event=>setAnswers(old=>old.map((answer,at)=>{
        if(at !== index)return answer;
        const selected=question.multi ? answer.selectedOptions.filter(label=>label !== option.label) : [];
        return {...answer,selectedOptions:event.target.checked ? [...selected,option.label] : selected,
          customInput:question.multi ? answer.customInput:""};
      }))}/>{option.label}</label>)}
    <input aria-label={`Custom answer: ${question.question}`} value={answers[index]!.customInput}
      onChange={event=>setAnswers(old=>old.map((answer,at)=>at === index ? {...answer,customInput:event.target.value,
        selectedOptions:question.multi ? answer.selectedOptions:[]} : answer))}/>
  </fieldset>)}<button disabled={answers.some(answer=>!answer.selectedOptions.length && !answer.customInput.trim())}
    onClick={()=>void onAnswer({type:"ask",answers:answers.map(answer=>({...answer,
      ...(answer.customInput.trim() ? {customInput:answer.customInput.trim()} : {customInput:undefined})}))})}>Submit answers</button></div>;
}
