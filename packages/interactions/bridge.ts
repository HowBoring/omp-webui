import { randomUUID } from "node:crypto";
import { z } from "zod";
import validPolicy from "../contracts/generated/interaction-policy.js";
import validRequest from "../contracts/generated/interaction-request.js";
import { interactionReplySchema, pendingInteractionSchema, type UIAnswer,
  type PendingInteraction, type InteractionSnapshot, type InteractionAnswerResult,
  type InteractionReply } from "../contracts/interactions.ts";

interface NativeFrame { type:string; [key:string]:unknown }
export interface InteractionPort {
  readonly frames:readonly NativeFrame[];
  readonly exited?:Promise<number>;
  subscribe(listener:(frame:NativeFrame)=>void):()=>void;
  command(command:object):Promise<unknown>;
}
interface Pending {
  deadlineMono: number;
  card: PendingInteraction;
  timer: Timer;
  answering?: Promise<InteractionAnswerResult>;
  controlWaiting: boolean;
  cancellation?: Promise<InteractionAnswerResult>;
  outcome?: InteractionCleanupOutcome;
}
type CleanupFailure = "cleanup-unavailable" | "cleanup-cutoff" | "cleanup-request-failed"
  | "cleanup-reply-lost" | "cleanup-reply-invalid";
export type InteractionCleanupReply = InteractionReply | { status: "unknown"; reason: CleanupFailure };
export interface InteractionCleanupOutcome {
  readonly id: string;
  readonly status: InteractionCleanupReply["status"];
  readonly reason: string;
}
type CancelTracked = (id: string) => Promise<InteractionCleanupReply>;

const interactive=new Set(["ask","select","input","editor","confirm"]);
const presentation=new Set(["notify","setStatus","setWidget","setTitle","set_editor_text","open_url"]);
const sourceRequest=z.object({id:z.string(),method:z.string(),message:z.string().max(32768).optional(),promptStyle:z.boolean().optional(),secret:z.boolean().optional(),prefill:z.string().max(65536).optional(),title:z.string().max(32768).optional(),timeout:z.number().optional(),
  options:z.array(z.string().max(1024)).max(256).optional(),questions:z.array(z.object({id:z.string(),question:z.string().max(32768),
    options:z.array(z.object({label:z.string().max(1024)})).max(256),multi:z.boolean().optional()})).max(64).optional()});

/**
 * Ephemeral S0 adapter around the public native interaction contract. All pages
 * see the same records and original monotonic deadlines; no pending UI survives
 * worker replacement. Product authority/admission remains a separate blocked gate.
 */
