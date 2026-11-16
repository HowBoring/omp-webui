/** Bounded synthetic stdio fixture carrier; never a browser RPC tunnel or product worker supervisor. */
import type { Subprocess } from "bun";
import { z } from "zod";
import { PhysicalFrames } from "../../packages/compatibility/framing.ts";
import { validReady,validResponse } from "../../packages/contracts/preflight.ts";
import validPolicy from "../../packages/contracts/generated/interaction-policy.js";

export const frameSchema=z.object({type:z.string(),id:z.string().optional()}).catchall(z.unknown());
export type Frame=z.infer<typeof frameSchema>;
interface Pending {type:string;resolve(frame:Frame):void;reject(error:Error):void;timer:Timer}
export interface FixtureExit {code:number;stdoutDrained:boolean;forced:boolean;stderrBytes:number;
  networkEntries:string[];networkDenials:number}
export class FixtureTransport {
  readonly frames:Frame[]=[];
  readonly exited:Promise<number>;
  #subscribers=new Set<(frame:Frame)=>void>();
  #pending=new Map<string,Pending>();
  #expired=new Set<string>();
  #physical=new PhysicalFrames();
  #reader:Promise<void>;
  #stderr:Promise<void>;
  #ready=false;
  #readyTimer:Timer|undefined;
  #serial=0;
  #frameBytes=0;
  #stderrBytes=0;
  #networkDenials=0;
  #networkEntries=new Set<string>();
  #finished=false;
  #admitting=true;
  #fault:Error|undefined;
  #forced=false;
  #queuedWrites=0;
  #queuedBytes=0;
  #writeQueue=Promise.resolve();
  #closing:Promise<FixtureExit>|undefined;
  constructor(readonly child:Subprocess<"pipe","pipe","pipe">,readProtocol=true) {
    this.exited=child.exited;
    this.#reader=readProtocol ? this.#read() : Promise.resolve();
    this.#stderr=this.#readStderr();
    void this.#reader.catch(error=>this.#fail(error instanceof Error ? error : new Error("RPC_PROTOCOL")));
    void this.#stderr.catch(()=>this.#fail(new Error("RPC_STDERR_LIMIT")));
    if(readProtocol)this.#readyTimer=setTimeout(()=>this.#fail(new Error("RPC_READY_TIMEOUT")),10_000);
    void child.exited.then(()=>{
      clearTimeout(this.#readyTimer);
      for(const entry of this.#pending.values()){clearTimeout(entry.timer);entry.reject(new Error("RPC_WORKER_EXITED"));}
      this.#pending.clear();
    });
  }
  subscribe(listener:(frame:Frame)=>void):()=>void {
    if(this.#subscribers.size>=64)throw new Error("RPC_SUBSCRIBER_LIMIT");
    this.#subscribers.add(listener);return()=>{this.#subscribers.delete(listener);};
  }
  async wait(predicate:(frame:Frame)=>boolean,after=0):Promise<Frame> {
    const found=this.frames.slice(after).find(predicate);if(found)return found;
    if(this.#fault)throw this.#fault;
    const done=Promise.withResolvers<Frame>();
    const unsubscribe=this.subscribe(frame=>{if(predicate(frame))done.resolve(frame);});
    const timer=setTimeout(()=>done.reject(new Error("RPC_FRAME_WAIT_TIMEOUT")),10_000);
    void this.exited.then(code=>done.reject(new Error(`RPC_WORKER_EXITED_${code}`)));
    try{return await done.promise;}finally{clearTimeout(timer);unsubscribe();}
  }
  /** Raw native fault-frame seam, used only by authored fixture tests. */
  send(frame:object):void {void this.#enqueue(frame).catch(error=>this.#fail(error));}
  command(fields:object):Promise<Frame> {
    if(!this.#admitting || this.#fault)return Promise.reject(this.#fault ?? new Error("RPC_CLOSED"));
    if(this.#pending.size>=32)return Promise.reject(new Error("RPC_PENDING_LIMIT"));
    const type=z.object({type:z.string()}).parse(fields).type;
    const id=`interaction-${++this.#serial}`;
    const done=Promise.withResolvers<Frame>();
    const timer=setTimeout(()=>{
      this.#pending.delete(id);this.#expired.add(id);
      if(this.#expired.size>64)this.#expired.delete(this.#expired.values().next().value!);
      done.reject(new Error("RPC_REQUEST_TIMEOUT"));
    },3000);
    this.#pending.set(id,{type,resolve:done.resolve,reject:done.reject,timer});
    void this.#enqueue({...fields,id},id).catch(error=>this.#fail(error));
    return done.promise;
  }
  #enqueue(frame:object,id?:string):Promise<void> {
    const line=JSON.stringify(frame)+"\n";const bytes=Buffer.byteLength(line);
    if(!this.#admitting || bytes>131072 || this.#queuedWrites>=32 || this.#queuedBytes+bytes>1048576) {
      return Promise.reject(new Error("RPC_WRITE_LIMIT"));
    }
    this.#queuedWrites++;this.#queuedBytes+=bytes;
    this.#writeQueue=this.#writeQueue.then(async()=>{
      try {
        // Independent request deadlines remove this ID even while an earlier flush is blocked.
        if(id !== undefined && !this.#pending.has(id))return;
        this.child.stdin.write(line);await this.child.stdin.flush();
      }finally{this.#queuedWrites--;this.#queuedBytes-=bytes;}
    });
    return this.#writeQueue;
  }
  async #read():Promise<void> {
    for await(const chunk of this.child.stdout)for(const value of this.#physical.push(chunk)) {
      const frame=frameSchema.parse(value);
      if(frame.type === "ready") {
        if(this.#ready || !validReady(frame) || !validPolicy(frame.interactionPolicy))throw new Error("RPC_READY_SCHEMA");
        this.#ready=true;clearTimeout(this.#readyTimer);
      }else if(!this.#ready)throw new Error("RPC_BEFORE_READY");
      if(frame.type === "response")this.#response(frame);
      this.#frameBytes+=Buffer.byteLength(JSON.stringify(frame));
      if(this.frames.length>=2048 || this.#frameBytes>16*1024*1024)throw new Error("RPC_FIXTURE_FRAME_BUDGET");
      this.frames.push(frame);for(const listener of this.#subscribers)listener(frame);
    }
    this.#physical.finish();this.#finished=true;
    if(this.#admitting)throw new Error("RPC_UNEXPECTED_EOF");
  }
  #response(frame:Frame):void {
    if(!validResponse(frame) || !frame.id)throw new Error("RPC_RESPONSE_SCHEMA");
    const pending=this.#pending.get(frame.id);
    if(!pending){if(this.#expired.has(frame.id))return;throw new Error("RPC_RESPONSE_CORRELATION");}
    if(frame.command !== pending.type)throw new Error("RPC_RESPONSE_COMMAND");
    clearTimeout(pending.timer);this.#pending.delete(frame.id);
    if(frame.command === "negotiate_protocol" && frame.success === true)this.#physical.negotiate(2);
    pending.resolve(frame);
  }
  async #readStderr():Promise<void> {
    const decoder=new TextDecoder();let tail="";
    for await(const bytes of this.child.stderr) {
      this.#stderrBytes+=bytes.length;if(this.#stderrBytes>65536)throw new Error("RPC_STDERR_LIMIT");
      tail+=decoder.decode(bytes,{stream:true});
      const lines=tail.split("\n");tail=lines.pop() ?? "";
      for(const line of lines)if(/^S0_FIXTURE_NETWORK_DENIED:[a-zA-Z0-9.]+$/.test(line)) {
        this.#networkDenials++;this.#networkEntries.add(line);
      }
    }
  }
  #fail(error:Error):void {
    this.#fault ??=error;this.#admitting=false;clearTimeout(this.#readyTimer);
    for(const request of this.#pending.values()){clearTimeout(request.timer);request.reject(error);}
    this.#pending.clear();
    if(!this.#closing && this.child.exitCode === null){this.#forced=true;this.child.kill("SIGTERM");}
  }
  close():Promise<FixtureExit> {return this.#closing ??=this.#close();}
  async #close():Promise<FixtureExit> {
    this.#admitting=false;clearTimeout(this.#readyTimer);
    for(const pending of this.#pending.values()){clearTimeout(pending.timer);pending.reject(new Error("RPC_CLOSED"));}
    this.#pending.clear();this.child.stdin.end();
    let killTimer:Timer|undefined;
    const timer=setTimeout(()=>{this.#forced=true;this.child.kill("SIGTERM");
      killTimer=setTimeout(()=>this.child.kill("SIGKILL"),500);},3000);
    try {
      const code=await this.exited;await this.#reader;await this.#stderr;
      return {code,stdoutDrained:this.#finished,forced:this.#forced,stderrBytes:this.#stderrBytes,
        networkEntries:[...this.#networkEntries],networkDenials:this.#networkDenials};
    }finally{clearTimeout(timer);clearTimeout(killTimer);}
  }
}
