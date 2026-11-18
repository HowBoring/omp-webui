import { z } from "zod";
import { createTypertRemoteInfo } from "@deepseek-ai/dsh-typert-protocol/remote-info";
import { RemoteError, type RemoteResult, type RemoteStreamHandle } from "@deepseek-ai/dsh-typert-protocol";
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
const answerParameters = [
  parameter("generation", id, "string"), parameter("interactionId", id, "string"),
  parameter("deliveryId", id, "string"), parameter("answer", uiAnswerSchema, "UIAnswer"),
];
export const brokerWriteProofSchema = z.string().length(43).regex(/^[A-Za-z0-9_-]{43}$/);
/** New Host Remote contract; Native settlement remains the matched public respond_ui operation. */
export const brokerContribution = createTypertRemoteInfo({ package: "@omp-webui/interaction-broker", methods: {
  "ompInteractionBroker/pending": { service: "ompInteractionBroker", invocation: { kind: "direct" }, parameters: [],
    result: codec(brokerSnapshotSchema, "BrokerSnapshot") },
  "ompInteractionBroker/answer": { service: "ompInteractionBroker", invocation: { kind: "direct" },
    parameters: answerParameters, result: codec(brokerResultSchema, "BrokerResult") },
} }, z);
export const brokerPendingSnapshotEndpoint = "ompInteractionBroker/pendingSnapshot";
const snapshotMethods = {
  [brokerPendingSnapshotEndpoint]: { service: "ompInteractionBroker", invocation: { kind: "direct" as const },
    mode: "stream" as const, parameters: [], result: codec(brokerSnapshotSchema, "BrokerSnapshot") },
};
export const brokerSnapshotContribution = createTypertRemoteInfo({
  package: brokerContribution.package, methods: snapshotMethods,
}, z);

export const brokerAnswerStreamEndpoint = "ompInteractionBroker/answerStream";
export const brokerAnswerStreamContribution = createTypertRemoteInfo({ package: brokerContribution.package, methods: {
  ...snapshotMethods,
  [brokerAnswerStreamEndpoint]: { service: "ompInteractionBroker", invocation: { kind: "direct" }, mode: "stream",
    parameters: [...answerParameters, parameter("csrf", brokerWriteProofSchema, "string")],
    result: codec(brokerResultSchema, "BrokerResult") },
} }, z);

/** Read a complete one-item Remote snapshot before publishing it to the Browser View. */
export async function readBrokerSnapshot(handle: RemoteStreamHandle<BrokerSnapshot, never>): Promise<BrokerSnapshot> {
  return readOne(handle, brokerSnapshotSchema, brokerPendingSnapshotEndpoint, "Invalid Interaction snapshot stream.");
}

/** Read a complete one-result Remote answer before applying the result to this Browser View. */
export async function readBrokerAnswer(handle: RemoteStreamHandle<BrokerResult, never>): Promise<BrokerResult> {
  return readOne(handle, brokerResultSchema, brokerAnswerStreamEndpoint, "Invalid Interaction answer stream.");
}

async function readOne<T>(handle: RemoteStreamHandle<T, never>, schema: z.ZodType<T>,
  endpoint: string, message: string): Promise<T> {
  try {
    const stream = handle[Symbol.asyncIterator]();
    const first = await stream.next();
    const result = schema.safeParse(first.value);
    if (first.done || !result.success || !(await stream.next()).done) {
      throw new RemoteError("gateway/protocol", message, { endpoint });
    }
    return result.data;
  } finally {
    handle.dispose();
  }
}
export const brokerHostContribution: TypertContribution = { package: brokerContribution.package, face: "host",
  schemas: [{ name: "BrokerSnapshot", create: () => brokerSnapshotSchema },
    { name: "BrokerResult", create: () => brokerResultSchema }],
  model: { services: [], events: [], objects: [] }, invocations: brokerContribution.descriptors };
export const brokerSnapshotHostContribution: TypertContribution = {
  ...brokerHostContribution, invocations: brokerSnapshotContribution.descriptors,
};
export const brokerAnswerStreamHostContribution: TypertContribution = {
  ...brokerHostContribution, invocations: brokerAnswerStreamContribution.descriptors,
};
declare module "@deepseek-ai/dsh-typert-protocol" {
  interface TypertRemoteNamespaceMap {
    ompInteractionBroker: { pending(): Promise<RemoteResult<BrokerSnapshot>>;
      pendingSnapshot(): RemoteStreamHandle<BrokerSnapshot, never>;
      answerStream(generation: string, interactionId: string, deliveryId: string,
        answer: UIAnswer, csrf: string): RemoteStreamHandle<BrokerResult, never>;
      answer(generation: string, interactionId: string, deliveryId: string,
        answer: UIAnswer): Promise<RemoteResult<BrokerResult>> };
  }
}
