/** S0 mode policy over the shared bounded process carrier. No raw browser/native sender. */
import { z } from "zod";
import { MAX_RPC_FRAME_BYTES,MAX_RPC_REASSEMBLED_BYTES } from "@oh-my-pi/pi-coding-agent/modes/rpc/rpc-frame";
import { BoundedStdioTransport,type ProcessSelection } from "../../packages/compatibility/stdio-transport.ts";
import validCommand from "../../packages/contracts/generated/interaction-command.js";
import validPolicy from "../../packages/contracts/generated/interaction-policy.js";
import validRequest from "../../packages/contracts/generated/interaction-request.js";
import validNotification from "../../packages/contracts/generated/interaction-notification.js";

export const frameSchema=z.object({type:z.string(),id:z.string().optional()}).catchall(z.unknown());
export type Frame=z.infer<typeof frameSchema>;
const id=z.string().min(1);
const fixtureCommands=z.discriminatedUnion("type",[
  z.strictObject({id,type:z.literal("get_state")}),z.strictObject({id,type:z.literal("abort")}),
  z.strictObject({id,type:z.literal("set_ask_dialog"),enabled:z.boolean()}),
  z.strictObject({id,type:z.literal("prompt"),message:z.string().max(8192)}),
]);

export async function openInteractionPort(selection:ProcessSelection) {
  const frames:Frame[]=[];
  const subscribers=new Set<(frame:Frame)=>void>();
  const commands:{type:string;outcome:"acknowledged"|"rejected"}[]=[];
  let bytes=0;let serial=0;let retired=false;
  const record=(value:object)=>{
    if(retired)return;
    const frame=frameSchema.parse(value);bytes+=Buffer.byteLength(JSON.stringify(frame));
    if(frames.length>=2048 || bytes>16*1024*1024)throw new Error("RPC_FIXTURE_FRAME_BUDGET");
    frames.push(frame);for(const listener of subscribers)listener(frame);
  };
  const transport=await BoundedStdioTransport.open({...selection,readyTimeoutMs:10_000},{
    validateCommand:value=>validCommand(value) || fixtureCommands.safeParse(value).success,
    acceptReady:frame=>{
      if(frame.protocolVersion !== 1 || !frame.supportedProtocolVersions?.includes(2) ||
        frame.maxFrameBytes !== MAX_RPC_FRAME_BYTES || frame.maxReassembledFrameBytes !== MAX_RPC_REASSEMBLED_BYTES ||
        !validPolicy(frame.interactionPolicy))return false;
      record(frame);return true;
    },
    remoteError:()=>"RPC_NATIVE_REJECTED",physicalFrameBytes:MAX_RPC_FRAME_BYTES,allowChunks:true,
    commandBytes:32768,queuedBytes:1048576,pendingLimit:32,settledLimit:256,stderrBytes:65536,
    notification:frame=>{
      if(!validRequest(frame) && !validNotification(frame))return false;
      record(frame);return true; // A retired generation still validates/drains its known EOF tail.
    },
  });
  void transport.exited.then(()=>{retired=true;});
  const subscribe=(listener:(frame:Frame)=>void)=>{
    if(subscribers.size>=64)throw new Error("RPC_SUBSCRIBER_LIMIT");
    subscribers.add(listener);return()=>{subscribers.delete(listener);};
  };
  return {frames,exited:transport.exited,subscribe,
    async command(fields:object):Promise<unknown> {
      if(retired)throw new Error("RPC_WORKER_RETIRED");
      const type=z.object({type:z.string()}).parse(fields).type;
      const remember=(outcome:"acknowledged"|"rejected")=>{commands.push({type,outcome});if(commands.length>256)commands.shift();};
      try {const value=await transport.request({...fields,id:`interaction-${++serial}`,type});remember("acknowledged");return value;}
      catch(error){remember("rejected");throw error;}
    },
    async wait(predicate:(frame:Frame)=>boolean,after=0):Promise<Frame> {
      const found=frames.slice(after).find(predicate);if(found)return found;
      const done=Promise.withResolvers<Frame>();
      const unsubscribe=subscribe(frame=>{if(predicate(frame))done.resolve(frame);});
      const timer=setTimeout(()=>done.reject(new Error("RPC_FRAME_WAIT_TIMEOUT")),10_000);
      void transport.exited.then(code=>done.reject(new Error(`RPC_WORKER_EXITED_${code}`)));
      try{return await done.promise;}finally{clearTimeout(timer);unsubscribe();}
    },
    async close() {
      retired=true;
      const result=await transport.close();
      return {...result,stdoutDrained:result.protocolFailure === undefined,commands};
    },
  };
}
