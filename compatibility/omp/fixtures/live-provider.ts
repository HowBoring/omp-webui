/** Controlled external model boundary. This is deterministic fixture output, never real AI inference. */
import { createAssistantMessageEventStream, type as schemaType } from '@oh-my-pi/pi-ai';
import * as fs from 'node:fs';
import * as path from 'node:path';
export default function(pi) {
  const profile=process.env.OMP_HISTORY_FIXTURE_PROFILE;
  if(!profile || process.env.HOME!==profile || process.env.PI_CODING_AGENT_DIR!==profile) throw Error('synthetic_profile_required');
  let calls=0;
  pi.registerProvider('s0-controlled', {
    baseUrl:'https://forbidden.invalid',apiKey:'synthetic-fixture-key',api:'s0-controlled',
    models:[{id:'deterministic-live',name:'Controlled fixture (not real AI)',reasoning:false,input:['text'],
      contextWindow:128000,maxTokens:8192,cost:{input:0,output:0,cacheRead:0,cacheWrite:0}}],
    streamSimple(model,context,options) {
      if(model.provider!=='s0-controlled'||model.id!=='deterministic-live') throw Error('unexpected_fixture_provider');
      calls++; fs.writeFileSync(path.join(profile,'controlled-provider.json'),JSON.stringify({calls,kind:'controlled-in-process-provider',realProviderInference:false}));
      const stream=createAssistantMessageEventStream();
      const partial={role:'assistant',api:'s0-controlled',provider:'s0-controlled',model:'deterministic-live',
        timestamp:calls,stopReason:'stop',content:[],
        usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}};
      void (async()=>{
        stream.push({type:'start',partial});
        await Bun.sleep(80);
        if(process.env.OMP_LIVE_FIXTURE_TOOLS==='1'&&context.messages.at(-1)?.role!=='toolResult'){
          const toolCall={type:'toolCall',id:'reusable-fixture-id',name:'s0_fixture',arguments:{}};
          partial.content=[toolCall];
          stream.push({type:'toolcall_start',contentIndex:0,partial});
          stream.push({type:'toolcall_delta',contentIndex:0,delta:'{}',partial});
          stream.push({type:'toolcall_end',contentIndex:0,toolCall,partial});
          partial.stopReason='toolUse';stream.push({type:'done',reason:'toolUse',message:partial});stream.end();return;
        }
        partial.content=[{type:'text',text:''}];stream.push({type:'text_start',contentIndex:0,partial});
        if(process.env.OMP_LIVE_FIXTURE_BURST==='1')for(let i=0;i<4500;i++){const delta=Bun.SHA256.hash(String(i),'hex').slice(0,6)+' ';partial.content[0].text+=delta;
          stream.push({type:'text_delta',contentIndex:0,delta,partial:{...partial,content:partial.content.map(block=>({...block}))}});if(i%20===0)await Bun.sleep(0);}
        for(const delta of ['authoritative ','controlled ','final']) {
          if(options?.signal?.aborted) break;
          partial.content[0].text+=delta;
          stream.push({type:'text_delta',contentIndex:0,delta,partial});await Bun.sleep(80);
        }
        if(process.env.OMP_LIVE_FIXTURE_BURST!=='1')partial.content[0].text='authoritative controlled final';
        stream.push({type:'text_end',contentIndex:0,content:partial.content[0].text,partial});
        partial.stopReason=options?.signal?.aborted?'aborted':'stop';
        stream.push({type:'done',reason:partial.stopReason,message:partial});stream.end();
      })().catch(error=>{stream.push({type:'error',reason:'error',error:{...partial,stopReason:'error',errorMessage:String(error)}});stream.end();});
      return stream;
    },
  });
  pi.registerTool({name:'s0_fixture',label:'Controlled tool',description:'Deterministic fixture tool',
    parameters:schemaType({}),async execute(){return {content:[{type:'text',text:'controlled result'}]}}});
}