export class InteractionBridge {
  readonly generation=randomUUID();
  #answers=0;
  #controls=0;
  #controlWaiters=0;
  #aborting=false;
  #policy=false;
  #closed=false;
  #seen=new Set<string>();
  #pending=new Map<string,Pending>();
  #outcomes:InteractionSnapshot["outcomes"]=[];
  #scope:PendingInteraction["scope"]={kind:"startup"};
  #dispose:()=>void;
  #target:number;
  constructor(readonly port:InteractionPort, options:{waitMs?:number}={}) {
    this.#target=options.waitMs ?? 30*60*1000;
    if(!Number.isFinite(this.#target) || this.#target<=0 || this.#target>86_400_000) throw new Error("INVALID_INTERACTION_WAIT");
    this.#dispose=port.subscribe(frame=>this.#receive(frame));
    try {
      for (const frame of port.frames) this.#receive(frame);
    } catch (error) {
      this.dispose();
      throw error;
    }
    void port.exited?.then(()=>this.dispose(),()=>this.dispose());
  }
  snapshot():InteractionSnapshot {
    return {stage:"S0-isolated-interactions",sessionAdmission:"blocked",generation:this.generation,
      policyVerified:this.#policy,
      pending:this.#closed ? [] : [...this.#pending.values()].map(entry=>structuredClone(entry.card)),
      outcomes:structuredClone(this.#outcomes)};
  }
  /** Bind only the identity read back through the public native state response. */
  bindSession(sessionId:string):void {
    this.#scope={kind:"session",sessionId:z.string().min(1).parse(sessionId)};
  }
  answer(generation:string,id:string,answer:UIAnswer):Promise<InteractionAnswerResult> {
    const entry=this.#pending.get(id);
    if(this.#closed || generation !== this.generation || !entry) return Promise.resolve({status:"stale"});
    const expired=answer.type !== "cancel" && performance.now()>=entry.deadlineMono;
    if(answer.type === "cancel" || expired) {
      // Bound retained Remote/HTTP callers independently of the coalesced native command.
      if(entry.controlWaiting || this.#controlWaiters>=16) {
        if(expired) {void this.#cancel(id,entry,{type:"cancel",timedOut:true});this.#stop();}
        return this.#overloaded();
      }
      entry.controlWaiting=true;this.#controlWaiters++;
      const reply=this.#cancel(id,entry,expired ? {type:"cancel",timedOut:true} : answer);
      if(expired)this.#stop();
      return reply.finally(()=>{entry.controlWaiting=false;this.#controlWaiters--;});
    }
    // No browser answer queue: reserve capacity before retaining payloads or creating continuations.
    if(entry.answering || entry.cancellation || this.#answers>=8) return this.#overloaded();
    this.#answers++;
    entry.answering = this.#send(id, answer).finally(() => { delete entry.answering; this.#answers--; });
    return entry.answering;
  }
  #cancel(id:string,entry:Pending,answer:UIAnswer):Promise<InteractionAnswerResult> {
    if(entry.cancellation)return entry.cancellation;
    if(this.#controls>=16)return this.#overloaded();
    // Internal expiry coalesces independently of external caller admission.
    this.#controls++;
    entry.cancellation=this.#send(id,answer).finally(()=>{this.#controls--;});
    return entry.cancellation;
  }
  #overloaded():Promise<InteractionAnswerResult> {
    return Promise.resolve({status:"overloaded",code:"INTERACTION_ANSWER_LIMIT"});
  }
  async #send(id:string,answer:UIAnswer):Promise<InteractionAnswerResult> {
    try {
      const reply=await this.port.command({type:"respond_ui",targetId:id,answer});
      const result=interactionReplySchema.parse(reply);
      if(result.status !== "invalid") this.#retire(id,result.status,"explicit-native-acknowledgement");
      if(result.status === "expired") this.#stop();
      // A delayed acknowledgement remains the native result, even if a notice arrived first.
      return result;
    } catch {
      if (!this.#closed) this.#retire(id, "unknown", "worker-reply-lost");
      return { status: "stale" };
    }
  }
  /** Withdraw answer rights synchronously. The caller has already fenced unresolved regular RPCs. */
  retireForCleanup(cancel?: CancelTracked): Promise<InteractionCleanupOutcome[]> {
    if (this.#closed) return Promise.resolve([]);
    this.#close();
    return Promise.all([...this.#pending].map(async ([id, entry]) => {
      clearTimeout(entry.timer);
      // An ACK correlated before the transport fence may still be settling the regular promise.
      // Fenced requests reject without retiring the card. Only a recorded outcome can skip cleanup.
      if (entry.answering || entry.cancellation) await Promise.all([entry.answering, entry.cancellation]);
      if (entry.outcome) return { ...entry.outcome };
      const result: InteractionCleanupReply = cancel
        ? await cancel(id) : { status: "unknown", reason: "cleanup-unavailable" };
      const reason = "reason" in result ? result.reason : "explicit-native-acknowledgement";
      this.#retire(id, result.status, reason);
      return { id, status: result.status, reason };
    }));
  }
  #close(): void {
    this.#closed = true;
    this.#policy = false;
    this.#dispose();
  }
  dispose():void {
    if (this.#closed) return;
    this.#close();
    for(const [id] of this.#pending) this.#retire(id,"unknown","worker-ended");
  }
  #receive(frame:NativeFrame):void {
    if(this.#closed)return;
    if(frame.type === "ready") {this.#policy=validPolicy(frame.interactionPolicy);return;}
    if(frame.type !== "extension_ui_request") return; // Tool/URI IDs never enter this map.
    if(!validRequest(frame)) {this.#stop();return;}
    const parsed=sourceRequest.safeParse(frame);
    if(!parsed.success) {
      if(typeof frame.id === "string")void this.port.command({type:"respond_ui",targetId:frame.id,answer:{type:"cancel"}}).catch(()=>{});
      this.#stop();return;
    }
    const request=parsed.data;
    if(request.method === "cancel") {
      const target=z.string().parse(frame.targetId);
      this.#retire(target,frame.reason === "expired" ? "expired" : "cancelled",String(frame.reason ?? "native-cancel"));
      if(frame.reason === "expired") this.#stop();
      return;
    }
    if(presentation.has(request.method)) return;
    if(!this.#policy || !interactive.has(request.method) || this.#pending.size>=16 || this.#seen.size>=4096) {
      void this.port.command({type:"respond_ui",targetId:request.id,answer:{type:"cancel"}}).catch(()=>{});this.#stop();return;
    }
    if(this.#seen.has(request.id)) return;
    this.#seen.add(request.id);
    const wait=Math.min(this.#target,request.timeout === undefined ? this.#target : Math.max(0,request.timeout));
    const createdAt=Date.now();
    const card=pendingInteractionSchema.parse({id:request.id,generation:this.generation,family:"extension-ui",scope:this.#scope,
      method:request.method,title:request.title ?? "Native ask",message:request.message,promptStyle:request.promptStyle,secret:request.secret,prefill:request.prefill,options:request.options,questions:request.questions,
      createdAt,deadline:createdAt+wait,reason:"explicit-answer-required"});
    const entry:Pending={deadlineMono:performance.now()+wait,card,controlWaiting:false,timer:setTimeout(()=>{
      // A refresh/disconnect/snapshot never constructs a new timer or extends this deadline.
      void this.#cancel(card.id,entry,{type:"cancel",timedOut:true});
      this.#stop();
    },wait)};
    this.#pending.set(card.id,entry);
  }
  #retire(id:string,status:InteractionCleanupOutcome["status"],reason:string):void {
    const entry=this.#pending.get(id);if(!entry)return;
    entry.outcome = { id, status, reason };
    clearTimeout(entry.timer);this.#pending.delete(id);
    this.#outcomes.push(entry.outcome);
    if (this.#outcomes.length > 64) this.#outcomes.shift();
  }
  #stop():void {
    if(this.#aborting || this.#closed)return;
    this.#aborting=true;
    void this.port.command({type:"abort"}).catch(()=>{}).finally(()=>{this.#aborting=false;});
  }
}
