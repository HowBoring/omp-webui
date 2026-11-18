import { z } from "zod";
import { createTypertRemoteInfo } from "@deepseek-ai/dsh-typert-protocol/remote-info";
import type { RemoteResult } from "@deepseek-ai/dsh-typert-protocol";
import type { TypertContribution } from "@deepseek-ai/dsh-typert-registry";
import { attachmentErrorCodePattern, maxAttachmentErrorCodeLength } from "../attachments/errors.ts";
import { imageOriginalBytes, originalMediaTypes } from "../attachments/media.ts";

const token = z.string().min(1).max(256);
export const attachmentTarget = z.strictObject({ sessionId: token, draftId: token });
export const originalDescriptor = z.strictObject({ displayName: z.string().min(1).max(255),
  mediaType: z.enum(originalMediaTypes), byteLength: z.number().int().min(1).max(imageOriginalBytes) });
const original = originalDescriptor.extend({ objectId: z.uuid(), sha256: z.string().regex(/^[0-9a-f]{64}$/),
  state: z.literal("staged-unprepared"), nativeAssociation: z.literal("unassociated"),
  validation: z.enum(["signature-only", "utf8-only"]), stagedAt: z.number().int().nonnegative() });
// Full carrier envelope/body limits must be admitted before JSON parsing by the eventual Host carrier.
const base64 = z.string().max(4 * Math.ceil(imageOriginalBytes / 3));
export const attachmentRequest = z.discriminatedUnion("operation", [
  z.strictObject({ operation: z.literal("stage-base64"), target: attachmentTarget, descriptor: originalDescriptor, base64 }),
  z.strictObject({ operation: z.literal("read-base64"), target: attachmentTarget, objectId: token }),
]);
export const attachmentResult = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("staged"), original }),
  z.strictObject({ status: z.literal("read"), original, base64 }),
  z.strictObject({ status: z.literal("error"),
    code: z.string().max(maxAttachmentErrorCodeLength).regex(attachmentErrorCodePattern) }),
]);
export type AttachmentTarget = z.infer<typeof attachmentTarget>;
export type AttachmentRequest = z.infer<typeof attachmentRequest>;
export type AttachmentResult = z.infer<typeof attachmentResult>;
const codec = <T>(schema: z.ZodType<T>, typeSymbol: string) => ({ mode: "strict" as const, typeSymbol,
  create: () => schema, decode: (value: unknown) => schema.parse(value) });
const input = codec(attachmentRequest, "AttachmentRequest");
/** Proposed opt-in Host contract. This namespace is not an OMP API or an existing DSH attachment receipt. */
export const attachmentContribution = createTypertRemoteInfo({ package: "@omp-webui/original-intake", methods: {
  "ompOriginals/exchange": { service: "ompOriginals", invocation: { kind: "direct" },
    parameters: [{ name: "options", source: "json", codec: input, strictCodec: input }],
    result: codec(attachmentResult, "AttachmentResult") },
}}, z);
export const attachmentHostContribution: TypertContribution = { package: attachmentContribution.package, face: "host",
  schemas: [{ name: "AttachmentResult", create: () => attachmentResult }],
  model: { services: [], events: [], objects: [] }, invocations: attachmentContribution.descriptors };
declare module "@deepseek-ai/dsh-typert-protocol" {
  interface TypertRemoteNamespaceMap {
    ompOriginals: { exchange(options: AttachmentRequest): Promise<RemoteResult<AttachmentResult>> };
  }
}
