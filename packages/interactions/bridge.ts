import { randomUUID } from "node:crypto";
import { z } from "zod";
import validPolicy from "../contracts/generated/interaction-policy.js";
import validRequest from "../contracts/generated/interaction-request.js";
import { interactionReplySchema, pendingInteractionSchema, type UIAnswer,
  type PendingInteraction, type InteractionSnapshot, type InteractionReply } from "../contracts/interactions.ts";

interface NativeFrame { type:string; [key:string]:unknown }
export interface InteractionPort {
  readonly frames:readonly NativeFrame[];
  readonly exited?:Promise<number>;
  subscribe(listener:(frame:NativeFrame)=>void):()=>void;
  command(command:object):Promise<NativeFrame>;
}
interface Pending { deadlineMono:number; card:PendingInteraction; timer:Timer; tail:Promise<void>; retired:boolean }
const interactive=new Set(["ask","select","input","editor","confirm"]);
const presentation=new Set(["notify","setStatus","setWidget","setTitle","set_editor_text","open_url"]);
const sourceRequest=z.object({id:z.string(),method:z.string(),title:z.string().optional(),timeout:z.number().optional(),
  options:z.array(z.string()).optional(),questions:z.array(z.object({id:z.string(),question:z.string(),
    options:z.array(z.object({label:z.string()})),multi:z.boolean().optional()})).optional()});

/**
 * Ephemeral S0 adapter around the public native interaction contract. All pages
 * see the same records and original monotonic deadlines; no pending UI survives
 * worker replacement. Product authority/admission remains a separate blocked gate.
 */
export class InteractionBridge {
  readonly generation=randomUUID();
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
    for(const frame of port.frames) this.#receive(frame);
    void port.exited?.then(()=>this.dispose(),()=>this.dispose());
  }
  snapshot():InteractionSnapshot {
    return {stage:"S0-isolated-interactions",sessionAdmission:"blocked",generation:this.generation,
      policyVerified:this.#policy,pending:[...this.#pending.values()].map(entry=>structuredClone(entry.card)),
      outcomes:structuredClone(this.#outcomes)};
  }
  /** Bind only the identity read back through the public native state response. */
  bindSession(sessionId:string):void {
    this.#scope={kind:"session",sessionId:z.string().min(1).parse(sessionId)};
  }
  async answer(generation:string,id:string,answer:UIAnswer):Promise<InteractionReply> {
    const entry=this.#pending.get(id);
    if(generation !== this.generation || !entry || entry.retired) return {status:"stale"};
    const settled=Promise.withResolvers<InteractionReply>();
    entry.tail=entry.tail.then(async()=>{
      if(entry.retired) {settled.resolve({status:"stale"});return;}
      try {
        const effectiveAnswer=performance.now()>=entry.deadlineMono ? {type:"cancel" as const,timedOut:true} : answer;
        const reply=await this.port.command({type:"respond_ui",targetId:id,answer:effectiveAnswer});
        const result=interactionReplySchema.parse(reply.data);
        if(result.status !== "invalid") this.#retire(id,result.status,"explicit-native-acknowledgement");
        if(result.status === "expired") this.#stop();
        settled.resolve(result);
      } catch {
        this.#retire(id,"unknown","worker-reply-lost");settled.resolve({status:"stale"});
      }
    });
    return settled.promise;
  }
  dispose():void {
    this.#closed=true;this.#policy=false;this.#dispose();
    for(const [id] of this.#pending) this.#retire(id,"unknown","worker-ended");
  }
  #receive(frame:NativeFrame):void {
    if(this.#closed)return;
    if(frame.type === "ready") {this.#policy=validPolicy(frame.interactionPolicy);return;}
    if(frame.type !== "extension_ui_request") return; // Tool/URI IDs never enter this map.
    if(!validRequest(frame)) {this.#stop();return;}
    const request=sourceRequest.parse(frame);
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
      method:request.method,title:request.title ?? "Native ask",options:request.options,questions:request.questions,
      createdAt,deadline:createdAt+wait,reason:"explicit-answer-required"});
    const entry:Pending={deadlineMono:performance.now()+wait,card,retired:false,tail:Promise.resolve(),timer:setTimeout(()=>{
      // A refresh/disconnect/snapshot never constructs a new timer or extends this deadline.
      void this.answer(this.generation,card.id,{type:"cancel",timedOut:true}).finally(()=>this.#stop());
    },wait)};
    this.#pending.set(card.id,entry);
  }
  #retire(id:string,status:string,reason:string):void {
    const entry=this.#pending.get(id);if(!entry || entry.retired)return;
    entry.retired=true;clearTimeout(entry.timer);this.#pending.delete(id);
    this.#outcomes.push({id,status,reason});if(this.#outcomes.length>64)this.#outcomes.shift();
  }
  #stop():void {void this.port.command({type:"abort"}).catch(()=>{});}
}
