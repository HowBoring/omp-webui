/** Public HistoryClient fake: the retained Native snapshot lease lapses mid-paging. */
import {test,expect} from 'bun:test';
import {HistoryClient} from '../../packages/contracts/generated/history-client.ts';
import {LiveJournal} from '../../packages/projection/live-journal.ts';
import type {HistoryCut, HistoryItem, HistoryLimits, HistoryOpen} from '../../packages/contracts/generated/omp-wire.ts';

const PAGE=128, ROWS=600;
const limits:HistoryLimits={entries:20000,runningMessages:10000,scanItems:60000,bytes:1000000,nativeItemBytes:1000000,
  itemBytes:512*1024,ms:5000,snapshotBytes:256*1024*1024,cacheBytes:512*1024*1024,snapshots:2,pageItems:PAGE,
  pageBytes:768*1024,responseBytes:1024*1024,ttlMs:600000,contentItems:64,contentPageBytes:10000,liveEvents:1024,
  liveBytes:1000000,pollItems:100};
const rows:HistoryItem[]=Array.from({length:ROWS},(_,index)=>({id:`r${index}`,
  parentId:index===0?null:`r${index-1}`,kind:'message',active:true,text:`row ${index}`,partIndex:0,partCount:1,
  role:index%2===0?'user':'assistant',...(index%2===0?{}:{provider:'synthetic',model:'fixture'})}));

function fixture(renewedRevision='content-v1') {
  const state={opens:0,stalePages:0,snapshot:'snapshot-1',cursor:'active-1',expiresAt:1_000_000,stale:false,
    revision:'content-v1'};
  const cut=():HistoryCut=>({durability:'not_attested',sourceBindingStatus:'worker',
    sourceId:'source',sessionId:'native-session',workerId:'worker',contextId:'context',contentRevision:state.revision,
    nativeRevision:1,retainedRevision:'retained-1',leafId:rows[ROWS-1]!.id,observationSeq:1});
  const opening=():HistoryOpen=>({version:'coherent-history-v1',handoff:'live',snapshot:state.snapshot,
    cursor:state.cursor,scope:'active',cut:cut(),cursors:{tree:state.cursor,active:state.cursor,
      running:'running',live:'live'},expiresAt:state.expiresAt,count:rows.length,streaming:false,compacting:false,
    prefix:null,scannedBytes:1,scanMs:0,snapshotMs:0,limits});
  const history=new HistoryClient(async command=>{
    if(command.type==='history_snapshot_close')return {closed:true};
    if(command.type==='history_snapshot_open'){
      state.opens++;
      if(state.opens>1){state.snapshot='snapshot-2';state.cursor='active-2';state.expiresAt=2_000_000;state.stale=false;
        state.revision=renewedRevision;}
      return opening();
    }
    if(command.type==='history_observation_poll')
      return {cut:cut(),after:command.after,through:command.after,events:[],hasMore:false};
    if(command.type!=='history_snapshot_page')throw Error('UNEXPECTED_NATIVE_OPERATION');
    if(command.cursor==='live')
      return {snapshot:state.snapshot,scope:'live' as const,cut:cut(),expiresAt:state.expiresAt,items:[],
        complete:true as const};
    if(command.cursor!==state.cursor)throw Error('history_stale_cursor');
    if(state.stale){state.stale=false;state.stalePages++;throw Error('history_stale_cursor');}
    const before=command.before??rows.length,start=Math.max(0,before-PAGE);
    return {snapshot:state.snapshot,scope:'active' as const,cut:cut(),expiresAt:state.expiresAt,
      items:rows.slice(start,before),offset:start,complete:true as const};
  });
  return {history,state};
}

test('an expired Native snapshot lease renews at the same cut and older paging continues',async()=>{
  const {history,state}=fixture();
  const journal=await LiveJournal.open(history);
  state.stale=true;
  const page=await journal.page({throughSeq:journal.cursor,beforeSeq:1_000_000,maxMessages:8});
  expect(state.opens).toBe(2);
  expect(state.stalePages).toBe(1);
  expect(journal.opened.snapshot).toBe('snapshot-2');
  // 128 whole records: 64 users (turn start + message) and 64 assistants (step start + message + step end).
  expect(page.records).toHaveLength(320);
  expect(page.records[0]?.type).toBe('event');
  expect(page.records[0]?.type==='event'?page.records[0].event.seq:0).toBe(1_000_000-320);
  expect(page.records.at(-1)?.type==='event'?page.records.at(-1)!.event.seq:0).toBe(999_999);
  expect(page.hasMore).toBe(true);
},20000);

test('a lease renewed after the Native cut moved rejects the older page instead of mixing cuts',async()=>{
  const {history,state}=fixture('content-v2');
  const journal=await LiveJournal.open(history);
  state.stale=true;
  const page=journal.page({throughSeq:journal.cursor,beforeSeq:1_000_000,maxMessages:8});
  await expect(page).rejects.toThrow('live_open_cut_changed');
  expect(journal.failure).toBe('live_open_cut_changed');
},20000);

