import { z } from "zod";
import { createTypertRemoteInfo } from "@deepseek-ai/dsh-typert-protocol/remote-info";
import type { RemoteResult } from "@deepseek-ai/dsh-typert-protocol";
import type { TypertContribution } from "@deepseek-ai/dsh-typert-registry";
import { validHistoryOpen, validHistoryPage, validHistoryContent } from "./generated/history.generated.ts";
import type { HistoryOpen, HistoryPage, HistoryContentPage } from "./generated/omp-wire.ts";
const token = z.string().min(1).max(128);
export const historyRequest = z.discriminatedUnion("operation", [
  z.strictObject({ operation: z.literal("open"), scope: z.enum(["tree", "active", "running"]) }),
  z.strictObject({ operation: z.literal("page"), cursor: token }),
  z.strictObject({ operation: z.literal("content"), cursor: token }),
  z.strictObject({ operation: z.literal("close"), snapshot: token }),
]);
export const historyResult = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("opened"), value: z.custom<HistoryOpen>(validHistoryOpen) }),
  z.strictObject({ status: z.literal("page"), value: z.custom<HistoryPage>(validHistoryPage) }),
  z.strictObject({ status: z.literal("content"), value: z.custom<HistoryContentPage>(validHistoryContent) }),
  z.strictObject({ status: z.literal("closed") }),
  z.strictObject({ status: z.literal("error"), code: z.string().max(96).regex(/^(history_[a-z_]+|RPC_[A-Z_]+|HISTORY_[A-Z_]+)$/) }),
]);
export type HistoryRequest = z.infer<typeof historyRequest>;
export type HistoryResult = z.infer<typeof historyResult>;
const codec = <T>(schema: z.ZodType<T>, typeSymbol: string) => ({ mode: "strict" as const, typeSymbol,
  create: () => schema, decode: (value: unknown) => schema.parse(value) });
const requestCodec = codec(historyRequest, "HistoryRequest");
/** Public DSH Remote fixture only. Does not grant private Session admission. */
export const historyContribution = createTypertRemoteInfo({ package: "@omp-webui/history-fixture", methods: {
  "ompHistoryFixture/read": { service: "ompHistoryFixture", invocation: { kind: "direct" },
    parameters: [{ name: "options", source: "json", codec: requestCodec, strictCodec: requestCodec }],
    result: codec(historyResult, "HistoryResult") },
}}, z);
export const historyHostContribution: TypertContribution = { package: historyContribution.package, face: "host",
  schemas: [{ name: "HistoryResult", create: () => historyResult }],
  model: { services: [], events: [], objects: [] }, invocations: historyContribution.descriptors };
declare module "@deepseek-ai/dsh-typert-protocol" {
  interface TypertRemoteNamespaceMap {
    ompHistoryFixture: { read(options: HistoryRequest): Promise<RemoteResult<HistoryResult>> };
  }
}
