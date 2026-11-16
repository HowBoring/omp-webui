/** Matched actual OMP CLI rpc-ui, legitimate provider extension; controlled model boundary, never real AI. */
import {test,expect} from 'bun:test';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {LiveTransport} from '../../../packages/compatibility/live-transport.ts';
import {openLiveFixture} from './live-worker.ts';
test('actual CLI public wire carries controlled final, exact entries and not-attested settlements',async()=>{
  const fixture=await openLiveFixture();const {transport,profile}=fixture;
  try {
    const initial=await transport.history.open('active');expect(initial.cut.durability).toBe('not_attested');
    await transport.prompt();
    let poll,events=[],after=initial.cut.observationSeq;
    for(let i=0;i<100;i++){
      poll=await transport.history.poll(initial.cut.workerId,after);events.push(...poll.events);after=poll.through;
      if(events.filter(e=>e.kind==='message_settlement'&&e.item.role==='assistant').length)break;
      await Bun.sleep(25);
    }
    const assistant=events.find(e=>e.kind==='message_settlement'&&e.item.role==='assistant');
    expect(assistant.item.text).toBe('authoritative controlled final');
    expect(assistant.settlement.status).toBe('observed');expect(assistant.settlement.durability).toBe('not_attested');
    await transport.history.close(initial.snapshot);
    const opened=await transport.history.open('active');const page=await transport.history.page(opened.cursor);
    const entry=page.items.find(item=>item.entryId===assistant.settlement.entryId);
    expect(entry.live).toEqual(assistant.live);expect(entry.text).toBe(assistant.item.text);
    expect(JSON.parse(await fs.readFile(path.join(profile,'controlled-provider.json'),'utf8')).realProviderInference).toBe(false);
  }finally{await fixture.close();}
},20000);

test('genuine controlled tool execution reuses raw IDs while retaining exact initiating assistant and native entries',async()=>{
  const fixture=await openLiveFixture(true,{tools:true});const {transport}=fixture;
  try {
    const opened=await transport.history.open('active');await transport.prompt();
    const events=[];let after=opened.cut.observationSeq;
    for(let i=0;i<160;i++){
      const poll=await transport.history.poll(opened.cut.workerId,after);events.push(...poll.events);after=poll.through;
      if(events.some(e=>e.kind==='message_settlement'&&e.item.role==='assistant'&&e.item.stopReason==='stop'))break;
      await Bun.sleep(25);
    }
    const call=events.find(e=>e.kind==='message_final'&&e.item.role==='assistant'&&e.item.stopReason==='toolUse');
    const tool=events.find(e=>e.kind==='message_settlement'&&e.item.role==='toolResult');
    expect(tool.item.text).toBe('controlled result');
    expect(tool.live.toolOwnerMessageId).toBe(call.live.messageId);
    expect(tool.live.contextId).toBe(call.live.contextId);
    expect(tool.settlement.status).toBe('observed');
    await transport.history.close(opened.snapshot);const next=await transport.history.open('tree');
    const rows=(await transport.history.page(next.cursor)).items;
    expect(rows.find(row=>row.id===tool.settlement.entryId).live).toEqual(tool.live);
    expect(rows.filter(row=>row.toolCallId==='reusable-fixture-id')).toHaveLength(2);
    await transport.history.close(next.snapshot);
  }finally{await fixture.close();}
},20000);

test('actual native filtered stream overflow reports a public observation gap',async()=>{
  const fixture=await openLiveFixture(false,{burst:true});
  try {
    const opened=await fixture.transport.history.open('active');await fixture.transport.filter();await fixture.transport.prompt();
    for(let i=0;i<400;i++){if((await fixture.transport.state()).isSettled)break;await Bun.sleep(25);}
    await expect(fixture.transport.history.poll(opened.cut.workerId,opened.cut.observationSeq)).rejects.toThrow('history_observation_gap');
  }finally{await fixture.close();}
},20000);

test('real terminal empty-error recovery settles the original live attempt to the actual later native entry once',async()=>{
  const fixture=await openLiveFixture(true,{scenario:'empty-error'});
  try {
    const opened=await fixture.transport.history.open('active');await fixture.transport.prompt();
    for(let i=0;i<160;i++){if((await fixture.transport.state()).isSettled)break;await Bun.sleep(25);}
    let after=opened.cut.observationSeq,more=true;const events=[];
    while(more){const poll=await fixture.transport.history.poll(opened.cut.workerId,after);events.push(...poll.events);after=poll.through;more=poll.hasMore;}
    const final=events.filter(event=>event.kind==='message_settlement'&&event.item?.role==='assistant');
    expect(final).toHaveLength(1);expect(final[0].settlement.status).toBe('observed');
    await fixture.transport.history.close(opened.snapshot);
    const next=await fixture.transport.history.open('active');const rows=(await fixture.transport.history.page(next.cursor)).items;
    expect(rows.find(item=>item.id===final[0].settlement.entryId).live).toEqual(final[0].live);
    expect(final[0].item.text).toContain('synthetic non-retryable terminal error');
  }finally{await fixture.close();}
},20000);

