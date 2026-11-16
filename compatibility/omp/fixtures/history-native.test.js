import { test, expect, afterAll } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const profile = await mkdtemp(join(tmpdir(), 'omp-history-native-'));
process.env.HOME = profile;
process.env.PI_CODING_AGENT_DIR = profile;
const source = '../../../vendor/omp/packages/coding-agent/src/';
const { SessionManager } = await import(source + 'session/session-manager.ts');
const { RpcHistoryObservation } = await import(source + 'modes/rpc/rpc-history.ts');
afterAll(() => rm(profile, {recursive:true,force:true}));

test('same leaf and count payload rewrite invalidates pages, while prior results stay immutable', async () => {
  const manager = SessionManager.inMemory(profile);
  manager.appendMessage({role:'user', content:'original', timestamp:1});
  const history = new RpcHistoryObservation(manager, () => ({messages:[], streaming:false, compacting:false}));
  const opened = history.open('tree');
  const first = history.page(opened.cursor);
  manager.getEntries()[0].message.content = 'rewritten';
  expect(() => history.page(opened.cursor)).toThrow('history_changed');
  expect(first.items[0].text).toBe('original');
  const next = history.open('tree');
  expect(next.cut.contentRevision).not.toBe(opened.cut.contentRevision);
  expect(history.page(next.cursor).items[0].text).toBe('rewritten');
});

test('full tree includes off-branch append while active history follows actual parent chain and boundaries', () => {
  const manager = SessionManager.inMemory(profile);
  const root = manager.appendMessage({role:'user', content:'retained before compact', timestamp:1});
  const abandoned = manager.appendMessage({role:'user', content:'other branch', timestamp:2});
  manager.branch(root);
  manager.appendCompaction('native summary', undefined, root, 200);
  manager.appendResetBoundary();
  const leaf = manager.appendMessage({role:'user', content:'after reset', timestamp:3});
  const background = manager.appendMessageToBranch({role:'user', content:'background',timestamp:4}, abandoned);
  const runtime = {messages:[{role:'user',content:'running only',timestamp:5}], streaming:true,
    compacting:false, prefix:{role:'assistant',content:[{type:'text',text:'partial'}]}};
  const history = new RpcHistoryObservation(manager, () => runtime);
  const tree = history.open('tree');
  expect(tree.cut.leafId).toBe(leaf);
  const treeRows = history.page(tree.cursor).items;
  expect(treeRows.find(row => row.id === background).active).toBe(false);
  expect(treeRows.find(row => row.id === abandoned).active).toBe(false);
  history.close(tree.snapshot);
  const active = history.open('active');
  expect(history.page(active.cursor).items.map(row => row.text)).toEqual([
    'retained before compact', 'native summary', '[Native context reset]', 'after reset']);
  expect(history.page(active.cursor).items.filter(row => row.boundary).map(row => row.boundary)).toEqual(['compaction','reset']);
  expect(history.page(active.cursors.running).items.at(-1).text).toBe('partial');
  expect(active.streaming).toBe(true);
  history.close(active.snapshot);
  const running = history.open('running');
  expect(history.page(running.cursor).items.map(row => row.text)).toEqual(['running only','partial']);
});

test('internal custom/config/credential state has only structural markers; display messages survive', () => {
  const manager = SessionManager.inMemory(profile);
  manager.appendCustomEntry('private-config', {token:'SYNTHETIC_SECRET',config:{credential:'SYNTHETIC_SECRET'}});
  manager.appendCustomMessageEntry('hidden', 'SYNTHETIC_SECRET', false, {token:'SYNTHETIC_SECRET'});
  manager.appendCustomMessageEntry('notice', 'visible notice', true, {token:'SYNTHETIC_SECRET'});
  const history = new RpcHistoryObservation(manager, () => ({messages:[],streaming:false,compacting:false}));
  const opened = history.open('tree');
  const page = history.page(opened.cursor);
  expect(JSON.stringify(page)).not.toContain('SYNTHETIC_SECRET');
  expect(page.items.map(row => row.text)).toEqual(['[Native structural record]', '[Internal custom message]', 'visible notice']);
});

