import { z } from "zod";
import { createTypertRemoteInfo } from "@deepseek-ai/dsh-typert-protocol/remote-info";
import type { RemoteResult } from "@deepseek-ai/dsh-typert-protocol";
import type { TypertContribution } from "@deepseek-ai/dsh-typert-registry";
import { brokerScopeSchema } from "./interaction-broker.ts";
import { restoredQueueSchema } from "./queue-withdrawal.ts";

export { restoredQueueSchema };

const id = z.string().min(1).max(128);
export const stopSnapshotSchema = z.strictObject({ generation: id, workerGeneration: id, scope: brokerScopeSchema,
  status: z.enum(["idle", "stopping", "terminating", "ended", "unknown", "forbidden"]),
  nativeSettled: z.boolean(), acceptingWork: z.boolean(), pending: z.strictObject({ interactions: z.number().int().nonnegative(),
    history: z.number().int().nonnegative(), queued: z.number().int().nonnegative(), other: z.number().int().nonnegative() }),
  failures: z.array(z.enum(["ui-cancel-failed", "summary-cancel-failed", "queue-abort-failed", "termination-unknown"])),
  forceAvailable: z.boolean(), restored: restoredQueueSchema.nullable(), draftConflict: z.boolean() });
export type StopSnapshot = z.infer<typeof stopSnapshotSchema>;
export const forceOfferSchema = z.strictObject({ status: z.enum(["offered", "unavailable", "stale"]),
  token: id.optional(), expiresInMs: z.number().optional() });
export type ForceOffer = z.infer<typeof forceOfferSchema>;
export const forceResultSchema = z.strictObject({ status: z.enum(["stale", "ended", "unknown"]) });
const codec = <T>(schema: z.ZodType<T>, typeSymbol: string) => ({ mode: "strict" as const, typeSymbol,
  create: () => schema, decode: (value: unknown) => schema.parse(value) });
const parameter = { name: "token", source: "json" as const, codec: codec(id, "string"), strictCodec: codec(id, "string") };
/** New Host Remote contribution; browser arguments never contain process identifiers or Native commands. */
export const stopContribution = createTypertRemoteInfo({ package: "@omp-webui/stop", methods: {
  "ompStop/state": { service: "ompStop", invocation: { kind: "direct" }, parameters: [],
    result: codec(stopSnapshotSchema, "StopSnapshot") },
  "ompStop/stop": { service: "ompStop", invocation: { kind: "direct" }, parameters: [],
    result: codec(stopSnapshotSchema, "StopSnapshot") },
  "ompStop/offerForce": { service: "ompStop", invocation: { kind: "direct" }, parameters: [],
    result: codec(forceOfferSchema, "ForceOffer") },
  "ompStop/confirmForce": { service: "ompStop", invocation: { kind: "direct" }, parameters: [parameter],
    result: codec(forceResultSchema, "ForceResult") },
} }, z);
export const stopHostContribution: TypertContribution = { package: stopContribution.package, face: "host", schemas: [
  { name: "StopSnapshot", create: () => stopSnapshotSchema }, { name: "ForceOffer", create: () => forceOfferSchema },
  { name: "ForceResult", create: () => forceResultSchema },
], model: { services: [], events: [], objects: [] }, invocations: stopContribution.descriptors };
declare module "@deepseek-ai/dsh-typert-protocol" {
  interface TypertRemoteNamespaceMap {
    ompStop: { state(): Promise<RemoteResult<StopSnapshot>>; stop(): Promise<RemoteResult<StopSnapshot>>;
      offerForce(): Promise<RemoteResult<ForceOffer>>;
      confirmForce(token: string): Promise<RemoteResult<z.infer<typeof forceResultSchema>>> };
  }
}
