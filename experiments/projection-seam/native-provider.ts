/** Literal-only trusted fixture provider; the worker is guarded before any imports. */
import type {ExtensionAPI} from '@oh-my-pi/pi-coding-agent/extensibility/extensions';
import {createAssistantMessageEventStream,type AssistantMessage} from '@oh-my-pi/pi-ai';
export default function(pi:ExtensionAPI){
  const profile=process.env.OMP_HISTORY_FIXTURE_PROFILE;
  if(!profile||process.env.HOME!==profile||process.env.PI_CODING_AGENT_DIR!==profile)throw Error('synthetic_profile_required');
  pi.on('session_start',(_event,ctx)=>ctx.ui.notify(JSON.stringify({kind:'projection-native-process',pid:process.pid})));
  pi.registerProvider('s0-projection',{baseUrl:'https://forbidden.invalid',apiKey:'synthetic-only',api:'s0-projection',
    models:['first','second'].map(id=>({id,name:'Literal projection fixture '+id,reasoning:false,input:['text'],
      contextWindow:32768,maxTokens:1024,cost:{input:0,output:0,cacheRead:0,cacheWrite:0}})),
    streamSimple(model,context){
      const last=context.messages.findLast(message=>message.role==='user'||message.role==='toolResult');
      const ask=last?.role==='user'&&(typeof last.content==='string'?last.content==='ASK_FOR_PROJECTION_PROOF':last.content.some(block=>block.type==='text'&&block.text==='ASK_FOR_PROJECTION_PROOF'));
      const call={type:'toolCall' as const,id:'native-projection-ask',name:'ask',arguments:{html:
        '<form><label>Pick<select name="pick"><option selected>default</option><option>chosen</option></select></label>'+
        '<label>Reason<input name="reason" value="default reason"></label></form>'}};
      const message:AssistantMessage={role:'assistant',api:model.api,provider:model.provider,model:model.id,timestamp:Date.now(),
        content:ask?[call]:[{type:'text',text:last?.role==='toolResult'?'NATIVE ASK COMPLETED':'NATIVE OFF BRANCH ORIGINAL'}],
        stopReason:ask?'toolUse':'stop',usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}};
      const stream=createAssistantMessageEventStream();stream.push({type:'start',partial:message});
      if(ask){stream.push({type:'toolcall_start',contentIndex:0,partial:message});stream.push({type:'toolcall_end',contentIndex:0,toolCall:call,partial:message});}
      stream.push({type:'done',reason:ask?'toolUse':'stop',message});return stream;
    }});
}