test('deletion/reparent and leaf-only changes invalidate cursors without using count or leaf as revision', async () => {
  const manager = SessionManager.inMemory(profile);
  const root = manager.appendMessage({role:'user',content:'root',timestamp:1});
  const discarded = manager.appendMessage({role:'user',content:'discarded',timestamp:2});
  const history = new RpcHistoryObservation(manager, () => ({messages:[],streaming:false,compacting:false}));
  const opened = history.open('tree');
  await manager.discardEntryDurably(discarded);
  expect(() => history.page(opened.cursor)).toThrow('history_changed');
  history.close(opened.snapshot);
  const before = history.open('tree');
  const child = manager.appendMessage({role:'user',content:'child',timestamp:3});
  history.close(before.snapshot);
  const current = history.open('tree');
  manager.getEntry(child).parentId = null;
  expect(() => history.page(current.cursor)).toThrow('history_changed');
  history.close(current.snapshot);
  const priorLeaf = history.open('tree');
  manager.branch(root);
  expect(() => history.page(priorLeaf.cursor)).toThrow('history_changed');
});

test('foreign, expired, released and old-worker cursors fail explicitly; live eviction reports a gap', () => {
  const manager = SessionManager.inMemory(profile);
  const history = new RpcHistoryObservation(manager, () => ({messages:[],streaming:false,compacting:false}));
  const first = history.open('tree');
  expect(() => history.page('foreign')).toThrow('history_stale_cursor');
  const other = new RpcHistoryObservation(manager, () => ({messages:[],streaming:false,compacting:false}));
  expect(() => other.page(first.cursor)).toThrow('history_stale_cursor');
  expect(() => other.poll(first.cut.workerId, first.cut.observationSeq)).toThrow('history_stale_observation');
  for (let i=0;i<4097;i++) history.observe({type:'message_update'});
  expect(() => history.poll(first.cut.workerId, first.cut.observationSeq)).toThrow('history_observation_gap');
  expect(() => history.open('invalid')).toThrow('history_invalid_scope');
  const realNow = Date.now;
  try { Date.now = () => first.expiresAt; expect(() => history.page(first.cursor)).toThrow('history_stale_cursor'); }
  finally { Date.now = realNow; }
  const second = history.open('tree'); history.close(second.snapshot);
  expect(() => history.page(second.cursor)).toThrow('history_stale_cursor');
});

test('oversized native item rejects whole snapshot even when internal and never silently truncates', () => {
  const manager = SessionManager.inMemory(profile);
  manager.appendCustomEntry('hidden', {body:'x'.repeat(64*1024*1024)});
  const history = new RpcHistoryObservation(manager, () => ({messages:[],streaming:false,compacting:false}));
  expect(() => history.open('tree')).toThrow('history_native_item_bytes');
});

test('large readable text and retained native image bytes are completely reachable in bounded parts', () => {
  const manager = SessionManager.inMemory(profile);
  const text = ('long text 😀\\\"\n').repeat(110000);
  const binary = Buffer.alloc(1024*1024+17, 91);
  manager.appendMessage({role:'user', content:[{type:'text',text},
    {type:'image',mimeType:'image/png',data:binary.toString('base64')}],timestamp:1});
  const history = new RpcHistoryObservation(manager, () => ({messages:[],streaming:false,compacting:false}));
  const opened = history.open('tree');
  let cursor = opened.cursor, parts = [], content;
  while (cursor) {
    const page = history.page(cursor);
    expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThan(768*1024);
    expect(page.cut).toEqual(opened.cut);
    parts.push(...page.items.map(row => row.text)); content ??= page.items[0]?.contents[0]; cursor = page.nextCursor;
  }
  expect(parts.join('')).toBe(text+'\n[Retained native image available; original association unproven]');
  expect(content.bytes).toBe(binary.byteLength);
  expect(content.origin).toBe('retained_native');
  expect(content.originalAssociation).toBe('unproven');
  cursor = content.cursor; const encoded = [];
  while (cursor) {
    const page = history.contentPage(cursor);
    expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThan(768*1024);
    encoded.push(page.data); cursor = page.nextCursor;
  }
  expect(Buffer.from(encoded.join(''),'base64').equals(binary)).toBe(true);
  manager.getEntries()[0].message.content[0].text = 'changed';
  expect(() => history.contentPage(content.cursor)).toThrow('history_changed');
});


test('bounded cache refuses new snapshots without evicting reachable pages and clocks enforce scan deadlines', () => {
  const manager = SessionManager.inMemory(profile);
  const history = new RpcHistoryObservation(manager, () => ({messages:[],streaming:false,compacting:false}));
  const first = history.open('tree'), second = history.open('tree');
  expect(() => history.open('tree')).toThrow('history_cache_full');
  expect(history.page(first.cursor).items).toEqual([]);
  history.close(second.snapshot);
  expect(history.open('active').scope).toBe('active');
  const realNow = performance.now;
  let clock = 0;
  try {
    performance.now = () => (clock+=6000);
    expect(() => new RpcHistoryObservation(manager, () => ({messages:[],streaming:false,compacting:false})).open('tree')).toThrow('history_scan_deadline');
  } finally { performance.now = realNow; }
});

