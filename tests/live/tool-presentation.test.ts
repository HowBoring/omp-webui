/** Native history presentation: actual arguments, usage, signatures, pairing and honest special records. */
import {test,expect} from 'bun:test';
import type {HistoryItem} from '../../packages/contracts/generated/omp-wire.ts';
import {historyMessage,ToolCallLedger,settledCoordinates} from '../../packages/projection/history-records.ts';

const collect=(item:HistoryItem,id='entry',ledger?:ToolCallLedger)=>{
  const records=[] as NonNullable<ReturnType<typeof historyMessage>>[];
  historyMessage(item,id,{turn:2,step:3},(type,data,surface,time)=>{
    const record={type:'event',event:{type,seq:records.length,time:time??0,data,...(surface?{surfaceOp:'append'}:{ignorable:true})}} as NonNullable<ReturnType<typeof historyMessage>>;
    records.push(record);return record;
  },false,ledger);
  return records;
};

test('assistant keeps reasoning, real usage, parsed arguments and thought signature',()=>{
  const records=collect({id:'a',active:true,parentId:'u',kind:'message',role:'assistant',text:'done',provider:'p',model:'m',
    reasoning:'think',stopReason:'stop',usage:{inputTokens:11,outputTokens:22,totalTokens:33,cacheReadTokens:4,reasoningTokens:5},
    toolCalls:[{callId:'call-1',name:'s0_fixture',arguments:{path:'a.txt',count:2},thoughtSignature:'sig-1'}]});
  expect(records.map(r=>r.event.type)).toEqual(['step/start','assistant/message','tool/parsed-call','step/end','turn/end']);
  expect(records[1]!.event.data).toMatchObject({usage:{inputTokens:11,outputTokens:22,totalTokens:33,cacheReadTokens:4,reasoningTokens:5},
    message:{content:[{type:'reasoning',text:'think'},{type:'text',text:'done'}]}});
  expect(records[2]!.event.data).toEqual({turn:2,step:3,callId:'call-1',name:'s0_fixture',arguments:{path:'a.txt',count:2},thoughtSignature:'sig-1'});
  expect(records[4]!.event.data).toEqual({turn:2,reason:{kind:'completed'}});
  expect(settledCoordinates('assistant',{turn:2,step:3},1).length).toBe(4);
});

test('interrupted assistant remains typed and carries no invented content',()=>{
  const records=collect({id:'a',active:true,parentId:'u',kind:'message',role:'assistant',text:'',provider:'p',model:'m',stopReason:'aborted'});
  expect(records[1]!.event.data).toMatchObject({interrupted:true,message:{content:[{type:'text',text:''}]}});
  expect(records.at(-1)!.event).toMatchObject({type:'turn/end',data:{turn:2,reason:{kind:'aborted',reason:{kind:'user'}}}});
});

test('native terminal stop reasons close the turn with the matching stock reason',()=>{
  const reason=(stopReason:string,extra:Partial<HistoryItem>={})=>{
    const records=collect({id:'a',active:true,parentId:'u',kind:'message',role:'assistant',text:'x',provider:'p',model:'m',
      stopReason,...extra});
    return records.at(-1)!.event;
  };
  expect(reason('length')).toMatchObject({type:'turn/end',data:{turn:2,reason:{kind:'max-tokens'}}});
  expect(reason('error',{error:{reason:'quota exhausted',code:429,status:429}})).toMatchObject({type:'turn/end',
    data:{turn:2,reason:{kind:'error',error:{message:'quota exhausted',code:'RATE_LIMIT',status:429}}}});
  expect(reason('error',{error:{reason:'upstream',status:503}})).toMatchObject({type:'turn/end',
    data:{reason:{kind:'error',error:{message:'upstream',code:'SERVER',status:503}}}});
  expect(reason('error',{error:{reason:'slow',code:0x0004_0000}})).toMatchObject({type:'turn/end',
    data:{reason:{kind:'error',error:{code:'TIMEOUT'}}}});
  expect(reason('error')).toMatchObject({type:'turn/end',data:{reason:{kind:'error',error:{code:'UNKNOWN'}}}});
  expect(reason('toolUse')).toMatchObject({type:'step/end'});
  expect(reason('unknown-native')).toMatchObject({type:'step/end'});
});

test('a terminal provider failure emits the invisible attempt the stock retry gate reads',()=>{
  const records=collect({id:'a',active:true,parentId:'u',kind:'message',role:'assistant',text:'',provider:'p',model:'m',
    stopReason:'error',error:{reason:'upstream',status:503}});
  expect(records.map(r=>r.event.type)).toEqual(['step/start','assistant/attempt','step/end','turn/end']);
  expect(records[1]!.event.ignorable).toBe(true);
  expect(records.at(-1)!.event).toMatchObject({data:{turn:2,reason:{kind:'error',error:{code:'SERVER'}}}});
});

test('tool result pairs by native owner and preserves error semantics',()=>{
  const ledger=new ToolCallLedger();
  collect({id:'a',active:true,parentId:'u',kind:'message',role:'assistant',text:'',provider:'p',model:'m',
    toolCalls:[{callId:'call-1',name:'s0_fixture',arguments:{}}]},'a',ledger);
  const result=collect({id:'r',active:true,parentId:'a',kind:'message',role:'toolResult',text:'failed',toolCallId:'call-1',toolName:'s0_fixture',
    isError:true,error:{reason:'denied',code:403}},'r',ledger);
  expect(result[0]!.event.type).toBe('tool/result');
  expect(result[0]!.event.data).toMatchObject({message:{role:'tool',toolCallId:'call-1',content:[{type:'text',text:'failed'}],isError:true},
    error:{name:'s0_fixture',code:"403",reason:'denied'}});
});

