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
async function fixture(options={}) {
  const manager = options.manager??SessionManager.inMemory(profile);
  const authStorage = await AuthStorage.create(path.join(profile, crypto.randomUUID() + '.db'));
  const model=options.model??getBundledModel('openai','gpt-4.1');
  if(options.model)authStorage.keys.setRuntime(model.provider,'synthetic-native-fixture-key');
  const tools=options.tools??[];
  const {convertToLlm}=await import(source+'session/messages.ts');
  const agent = new Agent({initialState:{model,tools},convertToLlm,
    getApiKey:()=>{if(options.model)return 'synthetic-native-fixture-key';throw Error('forbidden')},
    streamFn:options.streamFn??(()=>{throw Error('forbidden')})});
  const session = new AgentSession({agent,sessionManager:manager,
    settings:Settings.isolated({'compaction.enabled':false,'goal.continuationModes':[],'retry.enabled':false,'todo.enabled':false}),
    toolRegistry:new Map(tools.map(tool=>[tool.name,tool])),
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

test('live handoff keeps one native cut through prefix progress and verified append, while strict pages and rewrites fail',async()=>{
  const {agent,manager,history}=await fixture();
  const root=manager.appendMessage({role:'user',content:'retained before stream',timestamp:1});
  const assistant={role:'assistant',content:[{type:'text',text:'captured prefix'}],timestamp:2,
    api:'openai-completions',provider:'openai',model:'gpt-4.1',stopReason:'stop',
    usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}};
  agent.emitExternalEvent({type:'message_start',message:assistant});
  const opened=history.open('active','live');const strict=history.open('active');
  const updated={...assistant,content:[{type:'text',text:'newer prefix'}]};
  agent.emitExternalEvent({type:'message_update',message:updated,
    assistantMessageEvent:{type:'text_delta',contentIndex:0,delta:'newer ',partial:updated}});
  manager.appendMessageToBranch({role:'user',content:'off-branch append while paging',timestamp:3},root);
  const page=history.page(opened.cursor);
  expect(page.cut).toEqual(opened.cut);expect(page.items.map(item=>item.text)).toEqual(['retained before stream']);
  expect(history.page(opened.cursors.live).items.find(item=>item.kind==='running_prefix').text).toBe('captured prefix');
  expect(()=>history.page(strict.cursor)).toThrow('history_changed');
  manager.getEntry(root).message.content='changed behind the same ID';
  manager.appendMessage({role:'user',content:'another append must not hide rewrite',timestamp:4});
  expect(()=>history.page(opened.cursor)).toThrow('history_handoff_changed');
  expect(history.poll(opened.cut.workerId,opened.cut.observationSeq).events.some(event=>event.kind==='native_untracked_rewrite')).toBe(true);
});

const assistantData=(overrides={})=>({role:'assistant',content:[{type:'text',text:'native final'}],timestamp:100,
  api:'openai-completions',provider:'openai',model:'gpt-4.1',stopReason:'stop',
  usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},...overrides});

test('genuine native refusal and empty-error classifiers settle no-entry, including adjacent equal messages',async()=>{
  const {agent,session,history,manager}=await fixture();const opened=history.open('active');
  const cases=[
    {stopDetails:{type:'refusal'},reason:'classifier_refusal'},
    {stopDetails:{type:'sensitive'},reason:'classifier_refusal'},
    {content:[],reason:'empty_error'},
  ];
  for(const [index,kind] of cases.entries()){
    const {reason,...overrides}=kind;
    const message=assistantData({...overrides,stopReason:'error',timestamp:index,errorMessage:'synthetic controlled failure'});
    agent.emitExternalEvent({type:'message_start',message});agent.emitExternalEvent({type:'message_end',message});
    await session.settleInFlightMessagePersistence();
    const user={role:'user',content:'native final',timestamp:index};
    agent.emitExternalEvent({type:'message_start',message:user});agent.emitExternalEvent({type:'message_end',message:user});
    await session.settleInFlightMessagePersistence();
  }
  const events=history.poll(opened.cut.workerId,opened.cut.observationSeq).events.filter(event=>event.kind==='message_settlement');
  expect(events.filter(event=>event.item.role==='assistant').map(event=>event.settlement)).toEqual(
    cases.filter(kind=>kind.reason!=='empty_error').map(kind=>({status:'no_entry',durability:'not_attested',reason:kind.reason})));
  const decision=history.poll(opened.cut.workerId,opened.cut.observationSeq).events.find(event=>event.kind==='message_decision');
  expect(decision.settlement.reason).toBe('empty_error');
  expect(events.filter(event=>event.item.role==='user').map(event=>event.settlement.entryId)).toEqual(manager.getEntries().map(entry=>entry.id));
  expect(manager.getEntries().every(entry=>entry.message.role==='user')).toBe(true);
});

test('a real native append decision exception reports failed without inventing an entry association',async()=>{
  const {agent,session,history,manager}=await fixture();const opened=history.open('active');
  // Native normalization must assign missing accounting fields. A readonly external provider value faults there.
  const message=assistantData();Object.defineProperty(message,'usage',{value:{input:0},writable:false,enumerable:true});
  agent.emitExternalEvent({type:'message_start',message});agent.emitExternalEvent({type:'message_end',message});
  await session.settleInFlightMessagePersistence();
  const failed=history.poll(opened.cut.workerId,opened.cut.observationSeq).events.find(event=>event.kind==='message_settlement');
  expect(failed.settlement).toEqual({status:'failed',durability:'not_attested',reason:'native_persistence_failed'});
  expect(manager.getEntries()).toHaveLength(0);
});

test('public abort replaces the prompt generation before a queued native decision and settles no-entry',async()=>{
  const {agent,session,history,manager}=await fixture();const opened=history.open('active');
  const message={role:'user',content:'not allowed into the replacement generation',timestamp:1};
  agent.emitExternalEvent({type:'message_start',message});agent.emitExternalEvent({type:'message_end',message});
  await session.abort();await session.settleInFlightMessagePersistence();
  const settled=history.poll(opened.cut.workerId,opened.cut.observationSeq).events.find(event=>event.kind==='message_settlement');
  expect(settled.settlement).toEqual({status:'no_entry',durability:'not_attested',reason:'native_context_replaced'});
  expect(manager.getEntries()).toHaveLength(0);
});

test('latched backend write failure still reports only observed/not-attested memory, while native flush rejects',async()=>{
  const {MemorySessionStorage}=await import(source+'session/session-storage.ts');
  class FailingStorage extends MemorySessionStorage{
    armed=false;
    writeTextSync(file,text,options){if(this.armed)throw Error('synthetic backing store failed');return super.writeTextSync(file,text,options);}
    writeLinesSync(file,lines,options){return this.writeTextSync(file,lines.join(''),options);}
    async writeTextAtomic(file,text,options){if(this.armed)throw Error('synthetic backing store failed');return super.writeTextAtomic(file,text,options);}
    openWriter(file,options){const writer=super.openWriter(file,options),storage=this;return {
      appendSync(line){if(storage.armed)throw Error('synthetic backing store failed');writer.appendSync(line);},
      append:line=>writer.append(line),flush:()=>writer.flush(),close:()=>writer.close(),
    };}
  }
  const storage=new FailingStorage();
  const manager=SessionManager.create(profile,path.join(profile,'synthetic-storage'),storage);
  manager.appendMessage(assistantData());await manager.ensureOnDisk();await manager.flush();
  const {agent,session,history}=await fixture({manager});const opened=history.open('active');storage.armed=true;
  const message={role:'user',content:'visible only in native memory',timestamp:2};
  agent.emitExternalEvent({type:'message_start',message});agent.emitExternalEvent({type:'message_end',message});
  await session.settleInFlightMessagePersistence();
  const settled=history.poll(opened.cut.workerId,opened.cut.observationSeq).events.find(event=>event.kind==='message_settlement');
  expect(settled.settlement.status).toBe('observed');expect(settled.settlement.durability).toBe('not_attested');
  expect(manager.getEntry(settled.settlement.entryId).message).toBe(message);
  await expect(manager.flush()).rejects.toThrow('synthetic backing store failed');
  storage.armed=false;await manager.close().catch(()=>{});
});

test('genuine native rewind then late original result delivery consumes its explicit no-entry branch',async()=>{
  const {createMockModel}=await import('@oh-my-pi/pi-ai/providers/mock');
  const {type:schema}=await import('@oh-my-pi/pi-ai');
  const tools=[{name:'checkpoint',label:'Controlled checkpoint',description:'Controlled checkpoint tool boundary',
    parameters:schema({goal:'string'}),async execute(){return {content:[{type:'text',text:'checkpoint'}],details:{startedAt:'2026-01-01T00:00:00.000Z'}};}},
    {name:'rewind',label:'Controlled rewind',description:'Controlled rewind tool boundary',parameters:schema({report:'string'}),
      async execute(_id,args){return {content:[{type:'text',text:'rewind requested'}],details:{report:args.report,rewound:true}};}}];
  const model=createMockModel({responses:[
    {content:[{type:'toolCall',id:'checkpoint',name:'checkpoint',arguments:{goal:'controlled'}}],stopReason:'toolUse'},
    {content:[{type:'toolCall',id:'rewind',name:'rewind',arguments:{report:'controlled rewind'}}],stopReason:'toolUse'},
    {content:['native post-rewind final'],stopReason:'stop'},
  ]});
  const {session,agent,manager,history}=await fixture({model:Object.fromEntries(['id','name','api','provider','baseUrl','reasoning','input','cost','contextWindow','maxTokens','identity'].map(key=>[key,model[key]])),streamFn:model.stream,tools});
  let original;
  session.subscribe(event=>{if(event.type==='message_end'&&event.message.role==='toolResult'&&event.message.toolName==='rewind')original=event.message;});
  await session.prompt('controlled native rewind');
  expect(original).toBeDefined();expect(manager.getBranch().some(entry=>entry.type==='branch_summary')).toBe(true);
  const opened=history.open('active');
  agent.emitExternalEvent({type:'message_start',message:original});agent.emitExternalEvent({type:'message_end',message:original});
  await session.settleInFlightMessagePersistence();
  const settled=history.poll(opened.cut.workerId,opened.cut.observationSeq).events.find(event=>event.kind==='message_settlement');
  expect(settled.settlement).toEqual({status:'no_entry',durability:'not_attested',reason:'rewind_result_consumed'});
  expect(manager.getBranch().some(entry=>entry.type==='message'&&entry.message.toolName==='rewind')).toBe(false);
});

test('live handoff fences context changes, append branch jumps, newly appended rewrites and unknown entry categories',async()=>{
  for(const mutation of ['context','runtime','branch','new-rewrite','unknown','gap']){
    const {agent,manager,history}=await fixture();
    const root=manager.appendMessage({role:'user',content:'root',timestamp:1});
    manager.appendMessage({role:'user',content:'active leaf',timestamp:2});
    const opened=history.open('active','live');
    if(mutation==='runtime')agent.replaceMessages([{role:'user',content:'unlinked runtime replacement',timestamp:7}]);
    if(mutation==='context')agent.setSystemPrompt('changed native context without a retained mutation');
    if(mutation==='branch')manager.appendMessageToBranch({role:'user',content:'branch jump',timestamp:3},root,{preserveActiveLeaf:false});
    if(mutation==='new-rewrite'){
      const id=manager.appendMessage({role:'user',content:'original callback payload',timestamp:3});
      manager.getEntry(id).message.content='mutated before first capture';
    }
    if(mutation==='unknown'){
      const id=manager.appendCustomEntry('known custom',{});manager.getEntry(id).type='unsupported-source-record';
    }
    if(mutation==='gap')for(let i=0;i<4200;i++)history.observe({type:'fixture_notification'});
    expect(()=>history.page(opened.cursor)).toThrow(mutation==='gap'?'history_observation_gap':'history_handoff_changed');
    history.close(opened.snapshot);
  }
});

test('sealed native manager drops do not fabricate an observed entry ID',async()=>{
  const {agent,session,manager,history}=await fixture();const opened=history.open('active');
  manager.seal();const message={role:'user',content:'sealed native write',timestamp:1};
  agent.emitExternalEvent({type:'message_start',message});agent.emitExternalEvent({type:'message_end',message});
  await session.settleInFlightMessagePersistence();
  const settled=history.poll(opened.cut.workerId,opened.cut.observationSeq).events.find(event=>event.kind==='message_settlement');
  expect(settled.settlement).toEqual({status:'failed',durability:'not_attested',reason:'native_entry_unavailable'});
  expect(manager.getEntries()).toHaveLength(0);
});

test('genuine native display deobfuscation copies keep the original persisted object association despite unequal content',async()=>{
  const {SecretObfuscator}=await import(source+'secrets/index.ts');
  const {createMockModel}=await import('@oh-my-pi/pi-ai/providers/mock');
  const synthetic='SYNTHETIC_DISPLAY_ONLY_VALUE_35';const obfuscator=new SecretObfuscator([{type:'plain',content:synthetic}]);
  const placeholder=obfuscator.obfuscate(synthetic);
  const mock=createMockModel({responses:[{content:[placeholder]}]});
  const model=Object.fromEntries(['id','name','api','provider','baseUrl','reasoning','input','cost','contextWindow','maxTokens','identity'].map(key=>[key,mock[key]]));
  const {session,manager,history}=await fixture({model,streamFn:mock.stream});session.setObfuscator(obfuscator);
  const opened=history.open('active');let display;
  session.subscribe(event=>{if(event.type==='message_end'&&event.message.role==='assistant')display=event.message;});
  await session.prompt('controlled native transform');
  const events=history.poll(opened.cut.workerId,opened.cut.observationSeq).events;
  const settled=events.find(event=>event.kind==='message_settlement'&&event.item.role==='assistant');
  const original=manager.getEntry(settled.settlement.entryId).message;
  expect(display).not.toBe(original);expect(display.content[0].text).toBe(synthetic);
  expect(original.content[0].text).toBe(placeholder);expect(settled.item.text).toBe(placeholder);
  const snapshot=history.open('active');expect(history.page(snapshot.cursor).items.find(item=>item.id===settled.settlement.entryId).live).toEqual(settled.live);
});

test('late native frames for an already settled original object cannot reopen the DSH attempt or duplicate its final row',async()=>{
  const {LiveJournal}=await import('../../../packages/projection/live-journal.ts');
  const {HistoryClient}=await import('../../../packages/contracts/generated/history-client.ts');
  const {agent,session,history}=await fixture();
  const client=new HistoryClient(async command=>{
    if(command.type==='history_snapshot_open')return history.open(command.scope,command.handoff);
    if(command.type==='history_snapshot_page')return history.page(command.cursor);
    if(command.type==='history_snapshot_close')return history.close(command.snapshot);
    if(command.type==='history_observation_poll')return history.poll(command.workerId,command.after);
    throw Error('unexpected_native_read');
  });
  const journal=await LiveJournal.open(client),message=assistantData();
  agent.emitExternalEvent({type:'message_start',message});agent.emitExternalEvent({type:'message_end',message});
  await session.settleInFlightMessagePersistence();journal.accept(history.poll(journal.opened.cut.workerId,journal.after));
  const cut=journal.cursor;
  agent.emitExternalEvent({type:'message_update',message,assistantMessageEvent:{type:'text_delta',contentIndex:0,delta:'late',partial:message}});
  journal.accept(history.poll(journal.opened.cut.workerId,journal.after));
  expect(journal.cursor).toBe(cut);expect(journal.page({maxMessages:128}).records.filter(record=>record.event.type==='assistant/message')).toHaveLength(1);
});

test('same original object reused before queued persistence still settles both exact native lifecycles',async()=>{
  const {agent,history,session,manager}=await fixture();const opened=history.open('active');
  const message={role:'user',content:'same original object',timestamp:1};
  for(let index=0;index<2;index++){
    agent.emitExternalEvent({type:'message_start',message});agent.emitExternalEvent({type:'message_end',message});
  }
  await session.settleInFlightMessagePersistence();
  const events=history.poll(opened.cut.workerId,opened.cut.observationSeq).events;
  const starts=events.filter(event=>event.kind==='message_start');
  const settlements=events.filter(event=>event.kind==='message_settlement');
  expect(settlements).toHaveLength(2);
  expect(settlements.map(event=>event.live.messageId)).toEqual(starts.map(event=>event.live.messageId));
  expect(settlements.every(event=>event.settlement.entryId===manager.getEntries()[0].id)).toBe(true);
});
