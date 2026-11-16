/** Native system-boundary fixture: real AgentSession decisions, no provider inference. */
import { test, expect, afterAll } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'omp-live-native-'));
process.env.HOME = profile;
process.env.PI_CODING_AGENT_DIR = profile;
await import('./no-provider.ts');
const source = '../../../vendor/omp/packages/coding-agent/src/';
const { Agent } = await import('@oh-my-pi/pi-agent-core');
const { getBundledModel } = await import('@oh-my-pi/pi-catalog/models');
const { AgentSession } = await import(source + 'session/agent-session.ts');
const { SessionManager } = await import(source + 'session/session-manager.ts');
const { Settings } = await import(source + 'config/settings.ts');
const { ModelRegistry } = await import(source + 'config/model-registry.ts');
const { AuthStorage } = await import(source + 'session/auth-storage.ts');
const { RpcHistoryObservation } = await import(source + 'modes/rpc/rpc-history.ts');
afterAll(() => fs.rm(profile, {recursive:true,force:true}));
async function fixture() {
  const manager = SessionManager.inMemory(profile);
  const authStorage = await AuthStorage.create(path.join(profile, crypto.randomUUID() + '.db'));
  const agent = new Agent({initialState:{model:getBundledModel('openai','gpt-4.1'), tools:[]},
    getApiKey:()=>{throw Error('forbidden')},streamFn:()=>{throw Error('forbidden')}});
  const session = new AgentSession({agent,sessionManager:manager,
    settings:Settings.isolated({'compaction.enabled':false,'goal.continuationModes':[]}),
    modelRegistry:new ModelRegistry(authStorage,path.join(profile,'models.yml'))});
  const history = new RpcHistoryObservation(manager,()=>({messages:session.messages,
    context:session.getHistoryRuntimeContext(),prefix:agent.state.streamMessage,streaming:session.isStreaming,compacting:false}));
  session.subscribeMessageObservations(change=>history.observeMessage(change));
  return {manager,agent,session,history};
}
async function drain() { await Bun.sleep(50); }

test('equal content and timestamps settle each native lifecycle to its exact entry, overlapping snapshots once', async()=>{
  const {agent,history,manager} = await fixture();
  const initial = history.open('active');
  for (let i=0;i<2;i++) {
    const message={role:'user',content:'equal',timestamp:1};
    agent.emitExternalEvent({type:'message_start',message});
    agent.emitExternalEvent({type:'message_end',message});
    await drain();
  }
  const events=history.poll(initial.cut.workerId, initial.cut.observationSeq).events;
  const settlements=events.filter(event=>event.kind==='message_settlement');
  expect(settlements).toHaveLength(2);
  expect(settlements[0].settlement.entryId).toBe(manager.getEntries()[0].id);
  expect(settlements[0].settlement.status).toBe('observed');
  expect(settlements[0].settlement.durability).toBe('not_attested');
  // Native dedup deliberately appends no second entry. Never guess an old entry by text/time.
  expect(settlements[1].settlement.status).toBe('no_entry');
  expect(settlements[1].settlement.entryId).toBeUndefined();
  expect(settlements[1].live.messageId).not.toBe(settlements[0].live.messageId);
  const opened=history.open('active');
  const rows=history.page(opened.cursor).items;
  expect(rows[0].live.messageId).toBe(settlements[0].live.messageId);
  expect(rows[0].live.workerId).toBe(opened.cut.workerId);
  expect(rows[0].live.contextId).toBe(initial.cut.contextId);
});

