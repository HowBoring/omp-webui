/** Controlled external model boundary. This is deterministic fixture output, never real AI inference. */
import { createAssistantMessageEventStream, type as schemaType } from '@oh-my-pi/pi-ai';
import * as fs from 'node:fs';
import * as path from 'node:path';
export default function(pi) {
  const profile=process.env.OMP_HISTORY_FIXTURE_PROFILE;
  if(!profile || process.env.HOME!==profile || process.env.PI_CODING_AGENT_DIR!==profile) throw Error('synthetic_profile_required');
  let calls=0;
  const seed=Number(process.env.OMP_LIVE_FIXTURE_SEED??0);
  const stubborn=process.env.OMP_LIVE_FIXTURE_SCENARIO==='stubborn';
  const pendingUi=process.env.OMP_LIVE_FIXTURE_SCENARIO==='pending-ui';
  const pendingAudit=path.join(profile,'pending-ui-audit.json');
  if(stubborn){
    const audit=path.join(profile,'stubborn-audit.json');
    const facts={termObserved:false,termAt:0,exitAt:0};
    const record=()=>fs.writeFileSync(audit,JSON.stringify(facts));
    record();
    process.on('exit',()=>{facts.exitAt=Date.now();record();});
    process.on('SIGTERM',()=>{facts.termObserved=true;facts.termAt=Date.now();record();});
  }
  if(!Number.isSafeInteger(seed)||seed<0||seed>1000)throw Error('invalid_fixture_seed');
  pi.on('session_start',()=>{for(let index=0;index<seed;index++)pi.appendEntry('s0-synthetic-retained',{index});});
  pi.on('input',(event)=>{
    if(calls===0)return;
    if(process.env.OMP_LIVE_FIXTURE_SCENARIO==='handled')return {handled:true};
    if(process.env.OMP_LIVE_FIXTURE_SCENARIO==='transform'){
      pi.sendMessage({customType:'controlled-transform-notice',content:'equal transformed content',display:true});
      return {text:'equal transformed content'};
    }
  });
  pi.registerProvider('s0-controlled', {
    baseUrl:'https://forbidden.invalid',apiKey:'synthetic-fixture-key',api:'s0-controlled',
    models:[{id:'deterministic-live',name:'Controlled fixture (not real AI)',reasoning:false,input:['text'],
      contextWindow:128000,maxTokens:8192,cost:{input:0,output:0,cacheRead:0,cacheWrite:0}}],
    streamSimple(model,context,options) {
      if(model.provider!=='s0-controlled'||model.id!=='deterministic-live') throw Error('unexpected_fixture_provider');
      calls++; fs.writeFileSync(path.join(profile,'controlled-provider.json'),JSON.stringify({calls,kind:'controlled-in-process-provider',realProviderInference:false,tools:process.env.OMP_LIVE_FIXTURE_TOOLS??null,scenario:process.env.OMP_LIVE_FIXTURE_SCENARIO??null}));
      const stream=createAssistantMessageEventStream();
      const partial={role:'assistant',api:'s0-controlled',provider:'s0-controlled',model:'deterministic-live',
        timestamp:calls,stopReason:'stop',content:[],
        usage:{input:12,output:3,cacheRead:0,cacheWrite:0,totalTokens:15,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}};
      void (async()=>{
        stream.push({type:'start',partial});
        await Bun.sleep(80);
        const scenario=process.env.OMP_LIVE_FIXTURE_SCENARIO;
        if(fs.existsSync(path.join(profile,'retry-fail'))){
          partial.stopReason='error';
          partial.errorStatus=503;
          partial.errorMessage='synthetic retryable terminal error';
          stream.push({type:'error',reason:'error',error:partial});stream.end();return;
        }
        if(scenario==='retry'&&calls===1){
          partial.stopReason='error';
          partial.errorStatus=503;
          partial.errorMessage='synthetic retryable terminal error';
          stream.push({type:'error',reason:'error',error:partial});stream.end();return;
        }
        if(scenario==='retry-tool'&&calls===1){
          const call={type:'toolCall',id:'retry-tool-fixture-id',name:'s0_retry_tool',arguments:{},thoughtSignature:'retry-tool-signature'};
          partial.content=[call];stream.push({type:'toolcall_start',contentIndex:0,partial});
          stream.push({type:'toolcall_end',contentIndex:0,toolCall:call,partial});
          partial.stopReason='toolUse';stream.push({type:'done',reason:'toolUse',message:partial});stream.end();return;
        }
        if(calls>1&&['empty-error','refusal','empty-overflow'].includes(scenario)){
          partial.stopReason='error';
          partial.errorStatus=400;
          partial.errorMessage=scenario==='empty-overflow'?'maximum context length exceeded for synthetic fixture':'synthetic non-retryable terminal error';
          if(scenario==='refusal'){partial.content=[{type:'text',text:'synthetic refusal'}];partial.stopDetails={type:'refusal'};}
          stream.push({type:'error',reason:'error',error:partial});stream.end();return;
        }
        if(scenario==='rewind'&&(calls===2||calls===3)){
          const name=calls===2?'checkpoint':'rewind';
          const toolCall={type:'toolCall',id:'controlled-'+name,name,arguments:calls===2?{goal:'controlled exploration'}:{report:'controlled rewind report'}};
          partial.content=[toolCall];stream.push({type:'toolcall_start',contentIndex:0,partial});
          stream.push({type:'toolcall_end',contentIndex:0,toolCall,partial});
          partial.stopReason='toolUse';stream.push({type:'done',reason:'toolUse',message:partial});stream.end();return;
        }
        if(scenario==='reasoning'){
          partial.content=[{type:'thinking',thinking:''}];
          stream.push({type:'thinking_start',contentIndex:0,partial});
          partial.content[0].thinking='controlled reason';
          stream.push({type:'thinking_delta',contentIndex:0,delta:'controlled reason',partial});
          stream.push({type:'thinking_end',contentIndex:0,content:'controlled reason',partial});
          partial.content.push({type:'text',text:''});
          stream.push({type:'text_start',contentIndex:1,partial});
          for(const delta of ['authoritative ','controlled ','final']){
            partial.content[1].text+=delta;
            stream.push({type:'text_delta',contentIndex:1,delta,partial});
            await Bun.sleep(Number(process.env.OMP_LIVE_FIXTURE_DELAY_MS??80));
          }
          partial.content[1].text='authoritative controlled final';
          stream.push({type:'text_end',contentIndex:1,content:'authoritative controlled final',partial});
          stream.push({type:'done',reason:'stop',message:partial});stream.end();return;
        }
        const toolMode=process.env.OMP_LIVE_FIXTURE_TOOLS;
        const lastUser=context.messages.filter(message=>message.role==='user').at(-1);
        const lastUserContent=lastUser?.content;
        const promptText=typeof lastUserContent==='string'?lastUserContent
          :lastUserContent?.flatMap(content=>content.type==='text'?[content.text]:[]).join(' ')??'';
        const toolResults=context.messages.filter(message=>message.role==='toolResult').length;
        const batch=toolMode==='batch'||(toolMode==='all'&&(promptText.includes('both')||promptText.includes('all')));
        const background=toolMode==='background'||(toolMode==='all'&&promptText.includes('background'));
        const batchCalls=[
          {type:'toolCall',id:'batch-one-id',name:'s0_fixture',arguments:{path:'batch-one.txt',count:1},thoughtSignature:'batch-one-signature'},
          {type:'toolCall',id:'batch-two-id',name:'s0_fixture_batch',arguments:{path:'batch-two.txt',count:2},thoughtSignature:'batch-two-signature'},
        ];
        const backgroundCall={type:'toolCall',id:'background-fixture-id',name:'bash',arguments:{command:"sleep 2; printf 'background fixture result\\n'",async:true},thoughtSignature:'background-signature'};
        if(pendingUi&&!fs.existsSync(pendingAudit)){
          const call={type:'toolCall',id:'pending-ui-fixture-id',name:'s0_pending_ui',arguments:{},thoughtSignature:'pending-ui-signature'};
          partial.content=[call];stream.push({type:'toolcall_start',contentIndex:0,partial});
          stream.push({type:'toolcall_end',contentIndex:0,toolCall:call,partial});
          partial.stopReason='toolUse';stream.push({type:'done',reason:'toolUse',message:partial});stream.end();return;
        }
        if(stubborn&&toolResults===0){
          const call={type:'toolCall',id:'stubborn-fixture-id',name:'s0_stubborn',arguments:{},thoughtSignature:'stubborn-signature'};
          partial.content=[call];stream.push({type:'toolcall_start',contentIndex:0,partial});
          stream.push({type:'toolcall_end',contentIndex:0,toolCall:call,partial});
          partial.stopReason='toolUse';stream.push({type:'done',reason:'toolUse',message:partial});stream.end();return;
        }
        const toolCalls=background
          ? [backgroundCall, ...batchCalls]
          : batch
          ? batchCalls
          : toolMode==='reuse'||toolMode==='all'||toolMode==='1'
            ? [{type:'toolCall',id:'reusable-fixture-id',name:'s0_fixture',arguments:{path:'controlled.txt',count:2},thoughtSignature:'controlled-signature'}]
            : [];
        const repeat=toolMode==='all'&&toolResults===3;
        if(toolCalls.length>0&&(toolResults===0||repeat)){
          partial.content=toolCalls;
          for(const [contentIndex,toolCall] of toolCalls.entries()){
            stream.push({type:'toolcall_start',contentIndex,partial});
            stream.push({type:'toolcall_delta',contentIndex,delta:'{}',partial});
            stream.push({type:'toolcall_end',contentIndex,toolCall,partial});
          }
          partial.stopReason='toolUse';stream.push({type:'done',reason:'toolUse',message:partial});stream.end();return;
        }
        partial.content=[{type:'text',text:''}];stream.push({type:'text_start',contentIndex:0,partial});
        if(process.env.OMP_LIVE_FIXTURE_BURST==='1')for(let i=0;i<4500;i++){const delta=Bun.SHA256.hash(String(i),'hex').slice(0,6)+' ';partial.content[0].text+=delta;
          stream.push({type:'text_delta',contentIndex:0,delta,partial:{...partial,content:partial.content.map(block=>({...block}))}});if(i%20===0)await Bun.sleep(0);}
        const slowStream=fs.existsSync(path.join(profile,'slow-stream'));
        const pause=slowStream?Number(process.env.OMP_LIVE_FIXTURE_DELAY_MS??80):80;
        for(const [index,delta] of ['authoritative ','controlled ','final'].entries()) {
          if(options?.signal?.aborted) break;
          partial.content[0].text+=delta;
          stream.push({type:'text_delta',contentIndex:0,delta,partial});
          if(calls>1&&index===1&&seed)pi.appendEntry('s0-append-during-prefix',{controlled:true});
          // The delay models a streaming turn of the configured length; exempting the first
          // call made it a ~240ms turn, too fast for a busy refusal plus Stop to reach it.
          await Bun.sleep(pause);
        }
        if(process.env.OMP_LIVE_FIXTURE_BURST!=='1')partial.content[0].text='authoritative controlled final';
        stream.push({type:'text_end',contentIndex:0,content:partial.content[0].text,partial});
        partial.stopReason=options?.signal?.aborted?'aborted':'stop';
        stream.push({type:'done',reason:partial.stopReason,message:partial});stream.end();
      })().catch(error=>{stream.push({type:'error',reason:'error',error:{...partial,stopReason:'error',errorMessage:String(error)}});stream.end();});
      return stream;
    },
  });
  if(process.env.OMP_LIVE_FIXTURE_SCENARIO==='rewind'){
    pi.registerTool({name:'checkpoint',label:'Controlled checkpoint',description:'Controlled native checkpoint result',
      parameters:schemaType({goal:'string'}),async execute(){return {content:[{type:'text',text:'controlled checkpoint'}],details:{startedAt:'2026-01-01T00:00:00.000Z'}};}});
    pi.registerTool({name:'rewind',label:'Controlled rewind',description:'Controlled native rewind result',
      parameters:schemaType({report:'string'}),async execute(_id,params){return {content:[{type:'text',text:'rewind requested'}],details:{report:params.report,rewound:true}};}});
  }
  if(process.env.OMP_LIVE_FIXTURE_SCENARIO==='retry-tool')pi.registerTool({name:'s0_retry_tool',
    label:'Controlled retry tool',description:'Synthetic slow tool that records every execution for retry replay',
    parameters:schemaType({}),
    async execute(_id,_params,signal){
      const audit=path.join(profile,'retry-tool-audit.json');
      let executions=0;
      try{executions=Number(JSON.parse(fs.readFileSync(audit,'utf8')).executions??0)}catch{}
      fs.writeFileSync(audit,JSON.stringify({stage:'running',executions:executions+1}));
      await Bun.sleep(1500);
      if(signal?.aborted){fs.writeFileSync(audit,JSON.stringify({stage:'aborted',executions:executions+1}));
        throw Error('synthetic retry tool aborted');}
      fs.writeFileSync(audit,JSON.stringify({stage:'completed',executions:executions+1}));
      return {content:[{type:'text',text:'controlled retry tool result'}]};
    }});
  if(pendingUi)pi.registerTool({name:'s0_pending_ui',label:'Controlled pending UI',
    description:'Synthetic pending native question for Stop cancellation',parameters:schemaType({}),
    async execute(_id,_params,_signal,_onUpdate,ctx){
      const audit=pendingAudit;
      fs.writeFileSync(audit,JSON.stringify({stage:'awaiting'}));
      try{
        const answer=await ctx.ui.askDialog([{id:'decision',question:'Stop this question?',options:[{label:'Allow'},{label:'Deny'}]}]);
        fs.writeFileSync(audit,JSON.stringify({answer:answer===undefined?'cancelled':'answered'}));
        return {content:[{type:'text',text:answer===undefined?'question cancelled':'question answered'}]};
      }catch(error){
        fs.writeFileSync(audit,JSON.stringify({error:String(error)}));
        throw error;
      }
    }});
  if(stubborn)pi.registerTool({name:'s0_stubborn',label:'Controlled uncooperative tool',
    description:'Synthetic busy proof that ignores abort and SIGTERM',parameters:schemaType({}),
    async execute(){setInterval(()=>{},1000);await new Promise(()=>{});return {content:[]};}});
  pi.registerTool({name:'s0_fixture',label:'Controlled tool',description:'Deterministic fixture tool',
    parameters:schemaType({}),async execute(){return {content:[{type:'text',text:'controlled result'}]}}});
  pi.registerTool({name:'s0_fixture_batch',label:'Controlled batch tool',description:'Deterministic batch fixture tool',
    parameters:schemaType({}),async execute(){return {content:[{type:'text',text:'controlled batch result'}]}}});
}
