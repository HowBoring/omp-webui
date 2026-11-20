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
  inFlight: number;
  provisional?: "stale" | "unknown";
  settlementReason?: string;
  cancellation?: Promise<InteractionAnswerResult>;
  claimed?: boolean;
  outcome?: InteractionSnapshot["outcomes"][number];
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
const nativeAcknowledgement = "explicit-native-acknowledgement";

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
  #stopOutcome?:InteractionSnapshot["outcomes"][number];
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
      pending:this.#closed ? [] : [...this.#pending.values()].filter(entry => !entry.provisional)
        .map(entry => structuredClone(entry.card)),
      outcomes:structuredClone(this.#outcomes)};
  }
  /** Bind only the identity read back through the public native state response. */
  bindSession(sessionId:string):void {
    this.#scope={kind:"session",sessionId:z.string().min(1).parse(sessionId)};
  }
  /** Host admission for an external waiter: a reserved continuation already owns the settlement. */
  admission(generation:string,id:string,answer:UIAnswer):Promise<InteractionAnswerResult>|undefined {
    const entry=this.#pending.get(id);
    if(this.#closed || generation !== this.generation || !entry || entry.provisional) return undefined;
    if(!entry.answering && !entry.cancellation) return undefined;
    // Exactly one late answer observes the deadline's own cancellation; every other waiter is bounded.
    if(answer.type !== "cancel" && entry.cancellation && !entry.answering && !entry.claimed && entry.settlementReason === "expired") {
      entry.claimed=true;
      return entry.cancellation;
    }
    return this.#overloaded();
  }
  answer(generation:string,id:string,answer:UIAnswer):Promise<InteractionAnswerResult> {
    const entry=this.#pending.get(id);
    if(this.#closed || generation !== this.generation || !entry || entry.provisional) return Promise.resolve({status:"stale"});
    // A reserved continuation already owns the only valid settlement; every later reply fails without
    // creating a second native command, whichever family (answer or cancel) arrives second.
    if(entry.answering || entry.cancellation) return Promise.resolve({status:"stale"});
    const expired=answer.type !== "cancel" && performance.now()>=entry.deadlineMono;
    if(answer.type === "cancel" || expired) {
      if(this.#controls>=16) return this.#overloaded();
      this.#controls++;
      const reason=expired ? "expired" : "explicit-cancel";
      const reply=this.#cancel(id,entry,expired ? {type:"cancel",timedOut:true} : answer,reason);
      if(expired)this.#stop("expired");
      return reply.finally(()=>{this.#controls--;});
    }
    // No browser answer queue: reserve capacity before retaining payloads or creating continuations.
    if(this.#answers>=8) return this.#overloaded();
    this.#answers++;
    entry.answering = this.#send(id, entry, answer, "explicit-answer").finally(() => { delete entry.answering; this.#answers--; });
    return entry.answering;
  }
  #cancel(id:string,entry:Pending,answer:UIAnswer,reason:string):Promise<InteractionAnswerResult> {
    if(entry.cancellation)return entry.cancellation;
    entry.settlementReason ??= reason;
    if(this.#controls>=16)return this.#overloaded();
    // Internal expiry coalesces independently of external caller admission.
    this.#controls++;
    entry.cancellation=this.#send(id,entry,answer,reason).finally(()=>this.#controls--);
    return entry.cancellation;
  }
  #overloaded():Promise<InteractionAnswerResult> {
    return Promise.resolve({status:"overloaded",code:"INTERACTION_ANSWER_LIMIT"});
  }
  async #send(id: string, entry: Pending, answer: UIAnswer, reason: string): Promise<InteractionAnswerResult> {
    ++entry.inFlight;
    try {
      const reply = await this.port.command({ type: "respond_ui", targetId: id, answer });
      const result = interactionReplySchema.parse(reply);
      if (result.status === "stale") {
        entry.provisional = "stale";
        clearTimeout(entry.timer);
      } else if (result.status !== "invalid") this.#retire(id, result.status, result.status === "expired" ? "expired" : reason);
      if (result.status === "expired") this.#stop("native-expired");
      // A delayed acknowledgement remains the native result, even if a notice arrived first.
      return result;
    } catch {
      if (!this.#closed && !entry.provisional) {
        entry.provisional = "unknown";
        clearTimeout(entry.timer);
      }
      return { status: "stale" };
    } finally {
      // A losing stale reply withdraws the card, but another command can carry the decisive Native ACK.
      const status = entry.provisional;
      if (--entry.inFlight === 0 && status && (status === "stale" || !this.#closed)) {
        this.#retire(id, status, status === "stale" ? "native-stale" : "worker-reply-lost");
      }
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
      if (entry.outcome) return { id:entry.outcome.id, status:entry.outcome.status as InteractionCleanupOutcome["status"], reason:entry.outcome.reason };
      const result: InteractionCleanupReply = cancel
        ? await cancel(id) : { status: "unknown", reason: "cleanup-unavailable" };
      const reason = "reason" in result ? result.reason : nativeAcknowledgement;
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
    if(!validRequest(frame)) {this.#stop("invalid-ui-contract");return;}
    const parsed=sourceRequest.safeParse(frame);
    if(!parsed.success) {
      if(typeof frame.id === "string")void this.port.command({type:"respond_ui",targetId:frame.id,answer:{type:"cancel"}}).catch(()=>{});
      this.#stop("invalid-ui-contract");return;
    }
    const request=parsed.data;
    if(request.method === "cancel") {
      const target=z.string().parse(frame.targetId);
      this.#retire(target,frame.reason === "expired" ? "expired" : "cancelled",String(frame.reason ?? "native-cancel"));
      if(frame.reason === "expired") this.#stop("native-expired");
      return;
    }
    if(presentation.has(request.method)) return;
    if(!this.#policy || !interactive.has(request.method) || this.#pending.size>=16 || this.#seen.size>=4096) {
      void this.port.command({type:"respond_ui",targetId:request.id,answer:{type:"cancel"}}).catch(()=>{});this.#stop("ui-not-admitted");return;
    }
    if(this.#seen.has(request.id)) return;
    this.#seen.add(request.id);
    const wait=Math.min(this.#target,request.timeout === undefined ? this.#target : Math.max(0,request.timeout));
    const createdAt=Date.now();
    const card=pendingInteractionSchema.parse({id:request.id,generation:this.generation,family:"extension-ui",scope:this.#scope,
      method:request.method,title:request.title ?? "Native ask",message:request.message,promptStyle:request.promptStyle,secret:request.secret,prefill:request.prefill,options:request.options,questions:request.questions,
      createdAt,deadline:createdAt+wait,reason:"explicit-answer-required"});
    const entry:Pending={deadlineMono:performance.now()+wait,card,inFlight:0,timer:setTimeout(()=>{
      // A refresh/disconnect/snapshot never constructs a new timer or extends this deadline.
      void this.#cancel(card.id,entry,{type:"cancel",timedOut:true},"expired");
      this.#stop("expired");
    },wait)};
    this.#pending.set(card.id,entry);
  }
  #retire(id:string,status:InteractionCleanupOutcome["status"],reason:string):void {
    const entry=this.#pending.get(id);if(!entry)return;
    const settlement = status === "stale" || status === "unknown" ? undefined : entry.settlementReason;
    entry.outcome = { id, status, reason: settlement ?? reason, stop: "none" };
    clearTimeout(entry.timer);this.#pending.delete(id);
    this.#outcomes.push(entry.outcome);
    if (this.#outcomes.length > 64) this.#outcomes.shift();
  }
  /** One recorded Stop request per worker; later causes cannot rewrite the first reason. */
  #stop(reason:string):void {
    if(this.#stopOutcome || this.#closed)return;
    const outcome:InteractionSnapshot["outcomes"][number]={id:"worker-stop",status:"stopping",reason,stop:"requested"};
    this.#stopOutcome=outcome;this.#outcomes.push(outcome);
    if(this.#outcomes.length > 64)this.#outcomes.shift();
    void this.port.command({type:"abort"}).then(()=>{outcome.stop="acknowledged";},()=>{outcome.stop="failed";});
  }
}