/** A pool that enforces the Native snapshot cap (`limits.snapshots`) and can hold an opening open. */
function pooledFixture() {
  const state={opens:0,staleFor:0,live:new Set<string>(),closed:[] as string[],maxLive:0,
    snapshot:'',cursor:'',expiresAt:1_000_000,gate:undefined as Promise<void>|undefined};
  const cut=():HistoryCut=>({durability:'not_attested',sourceBindingStatus:'worker',
    sourceId:'source',sessionId:'native-session',workerId:'worker',contextId:'context',contentRevision:'content-v1',
    nativeRevision:1,retainedRevision:'retained-1',leafId:rows[ROWS-1]!.id,observationSeq:1});
  const opening=():HistoryOpen=>({version:'coherent-history-v1',handoff:'live',snapshot:state.snapshot,
    cursor:state.cursor,scope:'active',cut:cut(),cursors:{tree:state.cursor,active:state.cursor,
      running:'running',live:'live'},expiresAt:state.expiresAt,count:rows.length,streaming:false,compacting:false,
    prefix:null,scannedBytes:1,scanMs:0,snapshotMs:0,limits});
  const history=new HistoryClient(async command=>{
    if(command.type==='history_snapshot_close'){
      if(!state.live.delete(command.snapshot))throw Error('history_unknown_snapshot');
      state.closed.push(command.snapshot);
      return {closed:true};
    }
    if(command.type==='history_snapshot_open'){
      state.opens++;
      if(state.live.size>=limits.snapshots)throw Error('history_cache_full');
      state.snapshot=`snapshot-${state.opens}`;state.cursor=`active-${state.opens}`;
      state.expiresAt=1_000_000*state.opens;state.live.add(state.snapshot);
      state.maxLive=Math.max(state.maxLive,state.live.size);
      if(state.gate)await state.gate;
      return opening();
    }
    if(command.type==='history_observation_poll')
      return {cut:cut(),after:command.after,through:command.after,events:[],hasMore:false};
    if(command.type!=='history_snapshot_page')throw Error('UNEXPECTED_NATIVE_OPERATION');
    if(command.cursor==='live')
      return {snapshot:state.snapshot,scope:'live' as const,cut:cut(),expiresAt:state.expiresAt,items:[],
        complete:true as const};
    if(command.cursor!==state.cursor)throw Error('history_stale_cursor');
    if(state.staleFor>0){state.staleFor--;throw Error('history_stale_cursor');}
    const before=command.before??rows.length,start=Math.max(0,before-PAGE);
    return {snapshot:state.snapshot,scope:'active' as const,cut:cut(),expiresAt:state.expiresAt,
      items:rows.slice(start,before),offset:start,complete:true as const};
  });
  return {history,state};
}
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));

test('concurrent stale pages share one renewal inside the Native snapshot cap',async()=>{
  const {history,state}=pooledFixture();
  const journal=await LiveJournal.open(history);
  expect(state.opens).toBe(1);
  state.staleFor=2;
  const {promise:gate,resolve:release}=Promise.withResolvers<void>();
  state.gate=gate;
  const before=1_000_000,request={throughSeq:journal.cursor,beforeSeq:before,maxMessages:8};
  const first=journal.page(request),second=journal.page(request);
  await tick();
  // Single-flight: both stale pages wait on the same Native opening instead of exceeding the cap.
  expect(state.opens).toBe(2);
  release();state.gate=undefined;
  const [a,b]=await Promise.all([first,second]);
  expect(a.records.length).toBeGreaterThan(0);
  expect(b.records.length).toBe(a.records.length);
  expect(state.maxLive).toBeLessThanOrEqual(limits.snapshots);
  expect(journal.opened.snapshot).toBe('snapshot-2');
  expect([...state.live]).toEqual(['snapshot-2']);
  expect(state.closed.filter(name=>name==='snapshot-1')).toHaveLength(1);
},20000);

test('dispose during a renewal closes both snapshots and never publishes the renewed one',async()=>{
  const {history,state}=pooledFixture();
  const journal=await LiveJournal.open(history);
  state.staleFor=1;
  const {promise:gate,resolve:release}=Promise.withResolvers<void>();
  state.gate=gate;
  const page=journal.page({throughSeq:journal.cursor,beforeSeq:1_000_000,maxMessages:8});
  await tick();
  expect(state.opens).toBe(2); // the renewal is in flight while the journal is still presented
  journal.dispose();
  release();state.gate=undefined;
  await expect(page).rejects.toThrow('live_history_closed');
  await tick();
  expect(state.live.size).toBe(0);
  expect(state.closed.slice().sort()).toEqual(['snapshot-1','snapshot-2']);
},20000);
