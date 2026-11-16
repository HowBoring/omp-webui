/** One bounded native child, shared by history and the accepted Interaction bridge. */
import {z} from 'zod';
import Ajv2020 from 'ajv/dist/2020.js';
import {MAX_RPC_FRAME_BYTES,MAX_RPC_REASSEMBLED_BYTES} from '@oh-my-pi/pi-coding-agent/modes/rpc/rpc-frame';
import {BoundedStdioTransport,type ProcessSelection} from '../../packages/compatibility/stdio-transport.ts';
import {HistoryClient} from '../../packages/contracts/generated/history-client.ts';
import {validateHistoryCommand} from '../../packages/contracts/generated/history.generated.ts';
import validLiveCommand from '../../packages/contracts/generated/live-command.js';
import validLiveNotification from '../../packages/contracts/generated/live-notification.js';
import validState from '../../packages/contracts/generated/live-state.js';
import validInteractionCommand from '../../packages/contracts/generated/interaction-command.js';
import validPolicy from '../../packages/contracts/generated/interaction-policy.js';
import validUI from '../../packages/contracts/generated/interaction-request.js';
import {makeCommandSchemas} from '../../scripts/command-schemas.ts';
import schema from '../../packages/contracts/generated/omp.schema.json';
import type {SessionState,RpcWireCommands} from '../../packages/contracts/generated/omp-wire.ts';

type Frame={type:string;[key:string]:unknown};
// The only additional fixture operation is derived from the frozen public native schema.
const ajv=new Ajv2020({strict:false});ajv.addSchema(schema);
const modelCommand=ajv.compile({anyOf:makeCommandSchemas(schema,['set_model'])});
export async function openSharedNative(selection:ProcessSelection){
  const frames:Frame[]=[];const listeners=new Set<(frame:Frame)=>void>();let bytes=0;
  const record=(raw:unknown)=>{const frame=z.object({type:z.string()}).catchall(z.unknown()).parse(raw);bytes+=Buffer.byteLength(JSON.stringify(frame));
    if(frames.length>=4096||bytes>16*1024*1024)throw Error('projection_native_frame_budget');
    frames.push(frame);for(const listener of listeners)listener(frame);};
  const core=await BoundedStdioTransport.open(selection,{
    validateCommand:value=>validateHistoryCommand(value)||validLiveCommand(value)||validInteractionCommand(value)||modelCommand(value),
    acceptReady:frame=>{if(frame.protocolVersion!==1||!frame.supportedProtocolVersions?.includes(2)
      ||frame.maxFrameBytes!==MAX_RPC_FRAME_BYTES||frame.maxReassembledFrameBytes!==MAX_RPC_REASSEMBLED_BYTES
      ||!validPolicy(frame.interactionPolicy))return false;record(frame);return true;},
    remoteError:error=>error&&/^history_[a-z_]+$/.test(error)?error:'projection_native_rejected',
    physicalFrameBytes:MAX_RPC_FRAME_BYTES,allowChunks:true,commandBytes:16384,pendingLimit:32,
    defaultTimeoutMs:10000,notification:frame=>{if(!validLiveNotification(frame)&&!validUI(frame))return false;record(frame);return true;},
  });
  const request=<K extends keyof RpcWireCommands>(type:K,params:RpcWireCommands[K]['params'])=>core.request({id:crypto.randomUUID(),type,...params});
  let historyGate: ReturnType<typeof Promise.withResolvers<void>> | undefined;
  let historyWaiting = 0;
  const history = new HistoryClient(async command => {
    if(command.type === 'history_snapshot_open' && historyGate){
      historyWaiting++;
      try{await historyGate.promise;}finally{historyWaiting--;}
    }
    return core.request(command);
  });
  return {frames,exited:core.exited,history,
    holdHistory(){if(historyGate)throw Error('history_gate_already_held');historyGate=Promise.withResolvers<void>();void historyGate.promise.catch(()=>{});},
    releaseHistory(fail=false){const gate=historyGate;historyGate=undefined;if(fail)gate?.reject(Error('controlled_native_history_failure'));else gate?.resolve();},
    historyFault(){return {held:historyGate!==undefined,waiting:historyWaiting};},
    subscribe(listener:(frame:Frame)=>void){if(listeners.size>=16)throw Error('projection_native_listener_budget');listeners.add(listener);return()=>{listeners.delete(listener);};},
    command(fields:object){const value=z.object({type:z.string()}).catchall(z.unknown()).parse(fields);return core.request({...value,id:crypto.randomUUID()});},
    async state():Promise<SessionState>{const value=await request('get_state',undefined);if(!validState(value))throw Error('projection_native_state_schema');return value as SessionState;},
    prompt(message:string){return request('prompt',{message});},
    model(modelId='second'){return request('set_model',{provider:'s0-projection',modelId});},
    navigate(entryId:string){return request('navigate_tree',{entryId});},
    close(){return core.close();},
  };
}