for(const scenario of ['refusal','empty-overflow'])test(`actual native ${scenario} finishes with exact no-entry after real AgentSession maintenance`,async()=>{
  const fixture=await openLiveFixture(true,{scenario});
  try {
    const opened=await fixture.transport.history.open('active');await fixture.transport.prompt();
    for(let i=0;i<160;i++){if((await fixture.transport.state()).isSettled)break;await Bun.sleep(25);}
    let after=opened.cut.observationSeq,more=true;const events=[];
    while(more){const poll=await fixture.transport.history.poll(opened.cut.workerId,after);events.push(...poll.events);after=poll.through;more=poll.hasMore;}
    const final=events.filter(event=>event.kind==='message_settlement'&&event.item?.role==='assistant');
    expect(final).toHaveLength(1);expect(final[0].settlement).toEqual({status:'no_entry',durability:'not_attested',
      reason:scenario==='refusal'?'classifier_refusal':'empty_error'});
    await fixture.transport.history.close(opened.snapshot);
    const next=await fixture.transport.history.open('active');
    expect((await fixture.transport.history.page(next.cursor)).items.filter(item=>item.role==='assistant')).toHaveLength(1);
  }finally{await fixture.close();}
},20000);

test('actual controlled checkpoint/rewind tools retain the exact observed exploration result and explicitly invalidate context',async()=>{
  const fixture=await openLiveFixture(true,{scenario:'rewind'});
  try {
    const opened=await fixture.transport.history.open('active');await fixture.transport.prompt();
    for(let i=0;i<200;i++){if((await fixture.transport.state()).isSettled)break;await Bun.sleep(25);}
    let after=opened.cut.observationSeq,more=true;const events=[];
    while(more){const poll=await fixture.transport.history.poll(opened.cut.workerId,after);events.push(...poll.events);after=poll.through;more=poll.hasMore;}
    const result=events.find(event=>event.kind==='message_settlement'&&event.item?.toolName==='rewind');
    expect(result?.settlement.status).toBe('observed');expect(result?.settlement.durability).toBe('not_attested');
    expect(events.some(event=>event.kind==='native_setLeaf')).toBe(true);
    await expect(fixture.transport.history.page(opened.cursor)).rejects.toThrow('history_changed');
    await fixture.transport.history.close(opened.snapshot);
    const next=await fixture.transport.history.open('active');const rows=(await fixture.transport.history.page(next.cursor)).items;
    expect(rows.some(item=>item.boundary==='branch')).toBe(true);
    expect(rows.some(item=>item.toolName==='rewind')).toBe(false);
  }finally{await fixture.close();}
},20000);

for(const scenario of ['transform','handled'])test(`genuine extension input ${scenario} preserves exact native decisions without a fabricated lifecycle`,async()=>{
  const fixture=await openLiveFixture(true,{scenario});
  try {
    const opened=await fixture.transport.history.open('active');await fixture.transport.prompt();
    for(let i=0;i<160;i++){if((await fixture.transport.state()).isSettled)break;await Bun.sleep(25);}
    let after=opened.cut.observationSeq;const events=[];
    for(;;){const poll=await fixture.transport.history.poll(opened.cut.workerId,after);events.push(...poll.events);after=poll.through;if(!poll.hasMore)break;}
    const finals=events.filter(event=>event.kind==='message_settlement');
    await fixture.transport.history.close(opened.snapshot);
    const next=await fixture.transport.history.open('tree');let cursor=next.cursor;const rows=[];
    do{const page=await fixture.transport.history.page(cursor);rows.push(...page.items);cursor=page.nextCursor;}while(cursor);
    if(scenario==='handled'){
      expect(finals).toHaveLength(0);expect(rows.filter(item=>item.role==='user')).toHaveLength(1);
      expect(JSON.parse(await fs.readFile(path.join(fixture.profile,'controlled-provider.json'),'utf8')).calls).toBe(1);
    }else{
      const user=finals.find(event=>event.item.role==='user');const custom=finals.find(event=>event.item.role==='custom');
      expect(user.item.text).toBe('equal transformed content');expect(custom.item.text).toBe(user.item.text);
      expect(user.settlement.entryId).not.toBe(custom.settlement.entryId);
      expect(rows.find(row=>row.id===user.settlement.entryId).live).toEqual(user.live);
      expect(rows.find(row=>row.id===custom.settlement.entryId).text).toBe(custom.item.text);
      expect(finals.every(event=>event.settlement.durability==='not_attested')).toBe(true);
    }
    await fixture.transport.history.close(next.snapshot);
  }finally{await fixture.close();}
},20000);
