/** Native history presentation: actual arguments, usage, signatures, pairing and honest special records. */
import {test,expect} from 'bun:test';
import type {HistoryItem} from '../../packages/contracts/generated/omp-wire.ts';
import {historyMessage,ToolCallLedger,settledCoordinates} from '../../packages/projection/history-records.ts';

const collect=(item:HistoryItem,id='entry',ledger?:ToolCallLedger)=>{
  const records=[] as ReturnType<typeof historyMessage>[];
  historyMessage(item,id,{turn:2,step:3},(type,data,surface)=>{
    const record={type:'event',event:{type,seq:records.length,time:0,data,...(surface?{surfaceOp:'append'}:{ignorable:true})}} as ReturnType<typeof historyMessage>;
    records.push(record);return record;
  },false,ledger);
  return records;
};

test('assistant keeps reasoning, real usage, parsed arguments and thought signature',()=>{
  const records=collect({id:'a',active:true,parentId:'u',kind:'message',role:'assistant',text:'done',provider:'p',model:'m',
    reasoning:'think',stopReason:'stop',usage:{inputTokens:11,outputTokens:22,totalTokens:33,cacheReadTokens:4,reasoningTokens:5},
    toolCalls:[{callId:'call-1',name:'s0_fixture',arguments:{path:'a.txt',count:2},thoughtSignature:'sig-1'}]});
  expect(records.map(r=>r.event.type)).toEqual(['step/start','assistant/message','tool/parsed-call','step/end']);
  expect(records[1]!.event.data).toMatchObject({usage:{inputTokens:11,outputTokens:22,totalTokens:33,cacheReadTokens:4,reasoningTokens:5},
    message:{content:[{type:'reasoning',text:'think'},{type:'text',text:'done'}]}});
  expect(records[2]!.event.data).toEqual({turn:2,step:3,callId:'call-1',name:'s0_fixture',arguments:{path:'a.txt',count:2},thoughtSignature:'sig-1'});
  expect(settledCoordinates('assistant',{turn:2,step:3},1).length).toBe(4);
});

test('interrupted assistant remains typed and carries no invented content',()=>{
  const records=collect({id:'a',active:true,parentId:'u',kind:'message',role:'assistant',text:'',provider:'p',model:'m',stopReason:'aborted'});
  expect(records[1]!.event.data).toMatchObject({interrupted:true,message:{content:[{type:'text',text:''}]}});
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
  expect(file!.event).toMatchObject({type:'omp/native-record',surfaceOp:'append',
    data:{kind:'fileMention',role:'fileMention',files:[{path:'a.txt',available:true,hasImage:false,byteSize:4}]}});
  const internal=collect({id:'c',active:true,parentId:'u',kind:'custom_message',role:'custom',text:'[Internal custom message]',display:false},'c');
  expect(internal[0]!.event.data).toEqual({id:'c',kind:'custom_message',role:'custom',text:'[Internal custom message]',display:false});
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
  const structural=collect({id:'s',active:true,parentId:null,kind:'credential_pin',text:'[Native structural record]'},'s')[0];
  expect(structural!.event.data).toEqual({id:'s',kind:'structural',text:'[Native structural record]'});
  const hidden=collect({id:'c',active:true,parentId:'u',kind:'custom_message',text:'[Internal custom message]',display:false},'c')[0];
  expect(hidden!.event.data).toEqual({id:'c',kind:'custom_message',text:'[Internal custom message]',display:false});
});
