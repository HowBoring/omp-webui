/** Opt-in SOURCE contract. No product route, UI action or capability registration. */
import { z } from "zod";
import { createTypertRemoteInfo } from "@deepseek-ai/dsh-typert-protocol/remote-info";
import type { RemoteResult } from "@deepseek-ai/dsh-typert-protocol";
import type { TypertContribution } from "@deepseek-ai/dsh-typert-registry";

const id = z.string().min(1).max(256);
export const historyNavigationSourceRequest = z.discriminatedUnion("operation", [
  z.strictObject({ operation: z.literal("inspect"), sessionId: id, entryId: id }),
  z.strictObject({ operation: z.literal("confirm"), token: id }),
  z.strictObject({ operation: z.literal("cancel"), token: id }),
  z.strictObject({ operation: z.literal("query"), sessionId: id, navigationId: id }),
]);
const draftOffer = z.strictObject({ kind: z.literal("conflict_safe_draft_offer"), text: z.string().max(65536),
  originEntryId: id, contentRevision: id, policy: z.literal("explicit_choice_never_overwrite_or_send"),
  originals: z.literal("unavailable"), renewOriginals: z.literal(false) });
export type ConflictSafeDraftOffer = z.infer<typeof draftOffer>;
export const historyNavigationSourceResult = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("confirmation"), token: id, navigationId: id, sessionId: id, entryId: id,
    targetParentId: id.nullable(), expiresAt: z.number(),
    notice: z.literal("files_and_external_effects_are_not_rolled_back"), options: z.literal("native_defaults") }),
  z.strictObject({ status: z.literal("cancelled") }),
  z.strictObject({ status: z.literal("operation"), navigationId: id,
    outcome: z.enum(["reserved", "committed", "cancelled", "aborted", "unsupported", "failed", "absent", "unknown"]),
    persistence: z.enum(["committed", "unresolved", "failed", "unknown"]),
    projection: z.enum(["ready", "failed", "invalidated", "unchanged"]),
    nativeCode: z.string().min(1).max(96).regex(/^(?:[A-Z][A-Z0-9_]*|ask_reanswer_unsupported)$/).optional(),
    commitId: id.optional(), actualLeafId: id.nullable().optional(), draft: draftOffer.optional(),
    draftUnavailable: id.optional() }),
  z.strictObject({ status: z.literal("error"), code: z.string().regex(/^navigation_[a-z_]+$/).max(96) }),
]);
export type HistoryNavigationSourceRequest = z.infer<typeof historyNavigationSourceRequest>;
export type HistoryNavigationSourceResult = z.infer<typeof historyNavigationSourceResult>;
const codec = <T>(schema: z.ZodType<T>, typeSymbol: string) => ({ mode: "strict" as const, typeSymbol,
  create: () => schema, decode: (value: unknown) => schema.parse(value) });
const input = codec(historyNavigationSourceRequest, "HistoryNavigationSourceRequest");
export const historyNavigationSourceContribution = createTypertRemoteInfo({
  package: "@omp-webui/history-navigation-source", methods: {
    "ompHistoryNavigationSource/action": { service: "ompHistoryNavigationSource", invocation: { kind: "direct" },
      parameters: [{ name: "options", source: "json", codec: input, strictCodec: input }],
      result: codec(historyNavigationSourceResult, "HistoryNavigationSourceResult") },
  },
}, z);
export const historyNavigationSourceHostContribution: TypertContribution = {
  package: historyNavigationSourceContribution.package, face: "host",
  schemas: [{ name: "HistoryNavigationSourceResult", create: () => historyNavigationSourceResult }],
  model: { services: [], events: [], objects: [] }, invocations: historyNavigationSourceContribution.descriptors,
};
declare module "@deepseek-ai/dsh-typert-protocol" {
  interface TypertRemoteNamespaceMap {
    ompHistoryNavigationSource: { action(options: HistoryNavigationSourceRequest): Promise<RemoteResult<HistoryNavigationSourceResult>> };
  }
}
