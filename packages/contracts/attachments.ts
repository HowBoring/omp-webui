import { z } from "zod";
import { createTypertRemoteInfo } from "@deepseek-ai/dsh-typert-protocol/remote-info";
import type { RemoteResult } from "@deepseek-ai/dsh-typert-protocol";
import type { TypertContribution } from "@deepseek-ai/dsh-typert-registry";
import { attachmentErrorCodes } from "../attachments/errors.ts";
import { imageOriginalBytes, originalMediaTypes } from "../attachments/media.ts";

const token = z.string().min(1).max(256);
const mediaType = z.enum(originalMediaTypes);
export const attachmentTarget = z.strictObject({ sessionId: token, draftId: token });
export const originalDescriptor = z.strictObject({ displayName: z.string().min(1).max(255),
  mediaType, byteLength: z.number().int().min(1).max(imageOriginalBytes),
  width: z.number().int().positive().optional(), height: z.number().int().positive().optional() });
export type OriginalDescriptor = z.infer<typeof originalDescriptor>;
const originalMetadata = originalDescriptor.extend({ objectId: z.uuid(), sha256: z.string().regex(/^[0-9a-f]{64}$/),
  state: z.literal("staged-unprepared"), nativeAssociation: z.literal("unassociated"), stagedAt: z.number().int().nonnegative() });
const original = z.discriminatedUnion("validation", [
  originalMetadata.extend({ mediaType: z.literal("text/plain"), validation: z.literal("utf8-only") }),
  originalMetadata.extend({ mediaType: mediaType.exclude(["text/plain"]), validation: z.literal("signature-only") }),
]);
const deletionImpact = z.strictObject({ draftId: token, losesOriginalAccess: z.literal(true),
  laterToolReadsMayFail: z.literal(true) });
// Full carrier envelope/body limits must be admitted before JSON parsing by the eventual Host carrier.
const base64 = z.string().max(4 * Math.ceil(imageOriginalBytes / 3));
export const attachmentRequest = z.discriminatedUnion("operation", [
  z.strictObject({ operation: z.literal("stage-base64"), target: attachmentTarget, descriptor: originalDescriptor, base64 }),
  z.strictObject({ operation: z.literal("read-base64"), target: attachmentTarget, objectId: token }),
  z.strictObject({ operation: z.literal("release"), target: attachmentTarget, objectId: token }),
  z.strictObject({ operation: z.literal("touch"), target: attachmentTarget,
    activity: z.enum(["explicit-edit", "active-recovery"]), objectIds: z.array(token).min(1).max(8) }),
  z.strictObject({ operation: z.literal("usage"), target: attachmentTarget }),
  z.strictObject({ operation: z.literal("preview-delete"), target: attachmentTarget, objectId: token }),
  z.strictObject({ operation: z.literal("delete"), target: attachmentTarget, objectId: token, confirmationId: token }),
]);
export const attachmentResult = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("staged"), original }),
  z.strictObject({ status: z.literal("read"), original, base64 }),
  z.strictObject({ status: z.literal("released"), objectId: token, reclaimed: z.boolean() }),
  z.strictObject({ status: z.literal("touched"), renewed: z.array(token).max(8), unavailable: z.array(token).max(8) }),
  z.strictObject({ status: z.literal("usage"), chargedBytes: z.number().int().nonnegative(),
    objects: z.number().int().nonnegative(), totalBytes: z.number().int().positive() }),
  z.strictObject({ status: z.literal("deletion-preview"), original, impact: deletionImpact,
    confirmationId: token, expiresAt: z.number().int().nonnegative() }),
  z.strictObject({ status: z.literal("deleted"), objectId: token, reclaimed: z.boolean() }),
  z.strictObject({ status: z.literal("error"), code: z.enum(attachmentErrorCodes) }),
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
