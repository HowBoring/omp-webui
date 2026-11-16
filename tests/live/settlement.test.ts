/** Actual native RPC plus public DSH derived journal/assistant contract. Controlled provider only. */
import {test,expect} from 'bun:test';
import type {SessionFollowFrame} from '@deepseek-ai/dsh-api-session-controller/types';
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
        try{journal.accept(await fixture.transport.history.poll(journal.opened.cut.workerId,journal.after));}
        catch(error){if(scenario!=='empty-overflow')throw error;expect(journal.failure).toBe('live_projection_invalidated');invalidated=true;break;}
        if((await fixture.transport.state()).isSettled){
          journal.accept(await fixture.transport.history.poll(journal.opened.cut.workerId,journal.after));break;
        }
        if(attempt===159)throw Error('fixture_settlement_timeout');await Bun.sleep(25);
      }
      if(invalidated){expect(()=>journal.snapshot()).toThrow('live_projection_invalidated');return;}
      const records=journal.page({maxMessages:128}).records;
      expect(records.map(record=>record.event.seq)).toEqual(Array.from({length:journal.cursor+1},(_,index)=>index));
      expect(journal.snapshot().assistantStream?.activeAttempt).toBeUndefined();
      const assistant=records.filter(record=>record.event.type==='assistant/message');
      expect(assistant).toHaveLength(['empty-error','transform'].includes(scenario)?2:1);
      const ends=frames.flatMap(frame=>frame.type==='assistant-stream'&&frame.frame.type==='end'?[frame.frame]:[]);
      if(scenario==='handled'){expect(journal.cursor).toBe(before);expect(ends).toHaveLength(0);}
      else expect(ends.at(-1)?.outcome.kind).toBe(['refusal','empty-overflow'].includes(scenario)?'abandoned':'committed');
    }finally{await fixture.close();}
  },20000);
}

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