test('file mentions, native tool errors and custom display honor safe typed semantics', () => {
  const manager=SessionManager.inMemory(profile);
  manager.appendMessage({role:'fileMention',files:[{path:'note.txt',content:'retained file body',byteSize:18}],timestamp:1});
  manager.appendMessage({role:'toolResult',toolCallId:'same-id',toolName:'read',isError:true,
    content:[{type:'text',text:'Native tool failed'}],details:{credential:'SYNTHETIC_SECRET'},timestamp:2});
  const history=new RpcHistoryObservation(manager,()=>({messages:[],streaming:false,compacting:false}));
  const opened=history.open('tree'),page=history.page(opened.cursor);
  expect(page.items[0].text).toBe('[File mention: note.txt]\nretained file body');
  expect(page.items[1]).toMatchObject({toolCallId:'same-id',toolName:'read',isError:true,text:'Native tool failed'});
  expect(JSON.stringify(page)).not.toContain('SYNTHETIC_SECRET');
});

test('an off-branch corrupt parent cycle and unknown structural entry fail instead of claiming a complete tree', () => {
  const manager=SessionManager.inMemory(profile);
  const first=manager.appendMessage({role:'user',content:'a',timestamp:1});
  const other=manager.appendMessage({role:'user',content:'b',timestamp:2});
  manager.branch(first); manager.getEntry(other).parentId=other;
  const history=new RpcHistoryObservation(manager,()=>({messages:[],streaming:false,compacting:false}));
  expect(()=>history.open('tree')).toThrow('history_parent_cycle');
  manager.getEntry(other).parentId=first; manager.getEntry(other).type='future_non_ignorable';
  expect(()=>history.open('tree')).toThrow('history_unknown_entry');
});

test('native leaf round trip and trusted source binding change reject prior cuts despite identical final leaf/count', () => {
  const manager=SessionManager.inMemory(profile);
  const root=manager.appendMessage({role:'user',content:'root',timestamp:1});
  const leaf=manager.appendMessage({role:'user',content:'leaf',timestamp:2});
  const history=new RpcHistoryObservation(manager,()=>({messages:[],streaming:false,compacting:false}));
  const before=history.open('tree');
  manager.branch(root);manager.branch(leaf);
  expect(manager.getLeafId()).toBe(before.cut.leafId);expect(manager.getEntries()).toHaveLength(2);
  expect(()=>history.page(before.cursor)).toThrow('history_changed');history.close(before.snapshot);
  const worker=history.open('tree');
  expect(()=>manager.bindHistorySource({sourceId:'a'.repeat(64),instanceId:'b'.repeat(64),nativeSessionId:'wrong',reference:'opaque'})).toThrow('history_source_binding_mismatch');
  // Trusted native caller fixture only: actual catalog verification/open/lease belongs to ticket32.
  manager.bindHistorySource({sourceId:'a'.repeat(64),instanceId:'b'.repeat(64),nativeSessionId:manager.getSessionId(),reference:'opaque'});
  expect(()=>history.page(worker.cursor)).toThrow('history_changed');history.close(worker.snapshot);
  const catalog=history.open('tree');
  expect(catalog.cut.sourceBindingStatus).toBe('catalog');expect(catalog.cut.sourceId).toBe('a'.repeat(64));
});

test('eight retained 4 MiB image representations and 5 MiB text remain accessible without a giant response', () => {
  const manager=SessionManager.inMemory(profile);
  const representations=Array.from({length:8},(_,index)=>Buffer.alloc(4*1024*1024,index+1));
  const text='t'.repeat(5*1024*1024);
  manager.appendMessage({role:'user',content:[{type:'text',text},...representations.map(data=>({type:'image',mimeType:'image/png',data:data.toString('base64')}))],timestamp:1});
  const history=new RpcHistoryObservation(manager,()=>({messages:[],streaming:false,compacting:false}));
  const opened=history.open('tree');
  let cursor=opened.cursor,parts=[],contents;
  while(cursor){const page=history.page(cursor);contents??=page.items[0].contents;parts.push(...page.items.map(row=>row.text));cursor=page.nextCursor;}
  expect(parts.join('').startsWith(text+'\n')).toBe(true);expect(contents).toHaveLength(8);
  for(let index=0;index<contents.length;index++){
    cursor=contents[index].cursor;const encoded=[];
    while(cursor){const page=history.contentPage(cursor);expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThan(768*1024);encoded.push(page.data);cursor=page.nextCursor;}
    expect(Buffer.from(encoded.join(''),'base64').equals(representations[index])).toBe(true);
  }
},120000);
