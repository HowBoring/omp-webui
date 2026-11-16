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
