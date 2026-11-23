import { MAX_RPC_FRAME_BYTES, MAX_RPC_REASSEMBLED_BYTES } from '@oh-my-pi/pi-coding-agent/modes/rpc/rpc-frame';
import { BoundedStdioTransport, type ProcessSelection } from './stdio-transport.ts';
import { HistoryClient } from '../contracts/generated/history-client.ts';
import { validateHistoryCommand } from '../contracts/generated/history.generated.ts';
import validateCommand from '../contracts/generated/live-command.js';
import validateNotification from '../contracts/generated/live-notification.js';
import validateState from '../contracts/generated/live-state.js';
import type { SessionState } from '../contracts/generated/omp-wire.ts';

/** Fixed isolated acceptance command set. No browser RPC tunnel or configurable worker launch. */
export class LiveTransport {
  private constructor(private readonly core: BoundedStdioTransport) {}
  static async open(selection: ProcessSelection): Promise<LiveTransport> {
    return new LiveTransport(await BoundedStdioTransport.open(selection,{
      validateCommand:value=>validateHistoryCommand(value)||validateCommand(value),
      acceptReady:frame=>frame.protocolVersion===1&&frame.supportedProtocolVersions?.includes(2)===true
        &&frame.maxFrameBytes===MAX_RPC_FRAME_BYTES&&frame.maxReassembledFrameBytes===MAX_RPC_REASSEMBLED_BYTES,
      remoteError:error=>error!==undefined&&/^history_[a-z_]+$/.test(error)?error:'RPC_REMOTE_REJECTED',
      physicalFrameBytes:MAX_RPC_FRAME_BYTES,allowChunks:true,commandBytes:16384,pendingLimit:32,
      defaultTimeoutMs:10000,notification:frame=>validateNotification(frame),
    }));
  }
  readonly history=new HistoryClient(command=>this.core.request(command));
  async state(): Promise<SessionState> {
    const value=await this.core.request({id:crypto.randomUUID(),type:'get_state'});
    if(!validateState(value))throw Error('LIVE_STATE_SCHEMA');return value as SessionState;
  }
  async prompt():Promise<void> {
    const state=await this.state();
    if(state.model?.provider!=='s0-controlled'||state.model.id!=='deterministic-live')throw Error('LIVE_PROVIDER_NOT_SELECTED');
    await this.core.request({id:crypto.randomUUID(),type:'prompt',message:'controlled fixture input'});
  }
  /** The stock Continue control submits the native `/retry` prompt, never a second user turn. */
  async retry():Promise<void>{
    const state=await this.state();
    if(state.model?.provider!=='s0-controlled'||state.model.id!=='deterministic-live')throw Error('LIVE_PROVIDER_NOT_SELECTED');
    await this.core.request({id:crypto.randomUUID(),type:'prompt',message:'/retry'});
  }
  async filter():Promise<void>{await this.core.request({id:crypto.randomUUID(),type:'set_event_filter',events:[]});}
  async stop():Promise<void>{await this.core.request({id:crypto.randomUUID(),type:'abort'});}
  async navigate(targetId:string):Promise<void>{await this.core.request({id:crypto.randomUUID(),type:'navigate_tree',entryId:targetId});}
  close(){return this.core.close();}
}