test('reused call id cannot silently change native owner',()=>{
  const ledger=new ToolCallLedger();
  collect({id:'a',active:true,parentId:'u',kind:'message',role:'assistant',text:'',provider:'p',model:'m',
    toolCalls:[{callId:'reused',name:'s0_fixture',arguments:{}}]},'a',ledger);
  expect(()=>collect({id:'b',active:true,parentId:'u',kind:'message',role:'assistant',text:'',provider:'p',model:'m',
    toolCalls:[{callId:'reused',name:'s0_fixture',arguments:{}}]},'b',ledger)).toThrow('live_tool_owner_unavailable');
  expect(()=>ledger.result('reused','b')).not.toThrow();
  expect(()=>ledger.result('reused','a')).toThrow('live_tool_owner_unavailable');
});

test('special records are surface-typed, safe and honest about unavailable payloads',()=>{
  const file=collect({id:'f',active:true,parentId:'u',kind:'fileMention',role:'fileMention',text:'[File mention: a.txt]\nbody',
    files:[{path:'a.txt',available:true,hasImage:false,byteSize:4}]})[0];
  expect(file!.event).toMatchObject({type:'user/message',surfaceOp:'append',
    data:{role:'user',content:[{type:'text',text:'[File mention: a.txt]\nbody\n[file] a.txt'}]}});
  const messageKind=collect({id:'f',active:true,parentId:'u',kind:'message',role:'fileMention',text:'[File mention: a.txt]\nbody',
    files:[{path:'a.txt',available:true,hasImage:false,byteSize:4}]})[0];
  expect(messageKind!.event).toMatchObject({type:'user/message',data:{content:[{type:'text',text:'[File mention: a.txt]\nbody\n[file] a.txt'}]}});
  const mentioned=collect({id:'fm',active:true,parentId:'u',kind:'message',role:'fileMention',text:'[File mention: a.txt]',files:[{path:'a.txt',available:true,hasImage:false,byteSize:4}]})[0];
  expect(mentioned!.event.data).toMatchObject({role:'user',content:[{type:'text',text:'[File mention: a.txt]\n[file] a.txt'}]});
  const internal=collect({id:'c',active:true,parentId:'u',kind:'custom_message',role:'custom',text:'[Internal custom message]'},'c');
  expect(internal[0]!.event.data).toEqual({id:'c',role:'user',source:{kind:'user'},content:[{type:'text',text:'[Internal custom message]'}]});
  const missing=collect({id:'m',active:true,parentId:'u',kind:'message',role:'assistant',text:'',provider:'p',model:'m',unavailable:true,truncated:true});
  expect(missing[1]!.event.type).toBe('assistant/message');
  expect(collect({id:'t',active:true,parentId:'u',kind:'message',role:'toolResult',text:'[Native payload unavailable]',
    toolCallId:'call-x',unavailable:true,truncated:true})[0]!.event.data).toMatchObject({message:{content:[{type:'text',text:'[Native payload unavailable]'}]}});
});

test('unknown native kinds and roles are blocked rather than stringified',()=>{
  expect(()=>collect({id:'x',active:true,parentId:null,kind:'provider_payload',role:'assistant',text:'secret',provider:'p',model:'m'})).not.toThrow();
  expect(()=>collect({id:'x',active:true,parentId:null,kind:'provider_payload',role:'developer',text:'secret'})).toThrow('live_native_record_unsupported');
  expect(()=>collect({id:'x',active:true,parentId:null,kind:'custom_message',role:'system',text:'secret'})).toThrow('live_native_record_unsupported');
});

test('structural native entries stay typed and never expose credential or config state',()=>{
  // Selection, usage and credential bookkeeping carry no conversation text: they are explicitly omitted.
  expect(collect({id:'s',active:true,parentId:null,kind:'credential_pin',text:'[Native structural record]'},'s')).toEqual([]);
  // A native `custom` entry is bookkeeping too; a role-bearing custom message is a visible row.
  expect(collect({id:'k',active:true,parentId:'u',kind:'custom',text:'[Native structural record]'},'k')).toEqual([]);
  expect(collect({id:'k',active:true,parentId:'u',kind:'custom',role:'custom',text:'kept'},'k')).toHaveLength(1);
  // A record the native side marked hidden stays hidden.
  expect(collect({id:'c',active:true,parentId:'u',kind:'custom_message',text:'[Internal custom message]',display:false},'c')).toEqual([]);
  // Unknown non-ignorable kinds are a typed compatibility failure, never a silent or stringified row.
  expect(()=>collect({id:'u',active:true,parentId:null,kind:'provider_payload',text:'secret'})).toThrow('live_native_record_unsupported');
});

test('every record carries the native timestamp instead of the epoch',()=>{
  const timestamp='2026-11-22T21:18:31.078Z',time=Date.parse(timestamp);
  const records=collect({id:'a',active:true,parentId:'u',kind:'message',role:'assistant',text:'done',provider:'p',model:'m',
    stopReason:'stop',timestamp,toolCalls:[{callId:'call-1',name:'s0_fixture',arguments:{}}]});
  expect(records.map(record=>record.event.time)).toEqual(records.map(()=>time));
  expect(collect({id:'u',active:true,parentId:null,kind:'message',role:'user',text:'hi',timestamp})
    .map(record=>record.event.time)).toEqual([time,time]);
  expect(collect({id:'n',active:true,parentId:null,kind:'message',role:'user',text:'hi'})[0]!.event.time).toBe(0);
});
