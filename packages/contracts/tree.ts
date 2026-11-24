import { z } from "zod";
import { createTypertRemoteInfo } from "@deepseek-ai/dsh-typert-protocol/remote-info";
import type { RemoteResult } from "@deepseek-ai/dsh-typert-protocol";
import type { TypertContribution } from "@deepseek-ai/dsh-typert-registry";

const token = z.string().min(1).max(256);
export const treeRequest = z.discriminatedUnion("operation", [
  z.strictObject({ operation: z.literal("open"), sessionId: token }),
  z.strictObject({ operation: z.literal("page"), snapshot: token, cursor: token }),
  z.strictObject({ operation: z.literal("preview"), snapshot: token, entryId: token }),
  z.strictObject({ operation: z.literal("close"), snapshot: token }),
]);
const position = z.strictObject({ sourceId: token, sessionId: token, workerId: token, contextId: token,
  contentRevision: token, retainedRevision: token, nativeRevision: z.number().int().nonnegative(),
  observationSeq: z.number().int().nonnegative(), leafId: token.nullable(), durability: z.literal("not_attested") });
const node = z.strictObject({ id: token, parentId: token.nullable(), kind: token, active: z.boolean(),
  role: token.optional(), boundary: z.enum(["compaction", "reset", "branch"]).optional(),
  contentState: z.enum(["readable", "structural", "hidden"]) });
export const treeResult = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("opened"), snapshot: token, cursor: token, position,
    expiresAt: z.number(), nativeParts: z.number().int().nonnegative() }),
  z.strictObject({ status: z.literal("page"), nodes: z.array(node).max(1024), position,
    continuity: z.enum(["partial", "complete"]), activePath: z.array(token).max(20000), nextCursor: token.optional() }),
  z.strictObject({ status: z.literal("preview"), node, position, text: z.string().max(2 * 1024 * 1024),
    attachments: z.literal("original_association_unproven"), modelInput: z.literal("not_an_input_audit") }),
  z.strictObject({ status: z.literal("closed") }),
  z.strictObject({ status: z.literal("error"), code: z.string().max(96).regex(/^(tree_[a-z_]+|history_[a-z_]+)$/) }),
]);
export type TreeRequest = z.infer<typeof treeRequest>;
export type TreeResult = z.infer<typeof treeResult>;
export type TreeNode = z.infer<typeof node>;
export type TreePosition = z.infer<typeof position>;
const codec = <T>(schema: z.ZodType<T>, typeSymbol: string) => ({ mode: "strict" as const, typeSymbol,
  create: () => schema, decode: (value: unknown) => schema.parse(value) });
const input = codec(treeRequest, "TreeRequest");
/** Opt-in public read-only Tree extension. Mount only behind the current Host Session authority. */
export const treeContribution = createTypertRemoteInfo({ package: "@omp-webui/readonly-tree", methods: {
  "ompTree/read": { service: "ompTree", invocation: { kind: "direct" },
    parameters: [{ name: "options", source: "json", codec: input, strictCodec: input }],
    result: codec(treeResult, "TreeResult") },
}}, z);
export const treeHostContribution: TypertContribution = { package: treeContribution.package, face: "host",
  schemas: [{ name: "TreeResult", create: () => treeResult }], model: { services: [], events: [], objects: [] },
  invocations: treeContribution.descriptors };
declare module "@deepseek-ai/dsh-typert-protocol" {
  interface TypertRemoteNamespaceMap { ompTree: { read(options: TreeRequest): Promise<RemoteResult<TreeResult>> } }
}
