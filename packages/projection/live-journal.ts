import { SessionId, SessionSeq } from '@deepseek-ai/dsh-session/types';
import { LlmAttemptId } from '@deepseek-ai/dsh-llm/brand';
import type { JsonValue } from '@deepseek-ai/dsh-util-values';
import type { SessionFollowFrame, SessionHistoryRecord, SessionPage, SessionPageRequest,
  SessionAssistantStreamBaseline, SessionAssistantStreamFrame } from '@deepseek-ai/dsh-api-session-controller/types';
import type { HistoryClient } from '../contracts/generated/history-client.ts';
import type { HistoryOpen, HistoryItem, HistoryChange, HistoryPoll, HistoryLiveIdentity } from '../contracts/generated/omp-wire.ts';

type AssistantFrameInput = { [K in SessionAssistantStreamFrame["type"]]: Omit<Extract<SessionAssistantStreamFrame,{type:K}>,"revision"> }[SessionAssistantStreamFrame["type"]];
const MAX_EVENTS=60_000, MAX_BYTES=32*1024*1024;
const identity=(live:HistoryLiveIdentity):string=>JSON.stringify([live.workerId,live.sourceId,live.sessionId,
  live.contextId,live.branchLeafId,live.messageId]);
interface Attempt {id:LlmAttemptId; live:HistoryLiveIdentity; index:number; turn:number;step:number; startedAfterSeq:number}
/** Disposable derived DSH generation. Native data remains authoritative; no transcript is persisted. */
export class LiveJournal {
  readonly generation=crypto.randomUUID();
  readonly sessionId;
  readonly #records:SessionHistoryRecord[]=[];
  readonly #entries=new Set<string>();
  readonly #groups:number[]=[];
  readonly #settled=new Set<string>();
  readonly #pendingAppends=new Set<string>();
  readonly #listeners=new Set<(frame:SessionFollowFrame)=>void>();
  #bytes=0;#after:number;#turn=0;#step=0;#assistantRevision=0;#attempt:Attempt|undefined;
  #failure:string|undefined;
  private constructor(readonly opened:HistoryOpen) {this.sessionId=SessionId(opened.cut.sessionId);this.#after=opened.cut.observationSeq;}
  static async open(history:HistoryClient):Promise<LiveJournal>{
    const opened=await history.open('active');const journal=new LiveJournal(opened);
    try {
      let cursor:string|undefined=opened.cursor;const parts=new Map<string,HistoryItem>();
      while(cursor){const page=await history.page(cursor);
        if(page.cut.contentRevision!==opened.cut.contentRevision)throw Error('live_open_cut_changed');
        for(const item of page.items){const id=item.entryId??item.id;const prior=parts.get(id);
          if(prior){if(item.partIndex!==((prior.partIndex??0)+1))throw Error('live_open_parts');
            prior.text+=item.text;prior.partIndex=item.partIndex;}else parts.set(id,{...item});}
        cursor=page.nextCursor;
      }
      for(const item of parts.values())journal.#commit(item);
      // Prefix cannot be safely treated as committed. Opening during a native attempt explicitly requires reopen.
      if(opened.streaming||opened.prefix)throw Error('live_open_running_requires_reopen');
      return journal;
    }finally{await history.close(opened.snapshot);}
  }
  get cursor():number{return this.#records.length-1;}
  get after():number{return this.#after;}
  get failure():string|undefined{return this.#failure;}
  invalidate(code:string):void{this.#failure??=code;this.#listeners.clear();}
  #assert():void{if(this.#failure)throw Error(this.#failure);}
  page(request:Pick<SessionPageRequest,'throughSeq'|'beforeSeq'|'maxMessages'>):SessionPage{
    this.#assert();const through=request.throughSeq??this.cursor,before=request.beforeSeq??through+1;
    if(!Number.isSafeInteger(through)||through>this.cursor||through< -1||!Number.isSafeInteger(before)||before<0||before>through+1)
      throw Error('live_stale_page');
    const end=Math.min(through+1,before);
    const groups=this.#groups.filter(start=>start<end);
    const start=groups[Math.max(0,groups.length-Math.min(128,request.maxMessages??32))]??0;
    return structuredClone({records:this.#records.slice(start,end),hasMore:start>0});
  }
  snapshot():Extract<SessionFollowFrame,{type:'snapshot'}>{
    this.#assert();const page=this.page({throughSeq:this.cursor,maxMessages:32});
    const assistantStream:SessionAssistantStreamBaseline={revision:this.#assistantRevision};
    if(this.#attempt)throw Error('live_follow_running_requires_reopen');
    return {type:'snapshot',header:{version:4,id:this.sessionId,createdAt:0,isSeeded:false},cursor:this.cursor,
      ...page,projections:{asOfSeq:this.cursor,values:{}},assistantStream};
  }
  subscribe(listener:(frame:SessionFollowFrame)=>void):()=>void{this.#assert();this.#listeners.add(listener);return()=>{this.#listeners.delete(listener);};}
  #publish(frame:SessionFollowFrame):void{for(const listener of this.#listeners)listener(structuredClone(frame));}
  #event(type:string,data:JsonValue,surface=false):SessionHistoryRecord{
    const entry:SessionHistoryRecord={type:'event',event:{type,seq:this.#records.length,time:0,data,...(surface?{surfaceOp:'append'}:{ignorable:true})}};
    this.#bytes+=Buffer.byteLength(JSON.stringify(entry));
    if(this.#records.length>=MAX_EVENTS||this.#bytes>MAX_BYTES){this.invalidate('live_projection_evicted');throw Error('live_projection_evicted');}
    this.#records.push(structuredClone(entry));this.#publish(entry);return entry;
  }
  #commit(item:HistoryItem):SessionHistoryRecord|undefined{
    const id=item.entryId??item.id;if(this.#entries.has(id))return;
    this.#entries.add(id);if(item.live)this.#settled.add(identity(item.live));
    const content=[{type:'text',text:item.text}];
    if(item.role==='user'){this.#groups.push(this.#records.length);this.#turn++;this.#event('turn/start',{turn:this.#turn});
      return this.#event('user/message',{id,role:'user',source:{kind:'user'},content},true);}
    if(item.role==='assistant'){
      if(!item.provider||!item.model)throw Error('live_missing_model_source');
      const attempt=this.#attempt;const turn=attempt?.turn??this.#turn,step=attempt?.step??++this.#step;
      if(!attempt){this.#groups.push(this.#records.length);this.#event('step/start',{turn,step});}
      const entry=this.#event('assistant/message',{turn,step,message:{id,role:'assistant',source:{kind:'model',
        provider:item.provider,model:item.model},content},stream:[],...(item.stopReason==='aborted'?{interrupted:true}:{})},true);
      if(!attempt)this.#event('step/end',{turn,step});
      return entry;
    }
    this.#groups.push(this.#records.length);
    return this.#event('omp/native-record',{id,kind:item.kind,text:item.text,role:item.role??null});
  }
  #frame(frame:AssistantFrameInput):void{
    this.#publish({type:'assistant-stream',frame:{...frame,revision:++this.#assistantRevision} as SessionAssistantStreamFrame});
  }
  accept(poll:HistoryPoll):void{
    this.#assert();
    if(poll.cut.workerId!==this.opened.cut.workerId||poll.cut.sessionId!==this.sessionId||poll.after!==this.#after){
      this.invalidate('live_observation_out_of_order');throw Error('live_observation_out_of_order');}
    if(poll.cut.sourceId!==this.opened.cut.sourceId||poll.cut.contextId!==this.opened.cut.contextId){this.invalidate('live_context_changed');throw Error('live_context_changed');}
    for(const event of poll.events){if(event.seq!==this.#after+1){this.invalidate('live_observation_gap');throw Error('live_observation_gap');}
      this.#apply(event);this.#after=event.seq;}
    if(!poll.hasMore&&this.#pendingAppends.size){this.invalidate('live_unassociated_source_append');throw Error('live_unassociated_source_append');}
    if(this.#settled.size>4096){this.invalidate('live_settlement_evicted');throw Error('live_settlement_evicted');}
    if(poll.through!==this.#after){this.invalidate('live_observation_gap');throw Error('live_observation_gap');}
  }
  #apply(event:HistoryChange):void{
    if(['native_setLeaf','native_clear','native_rebuild','native_rewrite','native_source_replaced','native_source_binding',
      'native_untracked_rewrite','native_live_gap','native_settlement_evicted'].includes(event.kind)){
      this.invalidate('live_projection_invalidated');throw Error('live_projection_invalidated');}
    if(event.kind==='native_append'&&event.source?.entryId){
      if(!event.item){this.invalidate('live_source_payload_missing');throw Error('live_source_payload_missing');}
      if(!event.item.active)return;
      if(event.item.kind==='message'||(event.item.kind==='custom_message'&&event.item.role==='custom'))this.#pendingAppends.add(event.source.entryId);
      else this.#commit(event.item);
    }
    if(event.settlement?.entryId)this.#pendingAppends.delete(event.settlement.entryId);
    if(!event.live||!event.item)return;
    const key=identity(event.live);if(this.#settled.has(key))return;
    if(event.item.role==='toolResult'&&!event.live.toolOwnerMessageId){this.invalidate('live_tool_owner_unavailable');throw Error('live_tool_owner_unavailable');}
    if(event.live.contextId!==this.opened.cut.contextId){this.invalidate('live_context_changed');throw Error('live_context_changed');}
    if(event.kind==='message_start'&&event.item.role==='assistant'){
      if(this.#attempt){this.invalidate('live_overlapping_assistant');throw Error('live_overlapping_assistant');}
      this.#groups.push(this.#records.length);
      const turn=this.#turn,step=++this.#step;this.#event('step/start',{turn,step});
      const id=LlmAttemptId(key);this.#attempt={id,live:event.live,index:0,turn,step,startedAfterSeq:this.cursor};
      this.#frame({type:'start',attemptId:id,startedAfterSeq:this.cursor===-1?-1:SessionSeq(this.cursor),turn,step});
      return;
    }
    if(event.kind==='message_update'&&this.#attempt&&identity(this.#attempt.live)===key){
      const attempt=this.#attempt;
      this.#frame({type:'chunk',attemptId:attempt.id,index:attempt.index++,time:0,
        chunk:{type:'block-end',index:0,block:{type:'text',text:event.item.text}}});
      return;
    }
    if(event.kind!=='message_settlement')return;
    const settlement=event.settlement;if(!settlement){this.invalidate('live_missing_settlement');throw Error('live_missing_settlement');}
    if(settlement.status==='failed'){this.invalidate('live_native_decision_failed');throw Error('live_native_decision_failed');}
    const attempt=this.#attempt;
    if(event.item.role==='assistant'&&(!attempt||identity(attempt.live)!==key)){this.invalidate('live_late_attempt');throw Error('live_late_attempt');}
    const entry=settlement.status==='observed'&&settlement.entryId?this.#commit({...event.item,id:settlement.entryId,entryId:settlement.entryId}):undefined;
    this.#settled.add(key);
    if(attempt&&event.item.role==='assistant'){
      this.#frame({type:'end',attemptId:attempt.id,index:attempt.index,outcome:entry?
        {kind:'committed',eventType:'assistant/message',seq:entry.event.seq}:{kind:'abandoned'}});
      this.#event('step/end',{turn:attempt.turn,step:attempt.step});this.#attempt=undefined;
    }
  }
}
