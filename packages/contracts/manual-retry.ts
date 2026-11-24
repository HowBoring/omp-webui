import { z } from "zod";
import { createTypertRemoteInfo } from "@deepseek-ai/dsh-typert-protocol/remote-info";
import type { RemoteResult } from "@deepseek-ai/dsh-typert-protocol";
import type { TypertContribution } from "@deepseek-ai/dsh-typert-registry";

/** Browser-facing Retry surface: explicit confirmation, one native attempt, read-only recovery. */
const id = z.string().min(1).max(128);
const detail = z.string().min(1).max(4096);
export const retryRefusalSchema = z.strictObject({ status: z.literal("refused"),
  reason: z.enum(["unavailable", "forbidden", "busy", "stale_confirmation"]), detail: detail.optional() });
export const retryOfferSchema = z.union([z.strictObject({ status: z.literal("confirmation"), requestId: id,
  notice: z.string().min(1).max(4096), expiresInMs: z.number().int().nonnegative() }), retryRefusalSchema]);
export const retryAttemptSchema = z.strictObject({ status: z.enum(["admitted", "unknown", "succeeded", "failed", "cancelled"]),
  requestId: id, settled: z.boolean(), reason: z.enum(["native_refused", "native_busy"]).optional(),
  evidence: z.enum(["no_response", "receipt_unknown", "conflict"]).optional(), detail: detail.optional() });
export const retryResultSchema = z.union([retryAttemptSchema, retryRefusalSchema]);
export const retryStateSchema = z.union([z.strictObject({ status: z.literal("state"), notice: z.string().min(1).max(4096),
  confirmation: z.strictObject({ requestId: id, expiresInMs: z.number().int().nonnegative() }).optional(),
  attempt: retryAttemptSchema.optional() }), retryRefusalSchema]);
export type RetryRefusal = z.infer<typeof retryRefusalSchema>;
export type RetryOffer = z.infer<typeof retryOfferSchema>;
export type RetryAttempt = z.infer<typeof retryAttemptSchema>;
export type RetryResult = z.infer<typeof retryResultSchema>;
export type RetryState = z.infer<typeof retryStateSchema>;
export type RetryEvidence = NonNullable<RetryAttempt["evidence"]>;

const codec = <T>(schema: z.ZodType<T>, typeSymbol: string) => ({ mode: "strict" as const, typeSymbol,
  create: () => schema, decode: (value: unknown) => schema.parse(value) });
const parameter = { name: "requestId", source: "json" as const, codec: codec(id, "string"), strictCodec: codec(id, "string") };
export const retryContribution = createTypertRemoteInfo({ package: "@omp-webui/manual-retry", methods: {
  "ompRetry/state": { service: "ompRetry", invocation: { kind: "direct" }, parameters: [],
    result: codec(retryStateSchema, "RetryState") },
  "ompRetry/offer": { service: "ompRetry", invocation: { kind: "direct" }, parameters: [],
    result: codec(retryOfferSchema, "RetryOffer") },
  "ompRetry/confirm": { service: "ompRetry", invocation: { kind: "direct" }, parameters: [parameter],
    result: codec(retryResultSchema, "RetryResult") },
  "ompRetry/lookup": { service: "ompRetry", invocation: { kind: "direct" }, parameters: [parameter],
    result: codec(retryResultSchema, "RetryResult") },
  "ompRetry/cancel": { service: "ompRetry", invocation: { kind: "direct" }, parameters: [parameter],
    result: codec(z.boolean(), "boolean") },
} }, z);
export const retryHostContribution: TypertContribution = { package: retryContribution.package, face: "host", schemas: [
  { name: "RetryState", create: () => retryStateSchema }, { name: "RetryOffer", create: () => retryOfferSchema },
  { name: "RetryResult", create: () => retryResultSchema },
], model: { services: [], events: [], objects: [] }, invocations: retryContribution.descriptors };
declare module "@deepseek-ai/dsh-typert-protocol" {
  interface TypertRemoteNamespaceMap {
    ompRetry: { state(): Promise<RemoteResult<RetryState>>; offer(): Promise<RemoteResult<RetryOffer>>;
      confirm(requestId: string): Promise<RemoteResult<RetryResult>>;
      lookup(requestId: string): Promise<RemoteResult<RetryResult>>; cancel(requestId: string): Promise<RemoteResult<boolean>> };
  }
}
