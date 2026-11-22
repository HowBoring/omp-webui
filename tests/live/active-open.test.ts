/** Real native CLI RPC with a transport-latency fixture at the public HistoryClient boundary. */
import {test,expect} from 'bun:test';
import type {SessionFollowFrame} from '@deepseek-ai/dsh-api-session-controller/types';
import {HistoryClient} from '../../packages/contracts/generated/history-client.ts';
import {LiveJournal} from '../../packages/projection/live-journal.ts';
import {openLiveFixture} from '../../compatibility/omp/fixtures/live-worker.ts';

test('one derived opening spans sustained prefix and native append progress, then settles the same assistant once',async()=>{
  const fixture=await openLiveFixture(true,{seed:500,delayMs:400});
  try {
    await fixture.transport.prompt();
    for(let i=0;i<100;i++){
      const check=await fixture.transport.history.open('live','live');const page=await fixture.transport.history.page(check.cursor);
      const streaming=page.items.some(item=>item.kind==='running_prefix');await fixture.transport.history.close(check.snapshot);
      if(streaming)break;if(i===99)throw Error('prefix_not_observed');await Bun.sleep(10);
    }
    let opens=0,pages=0;
    const delayed=new HistoryClient(async command=>{
      if(command.type==='history_snapshot_open'){opens++;return fixture.transport.history.open(command.scope,command.handoff);}
      if(command.type==='history_snapshot_page'){pages++;await Bun.sleep(120);return fixture.transport.history.page(command.cursor,command.before);}
      if(command.type==='history_snapshot_close')return fixture.transport.history.close(command.snapshot).then(()=>({closed:true}));
      if(command.type==='history_observation_poll')return fixture.transport.history.poll(command.workerId,command.after);
      throw Error('unexpected_history_command');
    });
    const journal=await LiveJournal.open(delayed);
    const opening=journal.snapshot();
    expect(opens).toBe(1);expect(pages).toBeGreaterThan(3);
    expect(opening.assistantStream?.activeAttempt).toBeDefined();
    expect(opening.assistantStream?.activeAttempt?.nextIndex).toBeGreaterThan(0);
    expect(opening.projections.asOfSeq).toBe(opening.cursor);
    const attempt=opening.assistantStream!.activeAttempt!;
    const frames:SessionFollowFrame[]=[];journal.subscribe(frame=>frames.push(frame));
    for(let i=0;i<160;i++){
      journal.accept(await fixture.transport.history.poll(journal.opened.cut.workerId,journal.after));
      if(journal.snapshot().assistantStream?.activeAttempt===undefined)break;
      await Bun.sleep(15);
    }
    const all=(await journal.page({maxMessages:128})).records;
    const assistants=all.filter(record=>record.event.type==='assistant/message');
    expect(assistants).toHaveLength(2);
    expect(JSON.stringify(assistants.at(-1)?.event.data)).toContain('authoritative controlled final');
    expect(journal.snapshot().assistantStream?.activeAttempt).toBeUndefined();
    const ends=frames.flatMap(frame=>frame.type==='assistant-stream'&&frame.frame.type==='end'?[frame.frame]:[]);
    expect(ends[0]?.attemptId).toBe(attempt.attemptId);
    // Attempt stream records are authored only by LiveJournal.#delta; the JSON type is structural.
    const stream = attempt.stream as unknown as {chunk?: {type?: string; text?: string}}[];
    const deltas=stream.flatMap(record=>record.chunk?.type==='text-delta'&&typeof record.chunk.text==='string'?[record.chunk.text]:[]);
    expect(deltas.length).toBeGreaterThan(1);
    expect(deltas.join('')).toBe('authoritative controlled final');
    expect(opens).toBe(1);
  }finally{await fixture.close();}
},30000);

test('public native abort settles an adopted DSH attempt without replaying execution',async()=>{
  const fixture=await openLiveFixture(true,{delayMs:500});
  try{
    await fixture.transport.prompt();let journal:LiveJournal|undefined;
    for(let attempt=0;attempt<100;attempt++){
      const cut=await fixture.transport.history.open('live','live');
      const prefix=(await fixture.transport.history.page(cut.cursor)).items.some(item=>item.kind==='running_prefix');
      await fixture.transport.history.close(cut.snapshot);
      if(prefix){journal=await LiveJournal.open(fixture.transport.history);break;}await Bun.sleep(10);
    }
    if(!journal)throw Error('fixture_prefix_timeout');
    const frames:SessionFollowFrame[]=[];journal.subscribe(frame=>frames.push(frame));await fixture.transport.stop();
    for(let attempt=0;attempt<100;attempt++){
      journal.accept(await fixture.transport.history.poll(journal.opened.cut.workerId,journal.after));
      if(!journal.snapshot().assistantStream?.activeAttempt)break;await Bun.sleep(25);
    }
    expect(journal.snapshot().assistantStream?.activeAttempt).toBeUndefined();
    expect(frames.some(frame=>frame.type==='assistant-stream'&&frame.frame.type==='end')).toBe(true);
    const records=(await journal.page({maxMessages:128})).records;
    expect(records.at(-1)?.event).toMatchObject({type:'turn/end',data:{reason:{kind:'aborted',reason:{kind:'user'}}}});
    expect(records.filter(record=>record.event.type==='assistant/message').at(-1)?.event.data)
      .toMatchObject({interrupted:true});
    expect((await fixture.transport.state()).isSettled).toBe(true);
  }finally{await fixture.close();}
},20000);
