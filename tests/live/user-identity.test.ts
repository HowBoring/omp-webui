/** Public projection contract: a native prompt's durable identity is the stock user rpcId. */
import {test,expect} from 'bun:test';
import {settledHistoryRecords} from '../../packages/projection/history-records.ts';
import type {HistoryItem} from '../../packages/contracts/generated/omp-wire.ts';

const user=(submission?: HistoryItem['submission']):HistoryItem=>({id:'entry-1',parentId:null,kind:'message',
  active:false,text:'hello',role:'user',timestamp:'2023-11-14T22:13:20.123Z',...(submission?{submission}:{})});

test('a durable native user row carries its submission causality as the stock rpcId',()=>{
  const records=settledHistoryRecords(user({origin:{sourceId:'source',instanceId:'instance',
    nativeSessionId:'native',clientSubmissionId:'request-7'},role:'input'}),'entry-1',10,{turn:0,step:0});
  expect(records.map(record=>record.event.type)).toEqual(['turn/start','user/message']);
  expect(records[1]!.event.data).toMatchObject({role:'user',source:{kind:'user',rpcId:'request-7'}});
  // The row keeps the native clock so the Client can order it against the echo it retires.
  expect(records[1]!.event.time).toBe(1_700_000_000_123);
});

test('a native prompt without submission causality never invents an identity',()=>{
  const records=settledHistoryRecords(user(),'entry-1',10,{turn:0,step:0});
  expect(records[1]!.event.data).toMatchObject({source:{kind:'user'}});
  expect(records[1]!.event.data).not.toHaveProperty('source.rpcId');
});
