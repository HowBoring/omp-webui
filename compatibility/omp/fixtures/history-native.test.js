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