test('final content supersedes partials, nested custom messages settle independently, one-run contexts have no entry',async()=>{
  const {agent,history,manager}=await fixture(); const opened=history.open('active');
  const assistant={role:'assistant',content:[{type:'text',text:'partial'}],timestamp:2,
    api:'openai-completions',provider:'openai',model:'gpt-4.1',stopReason:'stop',
    usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}};
  agent.emitExternalEvent({type:'message_start',message:assistant});
  const custom={role:'custom',customType:'notice',display:true,content:'equal',timestamp:2};
  agent.emitExternalEvent({type:'message_start',message:custom});
  agent.emitExternalEvent({type:'message_end',message:custom});
  agent.emitExternalEvent({type:'message_update',message:{...assistant,content:[{type:'text',text:'WRONG delta reconstruction'}]},
    assistantMessageEvent:{type:'text_delta',contentIndex:0,delta:'WRONG',partial:assistant}});
  agent.emitExternalEvent({type:'message_end',message:{...assistant,content:[{type:'text',text:'authoritative final'}]}});
  const hidden={role:'custom',customType:'vibe-mode-context',display:false,content:'SECRET',timestamp:3};
  agent.emitExternalEvent({type:'message_start',message:hidden});agent.emitExternalEvent({type:'message_end',message:hidden});
  await drain();
  const events=history.poll(opened.cut.workerId,opened.cut.observationSeq).events;
  const finals=events.filter(e=>e.kind==='message_final');
  expect(finals.find(e=>e.item.role==='assistant').item.text).toBe('authoritative final');
  expect(finals[0].live.messageId).not.toBe(finals[1].live.messageId);
  const settled=events.filter(e=>e.kind==='message_settlement');
  expect(settled[0].settlement.entryId).toBe(manager.getEntries()[0].id);
  expect(settled[1].settlement.entryId).toBe(manager.getEntries()[1].id);
  expect(settled[2].settlement.status).toBe('no_entry');
  expect(JSON.stringify(events)).not.toContain('SECRET');
});

test('source change metadata covers background appends, reparent/delete, raw rewrites and bounded gaps',async()=>{
  const {manager,history}=await fixture();
  const root=manager.appendMessage({role:'user',content:'root',timestamp:1});
  const old=manager.appendMessage({role:'user',content:'old',timestamp:2});
  const opened=history.open('active');
  manager.branch(root);
  const branch=manager.appendMessage({role:'user',content:'active',timestamp:3});
  const background=manager.appendMessageToBranch({role:'user',content:'background',timestamp:3},old);
  let events=history.poll(opened.cut.workerId,opened.cut.observationSeq).events;
  expect(events.find(e=>e.source?.entryId===background).source.leafId).toBe(branch);
  expect(events.find(e=>e.kind==='native_setLeaf').source.contextRevision).toBeGreaterThan(0);
  history.close(opened.snapshot);
  const next=history.open('active');
  manager.getEntry(root).message.content='rewritten';
  expect(history.poll(next.cut.workerId,next.cut.observationSeq).events.some(e=>e.kind==='native_untracked_rewrite')).toBe(true);
  await manager.discardEntryDurably(old);
  expect(()=>history.page(next.cursor)).toThrow('history_changed');
  const before=history.poll(next.cut.workerId,history.poll(next.cut.workerId,0).through).through;
  for(let i=0;i<4100;i++) history.observe({type:'bounded_fixture_notification'});
  expect(()=>history.poll(next.cut.workerId,before)).toThrow('history_observation_gap');
});

test('reused tool IDs keep native context and exact initiating assistant identity',async()=>{
  const {agent,manager,history}=await fixture();const opened=history.open('active');
  const assistant={role:'assistant',content:[{type:'toolCall',id:'reusable',name:'fixture',arguments:{}}],timestamp:1,
    api:'openai-completions',provider:'openai',model:'gpt-4.1',stopReason:'toolUse',
    usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}};
  for(let i=0;i<2;i++) {
    if(i) manager.resetLeaf();
    agent.emitExternalEvent({type:'message_start',message:{...assistant}});
    agent.emitExternalEvent({type:'message_end',message:{...assistant}});
    const result={role:'toolResult',toolCallId:'reusable',toolName:'fixture',content:[{type:'text',text:'same'}],timestamp:1,isError:false};
    agent.emitExternalEvent({type:'message_start',message:result});agent.emitExternalEvent({type:'message_end',message:result});
    await drain();
  }
  const finals=history.poll(opened.cut.workerId,opened.cut.observationSeq).events.filter(e=>e.kind==='message_final');
  expect(finals[1].live.toolOwnerMessageId).toBe(finals[0].live.messageId);
  expect(finals[3].live.toolOwnerMessageId).toBe(finals[2].live.messageId);
  expect(finals[0].live.contextId).not.toBe(finals[2].live.contextId);
});

