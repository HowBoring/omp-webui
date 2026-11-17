import { z } from "zod";
import { createTypertRemoteInfo } from "@deepseek-ai/dsh-typert-protocol/remote-info";
import type { RemoteResult } from "@deepseek-ai/dsh-typert-protocol";
import type { TypertContribution } from "@deepseek-ai/dsh-typert-registry";
import { pendingInteractionSchema, uiAnswerSchema, type UIAnswer } from "./interactions.ts";

const id = z.string().min(1).max(128);
export const brokerScopeSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("startup"), contextId: id }),
  z.strictObject({ kind: z.literal("session"), sessionId: id }),
]);
export type BrokerScope = z.infer<typeof brokerScopeSchema>;
export const brokerResultSchema = z.strictObject({
  status: z.enum(["answered", "cancelled", "expired", "invalid", "stale", "unknown", "forbidden"]),
});
export type BrokerResult = z.infer<typeof brokerResultSchema>;
export const brokerSnapshotSchema = z.strictObject({
  generation: id, workerGeneration: id, agentScope: id, scope: brokerScopeSchema,
  policyVerified: z.boolean(), accepting: z.boolean(),
  pending: z.array(z.strictObject({ deliveryId: id, card: pendingInteractionSchema })).max(16),
  outcomes: z.array(z.strictObject({ id, status: z.string(), reason: z.string(),
    stop: z.enum(["none", "requested", "acknowledged", "failed"]) })).max(64),
});
export type BrokerSnapshot = z.infer<typeof brokerSnapshotSchema>;
const codec = <T>(schema: z.ZodType<T>, typeSymbol: string) => ({ mode: "strict" as const, typeSymbol,
  create: () => schema, decode: (value: unknown) => schema.parse(value) });
const parameter = <T>(name: string, schema: z.ZodType<T>, symbol: string) => ({ name, source: "json" as const,
  codec: codec(schema, symbol), strictCodec: codec(schema, symbol) });
/** New Host Remote contract; Native settlement remains the matched public respond_ui operation. */
export const brokerContribution = createTypertRemoteInfo({ package: "@omp-webui/interaction-broker", methods: {
  "ompInteractionBroker/pending": { service: "ompInteractionBroker", invocation: { kind: "direct" }, parameters: [],
    result: codec(brokerSnapshotSchema, "BrokerSnapshot") },
  "ompInteractionBroker/answer": { service: "ompInteractionBroker", invocation: { kind: "direct" }, parameters: [
    parameter("generation", id, "string"), parameter("interactionId", id, "string"),
    parameter("deliveryId", id, "string"), parameter("answer", uiAnswerSchema, "UIAnswer"),
  ], result: codec(brokerResultSchema, "BrokerResult") },
} }, z);
export const brokerHostContribution: TypertContribution = { package: brokerContribution.package, face: "host",
  schemas: [{ name: "BrokerSnapshot", create: () => brokerSnapshotSchema },
    { name: "BrokerResult", create: () => brokerResultSchema }],
  model: { services: [], events: [], objects: [] }, invocations: brokerContribution.descriptors };
declare module "@deepseek-ai/dsh-typert-protocol" {
  interface TypertRemoteNamespaceMap {
    ompInteractionBroker: { pending(): Promise<RemoteResult<BrokerSnapshot>>;
      answer(generation: string, interactionId: string, deliveryId: string,
        answer: UIAnswer): Promise<RemoteResult<BrokerResult>> };
  }
}
