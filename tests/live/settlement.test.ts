/** Actual native RPC plus public DSH derived journal/assistant contract. Controlled provider only. */
import {test,expect} from 'bun:test';
import type {SessionFollowFrame} from '@deepseek-ai/dsh-api-session-controller/types';
import {SessionSeq} from '@deepseek-ai/dsh-session/types';
import {openLiveFixture} from '../../compatibility/omp/fixtures/live-worker.ts';
import {LiveJournal} from '../../packages/projection/live-journal.ts';
for(const scenario of ['refusal','empty-error','empty-overflow','transform','handled'] as const){
  test(`native ${scenario} produces one legal DSH final or explicit abandonment`,async()=>{
    const fixture=await openLiveFixture(true,{scenario});
    try {
      const journal=await LiveJournal.open(fixture.transport.history),before=journal.cursor;
      const frames:SessionFollowFrame[]=[];journal.subscribe(frame=>frames.push(frame));
      await fixture.transport.prompt();
      let invalidated=false;
      for(let attempt=0;attempt<160;attempt++){
        try{
          journal.accept(await fixture.transport.history.poll(journal.opened.cut.workerId,journal.after));
          if((await fixture.transport.state()).isSettled){
            journal.accept(await fixture.transport.history.poll(journal.opened.cut.workerId,journal.after));break;
          }
        }catch(error){if(scenario!=='empty-overflow')throw error;expect(journal.failure).toBe('live_projection_invalidated');invalidated=true;break;}
        if(attempt===159)throw Error('fixture_settlement_timeout');await Bun.sleep(25);
      }
      if(invalidated){expect(()=>journal.snapshot()).toThrow('live_projection_invalidated');return;}
      const records=(await journal.page({maxMessages:128})).records;
      expect(records.map(record=>record.event.seq)).toEqual(Array.from({length:records.length},(_,index)=>journal.cursor-records.length+1+index));
      // Native events are stamped in epoch milliseconds, not the ISO string the wire type declares.
      for(const record of records) if(record.event.type==='user/message'||record.event.type==='assistant/message') expect(record.event.time).toBeGreaterThan(0);
      expect(journal.snapshot().assistantStream?.activeAttempt).toBeUndefined();
      const assistant=records.filter(record=>record.event.type==='assistant/message');
      expect(assistant).toHaveLength(scenario==='transform'?2:1);
      const attempts=records.filter(record=>record.event.type==='assistant/attempt');
      expect(attempts).toHaveLength(['refusal','empty-error','empty-overflow'].includes(scenario)?1:0);
      const ends=frames.flatMap(frame=>frame.type==='assistant-stream'&&frame.frame.type==='end'?[frame.frame]:[]);
      if(scenario==='handled'){expect(journal.cursor).toBe(before);expect(ends).toHaveLength(0);}
      else {
        expect(ends.at(-1)?.outcome.kind).toBe(['refusal','empty-overflow'].includes(scenario)?'abandoned':'committed');
        const end=records.filter(record=>record.event.type==='turn/end').at(-1);
        expect(end).toBeDefined();
        const terminal=['refusal','empty-error','empty-overflow'].includes(scenario)?'error':'completed';
        expect(end?.event.data).toMatchObject({reason:{kind:terminal}});
      }
    }finally{await fixture.close();}
  },20000);
}

test('a settled retryable failure keeps Continue and /retry clears it without repeating the user',async()=>{
  const fixture=await openLiveFixture(false,{scenario:'retry'});
  try{
    const journal=await LiveJournal.open(fixture.transport.history);
    await fixture.transport.prompt();
    for(let attempt=0;attempt<400;attempt++){
      journal.accept(await fixture.transport.history.poll(journal.opened.cut.workerId,journal.after));
      if(journal.continuation!==null)break;
      if(attempt===399)throw Error('fixture_failed_turn_timeout');await Bun.sleep(25);
    }
    const first=(await journal.page({maxMessages:128})).records;
    const failedEnd=first.filter(record=>record.event.type==='turn/end').at(-1);
    expect(failedEnd?.event.data).toMatchObject({reason:{kind:'error',error:{code:'SERVER'}}});
    expect(journal.continuation).toBe(SessionSeq(failedEnd!.event.seq));
    expect(first.filter(record=>record.event.type==='assistant/message')).toHaveLength(0);
    expect(first.filter(record=>record.event.type==='assistant/attempt')).toHaveLength(1);
    const data=(record:{event:{data:unknown}})=>record.event.data as {source?:{kind?:string};content?:unknown[]};
    expect(first.filter(record=>record.event.type==='user/message'
      && record.event.surfaceOp==='append'&&data(record).source?.kind==='user')).toHaveLength(1);

    await fixture.transport.retry();
    let invalidated=false;
    for(let attempt=0;attempt<400;attempt++){
      try{journal.accept(await fixture.transport.history.poll(journal.opened.cut.workerId,journal.after));}
      catch(error){if(!String(error).includes('live_projection_invalidated'))throw error;invalidated=true;break;}
      await Bun.sleep(25);
    }
    expect(invalidated).toBe(true);
    const reborn=await LiveJournal.open(fixture.transport.history);
    for(let attempt=0;attempt<400;attempt++){
      reborn.accept(await fixture.transport.history.poll(reborn.opened.cut.workerId,reborn.after));
      if((await fixture.transport.state()).isSettled)reborn.settle();
      const records=(await reborn.page({maxMessages:128})).records;
      if(reborn.continuation===null
        &&records.some(record=>record.event.type==='assistant/message')
        &&records.filter(record=>record.event.type==='turn/end').at(-1)?.event.data
          &&(records.filter(record=>record.event.type==='turn/end').at(-1)!.event.data as {reason?:{kind?:string}}).reason?.kind==='completed')break;
      if(attempt===399)throw Error('fixture_retry_timeout');await Bun.sleep(25);
    }
    const records=(await reborn.page({maxMessages:128})).records;
    expect(records.filter(record=>record.event.type==='user/message'
      && record.event.surfaceOp==='append'&&data(record).source?.kind==='user')).toHaveLength(1);
    expect(records.filter(record=>record.event.type==='user/message'
      && data(record).source?.kind==='retry'&&data(record).content?.length===0)).toHaveLength(1);
    expect(records.filter(record=>record.event.type==='assistant/message').length).toBeGreaterThanOrEqual(1);
    const lastEnd=records.filter(record=>record.event.type==='turn/end').at(-1);
    expect(lastEnd?.event.data).toMatchObject({reason:{kind:'completed'}});
    expect(reborn.continuation).toBeNull();
  }finally{await fixture.close();}
},30000);

