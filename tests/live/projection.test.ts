/** Public native RPC plus derived DSH page contracts; controlled provider, never real AI. */
import {test,expect} from 'bun:test';
import {openLiveFixture} from '../../compatibility/omp/fixtures/live-worker.ts';
import type {SessionFollowFrame} from '@deepseek-ai/dsh-api-session-controller/types';
import {LiveJournal} from '../../packages/projection/live-journal.ts';

test('derived pages keep exact inclusive cuts and exclusive backward bounds across observed appends',async()=>{
  const fixture=await openLiveFixture();
  try {
    const journal=await LiveJournal.open(fixture.transport.history);
    const cut=journal.cursor,original=journal.page({throughSeq:cut,maxMessages:128});
    const frames:SessionFollowFrame[]=[];journal.subscribe(frame=>frames.push(frame));
    await fixture.transport.prompt();
    for(let i=0;i<160;i++){
      journal.accept(await fixture.transport.history.poll(journal.opened.cut.workerId,journal.after));
      if(journal.cursor>cut&&journal.page({maxMessages:1}).records.at(-1)?.event.type==='step/end')break;
      await Bun.sleep(25);
    }
    expect(journal.page({throughSeq:cut,maxMessages:128})).toEqual(original);
    const all=journal.page({throughSeq:journal.cursor,maxMessages:128});
    expect(all.records.map(record=>record.event.seq)).toEqual(Array.from({length:journal.cursor+1},(_,i)=>i));
    const tail=journal.page({throughSeq:cut,maxMessages:1});
    const before=tail.records[0]?.event.seq;if(before===undefined)throw Error('missing_page');
    const previous=journal.page({throughSeq:cut,beforeSeq:before,maxMessages:128});
    expect([...previous.records,...tail.records]).toEqual([...original.records]);
    expect(journal.snapshot().assistantStream).toEqual({revision:expect.any(Number)});
    // A generation-scoped follower drops any live frame it cannot bind to its opening projection.
    expect(frames.length).toBeGreaterThan(0);
    for(const frame of frames) expect(frame.projection).toEqual(journal.projection);
    const liveFrames=frames.filter((frame):frame is Extract<SessionFollowFrame,{type:'assistant-stream'}>=>
      frame.type==='assistant-stream');
    expect(liveFrames.map(frame=>frame.frame.revision)).toEqual(liveFrames.map((_,i)=>i+1));
    expect(liveFrames.at(-1)?.frame.type).toBe('end');
    expect(()=>journal.page({throughSeq:journal.cursor+1})).toThrow('live_stale_page');
    const stale=await fixture.transport.history.poll(journal.opened.cut.workerId,journal.opened.cut.observationSeq);
    expect(()=>journal.accept(stale)).toThrow('live_observation_out_of_order');
    expect(()=>journal.page({throughSeq:cut})).toThrow('live_observation_out_of_order');
  }finally{await fixture.close();}
},20000);
