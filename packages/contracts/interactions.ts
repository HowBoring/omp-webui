import { z } from "zod";
import { createTypertRemoteInfo } from "@deepseek-ai/dsh-typert-protocol/remote-info";
import type { RemoteResult } from "@deepseek-ai/dsh-typert-protocol";
import type { TypertContribution } from "@deepseek-ai/dsh-typert-registry";

const id=z.string().min(1).max(128);
export const uiAnswerSchema=z.discriminatedUnion("type",[
  z.strictObject({type:z.literal("value"),value:z.string().max(65_536)}),
  z.strictObject({type:z.literal("confirm"),confirmed:z.boolean()}),
  z.strictObject({type:z.literal("cancel"),timedOut:z.boolean().optional()}),
  z.strictObject({type:z.literal("ask"),answers:z.array(z.strictObject({id,selectedOptions:z.array(z.string()).max(256),
    customInput:z.string().max(65_536).optional()})).max(64)}),
]);
export type UIAnswer=z.infer<typeof uiAnswerSchema>;
const question=z.strictObject({id,question:z.string(),options:z.array(z.strictObject({label:z.string()})),multi:z.boolean().optional()});
export const pendingInteractionSchema=z.strictObject({
  id,generation:id,family:z.literal("extension-ui"),scope:z.discriminatedUnion("kind",[
    z.strictObject({kind:z.literal("startup")}),z.strictObject({kind:z.literal("session"),sessionId:id}),
  ]),method:z.enum(["ask","select","input","editor","confirm"]),title:z.string(),
  options:z.array(z.string()).optional(),questions:z.array(question).optional(),
  createdAt:z.number(),deadline:z.number(),reason:z.literal("explicit-answer-required"),
});
export type PendingInteraction=z.infer<typeof pendingInteractionSchema>;
export const interactionSnapshotSchema=z.strictObject({
  stage:z.literal("S0-isolated-interactions"),sessionAdmission:z.literal("blocked"),generation:id,
  policyVerified:z.boolean(),pending:z.array(pendingInteractionSchema).max(16),
  outcomes:z.array(z.strictObject({id,status:z.string(),reason:z.string()})).max(64),
});
export type InteractionSnapshot=z.infer<typeof interactionSnapshotSchema>;
export const interactionReplySchema=z.strictObject({status:z.enum(["answered","cancelled","expired","invalid","stale"])});
export type InteractionReply=z.infer<typeof interactionReplySchema>;
const scenario=z.enum(["ask","timed-ask","select","tool","timed-tool"]);
export type InteractionScenario=z.infer<typeof scenario>;

const codec=<T>(schema:z.ZodType<T>,typeSymbol:string)=>({mode:"strict" as const,typeSymbol,
  create:()=>schema,decode:(value:unknown)=>schema.parse(value)});
const parameter=<T>(name:string,schema:z.ZodType<T>,symbol:string)=>({name,source:"json" as const,
  codec:codec(schema,symbol),strictCodec:codec(schema,symbol)});
export const interactionsContribution=createTypertRemoteInfo({package:"@omp-webui/s0-interactions",methods:{
  "ompInteractions/snapshot":{service:"ompInteractions",invocation:{kind:"direct"},parameters:[],
    result:{mode:"strict",typeSymbol:"InteractionSnapshot",create:()=>interactionSnapshotSchema,
      decode:(value:unknown)=>interactionSnapshotSchema.parse(value)}},
  "ompInteractions/answer":{service:"ompInteractions",invocation:{kind:"direct"},parameters:[
    parameter("generation",id,"string"),
    parameter("interactionId",id,"string"),
    parameter("answer",uiAnswerSchema,"UIAnswer"),
  ],result:{mode:"strict",typeSymbol:"InteractionReply",create:()=>interactionReplySchema,
    decode:(value:unknown)=>interactionReplySchema.parse(value)}},
  "ompInteractions/start":{service:"ompInteractions",invocation:{kind:"direct"},parameters:[
    parameter("scenario",scenario,"InteractionScenario"),
  ],result:{mode:"strict",typeSymbol:"InteractionSnapshot",create:()=>interactionSnapshotSchema,
    decode:(value:unknown)=>interactionSnapshotSchema.parse(value)}},
}},z);
export const interactionsHostContribution:TypertContribution={package:interactionsContribution.package,face:"host",
  schemas:[{name:"InteractionSnapshot",create:()=>interactionSnapshotSchema},{name:"InteractionReply",create:()=>interactionReplySchema}],
  model:{services:[],events:[],objects:[]},invocations:interactionsContribution.descriptors};
declare module "@deepseek-ai/dsh-typert-protocol" {
  interface TypertRemoteNamespaceMap {
    ompInteractions:{snapshot():Promise<RemoteResult<InteractionSnapshot>>;
      answer(generation:string,interactionId:string,answer:UIAnswer):Promise<RemoteResult<InteractionReply>>;
      start(scenario:InteractionScenario):Promise<RemoteResult<InteractionSnapshot>>;};
  }
}
