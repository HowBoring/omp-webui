import { z } from "zod";
import { createTypertRemoteInfo } from "@deepseek-ai/dsh-typert-protocol/remote-info";
import type { RemoteResult } from "@deepseek-ai/dsh-typert-protocol";
import type { TypertContribution } from "@deepseek-ai/dsh-typert-registry";

export const chatSessionId = z.string().min(1).max(128);
export const chatRequestId = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/);
const projection = z.strictObject({ source: z.string().min(1).max(256), generation: z.string().min(1).max(256) });
export const chatRecovery = z.discriminatedUnion("outcome", [
  z.strictObject({ outcome: z.literal("accepted") }),
  z.strictObject({ outcome: z.literal("not-submitted") }),
  z.strictObject({ outcome: z.literal("unknown") }),
  z.strictObject({ outcome: z.literal("completed-without-input"),
    noInput: z.strictObject({ requestId: chatRequestId, projection }) }),
]);
export const chatState = z.strictObject({
  requestId: chatRequestId, phase: z.enum(["dispatching", "admitted", "unknown"]), settled: z.boolean(),
  terminal: z.boolean().optional(), persistence: z.enum(["committed", "failed", "unknown", "unresolved"]).optional(),
  operationOutcome: z.enum(["succeeded", "failed", "cancelled", "unknown"]).optional(),
  inputOutcome: z.enum(["unresolved", "generated", "no_input"]).optional(),
  result: z.strictObject({ status: z.enum(["completed", "aborted", "error"]), agentInvoked: z.boolean(),
    sessionSettled: z.boolean() }).optional(),
}).optional();
export type ChatRecovery = z.infer<typeof chatRecovery>;
export type ChatState = z.infer<typeof chatState>;

const codec = <T>(schema: z.ZodType<T>, typeSymbol: string) => ({ mode: "strict" as const, typeSymbol,
  create: () => schema, decode: (value: unknown) => schema.parse(value) });
const parameter = <T>(name: string, schema: z.ZodType<T>) => {
  const value = codec(schema, "string");
  return { name, source: "json" as const, codec: value, strictCodec: value };
};

/** Explicit read-only recovery and lifecycle observation. */
export const chatContribution = createTypertRemoteInfo({ package: "@omp-webui/chat", methods: {
  "ompChat/lookup": { service: "ompChat", invocation: { kind: "direct" },
    parameters: [parameter("sessionId", chatSessionId), parameter("requestId", chatRequestId)],
    result: codec(chatRecovery, "ChatRecovery") },
  "ompChat/state": { service: "ompChat", invocation: { kind: "direct" },
    parameters: [parameter("sessionId", chatSessionId)], result: codec(chatState, "ChatState") },
} }, z);
export const chatHostContribution: TypertContribution = { package: chatContribution.package, face: "host", schemas: [],
  model: { services: [], events: [], objects: [] }, invocations: chatContribution.descriptors };
declare module "@deepseek-ai/dsh-typert-protocol" {
  interface TypertRemoteNamespaceMap {
    ompChat: {
      lookup(sessionId: string, requestId: string): Promise<RemoteResult<ChatRecovery>>;
      state(sessionId: string): Promise<RemoteResult<ChatState>>;
    }
  }
}
