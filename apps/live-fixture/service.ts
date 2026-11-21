import {Remote,TypertRemoteService,RemoteError} from '@deepseek-ai/dsh-typert-protocol';
import type {Context} from '@deepseek-ai/cordis';
import type {SessionFollowRequest,SessionPageRequest,SessionControlFrame,SessionFollowFrame,SessionListRequest,
  SessionProjectionsRequest} from '@deepseek-ai/dsh-api-session-controller/types';
import type {LiveTransport} from '../../packages/compatibility/live-transport.ts';
import {LiveJournal} from '../../packages/projection/live-journal.ts';
import type {LiveFixtureResult} from '../../packages/contracts/live-fixture.ts';
export class LiveFixtureState {
  journal:LiveJournal;holders=0;closed=false;settled=true;
  private constructor(readonly transport:LiveTransport,journal:LiveJournal){this.journal=journal;}
  static async open(transport:LiveTransport){return new LiveFixtureState(transport,await LiveJournal.open(transport.history));}
  async poll(){if(this.journal.failure)return;
    try {const result=await this.transport.history.poll(this.journal.opened.cut.workerId,this.journal.after);this.journal.accept(result);}
    catch(error){this.journal.invalidate(error instanceof Error&&/^(history_|live_)/.test(error.message)?error.message:'live_poll_failed');}
  }
  info():LiveFixtureResult{return {sessionId:this.journal.sessionId,generation:this.journal.generation,
    settled:this.settled,phase:this.journal.failure?'invalidated':'ready',...(this.journal.failure?{reason:this.journal.failure}:{}),durability:'not_attested'};}
}
export class LiveFixtureActions extends TypertRemoteService {
  constructor(ctx:Context,readonly state:LiveFixtureState){super(ctx,'ompLiveFixture');}
  @Remote("action")
  async action(operation:'info'|'prompt'|'rewind'|'reopen'):Promise<LiveFixtureResult>{
    const native=await this.state.transport.state();this.state.settled=native.isSettled===true&&!native.isStreaming&&!native.isCompacting;
    if(operation==='prompt'){if(this.state.journal.failure)throw Error('live_projection_invalidated');await this.state.transport.prompt();}
    if(operation==='rewind'){
      if(!this.state.settled)throw new RemoteError('gateway/bad-request','Native worker is busy; wait for quiescence and choose navigation again',{});
      const records=(await this.state.journal.page({maxMessages:128})).records;
      const user=records.find(record=>record.event.type==='user/message');
      const data=user?.event.data;
      if(typeof data!=='object'||data===null||Array.isArray(data)||typeof data.id!=='string')throw Error('live_no_navigation_target');
      await this.state.transport.navigate(data.id);await this.state.poll();
    }
    if(operation==='reopen'){
      if(this.state.holders!==0)throw new RemoteError('gateway/bad-request','Release the full view before reopening',{});
      this.state.journal=await LiveJournal.open(this.state.transport.history);
    }
    return this.state.info();
  }
}
export class LiveSessionService extends TypertRemoteService {
  constructor(ctx:Context,readonly state:LiveFixtureState){super(ctx,'sessionController',{namespace:'session'});}
  @Remote("list") async list(_request:SessionListRequest){return {items:[{sessionId:this.state.journal.sessionId,updatedAt:0,
    agentAvailable:true,running:false,blank:false,formatStatus:'current' as const}]};}
  @Remote("projections") async projections(_request:SessionProjectionsRequest){return {kind:'sequenced' as const,asOfSeq:this.state.journal.cursor,values:{}};}
  @Remote("page") async page(request:SessionPageRequest){this.assertAddress(request.address);return {cursor:request.throughSeq??this.state.journal.cursor,...await this.state.journal.page(request)};}
  @Remote({mode:'stream'}) async *control(signal:AbortSignal):AsyncGenerator<SessionControlFrame>{
    yield {type:'baseline',value:{projections:{}}};while(!signal.aborted&&!this.state.closed)await Bun.sleep(25);
  }
  assertAddress(address:SessionFollowRequest['address']){if(address.kind!=='session'||address.sessionId!==this.state.journal.sessionId)throw Error('live_foreign_session');}
  @Remote({mode:'stream'}) async *follow(request:SessionFollowRequest,signal:AbortSignal):AsyncGenerator<SessionFollowFrame>{
    this.assertAddress(request.address);const journal=this.state.journal;const queue:SessionFollowFrame[]=[];
    let bytes=0;const dispose=journal.subscribe(frame=>{const encoded=JSON.stringify(frame);bytes+=Buffer.byteLength(encoded);
      if(queue.length>=256||bytes>1024*1024)journal.invalidate('live_follow_buffer_overflow');else queue.push(frame);});
    this.state.holders++;
    try {yield journal.snapshot();
      while(!signal.aborted&&!this.state.closed){
        if(journal.failure)throw new RemoteError('gateway/bad-request',`Projection invalidated: ${journal.failure}; release and manually reopen the full view`,{});
        while(queue.length){const frame=queue.shift()!;bytes-=Buffer.byteLength(JSON.stringify(frame));yield frame;}
        await this.state.poll();await Bun.sleep(25);
      }
    }finally{dispose();this.state.holders--;}
  }
}
