import {z} from 'zod';
import {createTypertRemoteInfo} from '@deepseek-ai/dsh-typert-protocol/remote-info';
import type {RemoteResult} from '@deepseek-ai/dsh-typert-protocol';
import type {TypertContribution} from '@deepseek-ai/dsh-typert-registry';
export const action=z.enum(['info','prompt','rewind','reopen']);
const result=z.strictObject({sessionId:z.string().min(1).max(128),generation:z.string().max(128),
  settled:z.boolean(),phase:z.enum(['ready','invalidated']),reason:z.string().max(96).optional(),durability:z.literal('not_attested')});
export type LiveFixtureResult=z.infer<typeof result>;
const codec=<T>(schema:z.ZodType<T>,typeSymbol:string)=>({mode:'strict' as const,typeSymbol,create:()=>schema,decode:(v:unknown)=>schema.parse(v)});
const request=codec(action,'LiveFixtureAction');
export const liveContribution=createTypertRemoteInfo({package:'@omp-webui/live-fixture',methods:{
  'ompLiveFixture/action':{service:'ompLiveFixture',invocation:{kind:'direct'},parameters:[{name:'operation',source:'json',codec:request,strictCodec:request}],result:codec(result,'LiveFixtureResult')},
}},z);
export const liveHostContribution:TypertContribution={package:liveContribution.package,face:'host',schemas:[],
  model:{services:[],events:[],objects:[]},invocations:liveContribution.descriptors};
declare module '@deepseek-ai/dsh-typert-protocol'{interface TypertRemoteNamespaceMap{
  ompLiveFixture:{action(operation:z.infer<typeof action>):Promise<RemoteResult<LiveFixtureResult>>};
}}