test('the same original object on a new branch follows native append semantics rather than reusing an off-branch link',async()=>{
  const {agent,manager,history}=await fixture();const initial=history.open('active');
  const message={role:'user',content:'same original object',timestamp:1};
  agent.emitExternalEvent({type:'message_start',message});agent.emitExternalEvent({type:'message_end',message});await drain();
  const old=manager.getLeafId();manager.resetLeaf();
  agent.emitExternalEvent({type:'message_start',message});agent.emitExternalEvent({type:'message_end',message});await drain();
  const settled=history.poll(initial.cut.workerId,initial.cut.observationSeq).events.filter(e=>e.kind==='message_settlement');
  expect(manager.getEntries()).toHaveLength(2);
  expect(settled[0].settlement.entryId).toBe(old);
  expect(settled[1].settlement.entryId).toBe(manager.getLeafId());
  expect(settled[1].settlement.entryId).not.toBe(old);
});

test('bounded association eviction is explicit and old entries remain readable without invented live identities',async()=>{
  const {agent,history}=await fixture();
  for(let i=0;i<4100;i++){
    const message={role:'user',content:'bounded retained source',timestamp:i};
    agent.emitExternalEvent({type:'message_start',message});agent.emitExternalEvent({type:'message_end',message});
  }
  await drain();const opened=history.open('active');
  expect(history.page(opened.cursor).items[0].live).toBeUndefined();
  const tail=history.poll(opened.cut.workerId,opened.cut.observationSeq-128);
  expect(tail.events.some(event=>event.kind==='native_settlement_evicted')).toBe(true);
  expect(()=>history.poll(opened.cut.workerId,0)).toThrow('history_observation_gap');
  history.close(opened.snapshot);
},30000);

test('real native bounded pages explicitly refuse a derived journal that exceeds its byte budget',async()=>{
  const {LiveJournal}=await import('../../../packages/projection/live-journal.ts');
  const {HistoryClient}=await import('../../../packages/contracts/generated/history-client.ts');
  const manager=SessionManager.inMemory(profile);
  for(let i=0;i<1800;i++)manager.appendMessage({role:'user',content:'x'.repeat(20000),timestamp:i});
  const observation=new RpcHistoryObservation(manager,()=>({messages:[],streaming:false,compacting:false}));
  const client=new HistoryClient(async command=>{
    if(command.type==='history_snapshot_open')return observation.open(command.scope);
    if(command.type==='history_snapshot_page')return observation.page(command.cursor);
    if(command.type==='history_snapshot_close')return observation.close(command.snapshot);
    throw Error('unexpected_native_read');
  });
  await expect(LiveJournal.open(client)).rejects.toThrow('live_projection_evicted');
},30000);

test('idle public custom-message delivery settles at its real append before display and never borrows the next entry',async()=>{
  const {session,history,manager}=await fixture();const opened=history.open('active');
  await session.sendCustomMessage({customType:'isolated-idle-notice',content:'idle notice',display:true},{triggerTurn:false});
  const events=history.poll(opened.cut.workerId,opened.cut.observationSeq).events;
  const settlement=events.find(event=>event.kind==='message_settlement');
  expect(settlement?.settlement.entryId).toBe(manager.getEntries()[0].id);
  expect(settlement?.live.branchLeafId).toBe(null);
  expect(settlement?.item.text).toBe('idle notice');
});