test('native reasoning stays a typed block and never folds into visible text',async()=>{
  const fixture=await openLiveFixture(false,{scenario:'reasoning'});
  try {
    const journal=await LiveJournal.open(fixture.transport.history);
    await fixture.transport.prompt();
    for(let attempt=0;attempt<200;attempt++){
      journal.accept(await fixture.transport.history.poll(journal.opened.cut.workerId,journal.after));
      if((await fixture.transport.state()).isSettled){
        journal.accept(await fixture.transport.history.poll(journal.opened.cut.workerId,journal.after));break;
      }
      if(attempt===199)throw Error('fixture_reasoning_timeout');await Bun.sleep(25);
    }
    const records=(await journal.page({maxMessages:128})).records;
    const assistant=records.filter(record=>record.event.type==='assistant/message').at(-1)?.event.data;
    expect(assistant).toMatchObject({message:{content:[
      {type:'reasoning',text:'controlled reason'},
      {type:'text',text:'authoritative controlled final'},
    ]}});
    expect(JSON.stringify(assistant)).not.toContain('[Thinking]');
  }finally{await fixture.close();}
},20000);

test('genuine native rewind invalidates the old DSH generation before accepting another branch',async()=>{
  const fixture=await openLiveFixture(true,{scenario:'rewind'});
  try {
    const journal=await LiveJournal.open(fixture.transport.history);await fixture.transport.prompt();
    let failure:string|undefined;
    for(let attempt=0;attempt<200;attempt++){
      try{journal.accept(await fixture.transport.history.poll(journal.opened.cut.workerId,journal.after));}
      catch(error){failure=error instanceof Error?error.message:String(error);break;}
      await Bun.sleep(25);
    }
    expect(failure).toMatch(/^live_(context_changed|projection_invalidated)$/);
    expect(()=>journal.snapshot()).toThrow(failure);
  }finally{await fixture.close();}
},20000);

test('a committed user message keeps its turn open until the assistant settles',async()=>{
  const fixture=await openLiveFixture(true);
  try {
    const journal=await LiveJournal.open(fixture.transport.history);
    await fixture.transport.prompt();
    for(let attempt=0;attempt<160;attempt++){
      journal.accept(await fixture.transport.history.poll(journal.opened.cut.workerId,journal.after));
      if((await fixture.transport.state()).isSettled)break;
      if(attempt===159)throw Error('fixture_settlement_timeout');await Bun.sleep(25);
    }
    // Native's idle flag leads the observation cursor: drain what Native already recorded before
    // asserting the settled turn's shape.
    for(let attempt=0;attempt<40;attempt++){
      const poll=await fixture.transport.history.poll(journal.opened.cut.workerId,journal.after);
      journal.accept(poll);
      if(poll.events.length===0)break;
      if(attempt===39)throw Error('fixture_drain_timeout');
    }
    const records=(await journal.page({maxMessages:128})).records;
    const types=records.map(record=>record.event.type);
    for(let index=0;index<types.length;index++){
      if(types[index]!=='turn/end')continue;
      const open=types.lastIndexOf('turn/start',index);
      expect(types.slice(open,index)).toContain('assistant/message');
    }
    const user=types.lastIndexOf('user/message');
    expect(types.indexOf('turn/end',user)).toBeGreaterThan(types.lastIndexOf('assistant/message'));
  } finally { await fixture.close(); }
},20000);
