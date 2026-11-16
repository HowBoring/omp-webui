/** OMP-specific preparation workflow on DSH's public typed Remote contribution seam. */
import { z } from "zod";
import { createTypertRemoteInfo } from "@deepseek-ai/dsh-typert-protocol/remote-info";
import type { RemoteResult } from "@deepseek-ai/dsh-typert-protocol";
import type { TypertContribution } from "@deepseek-ai/dsh-typert-registry";
import { isAttachmentReceipt } from "./attachments.ts";
import type { AttachmentReceipt } from "./attachments.ts";

const token = z.string().min(1).max(96).regex(/^[A-Za-z0-9_-]+$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
/** Opaque projection/draft identities; authorization and native targets are always resolved by the Host. */
export const attachmentSelectionSchema = z.strictObject({
  session: token, draftId: token, revision: token, originalIds: z.array(token).min(1).max(8),
});
export type AttachmentSelection = z.infer<typeof attachmentSelectionSchema>;
export const attachmentPrepareRequestSchema = z.strictObject({ selection: attachmentSelectionSchema, preparationId: token });
export type AttachmentPrepareRequest = z.infer<typeof attachmentPrepareRequestSchema>;
export const attachmentConsentRequestSchema = z.strictObject({ selection: attachmentSelectionSchema,
  receiptId: token, resultDigest: digest, acceptedDegradations: z.array(token).max(32) });
export type AttachmentConsentRequest = z.infer<typeof attachmentConsentRequestSchema>;
const consentResult = z.strictObject({ consentId: token });
const bindRequest = z.strictObject({ selection: attachmentSelectionSchema, consentId: token,
  submissionId: token, requestId: token });
export type AttachmentDispatchBinding = z.infer<typeof bindRequest>;
const boundResult = z.strictObject({ bound: z.literal(true) });
const cancelRequest = z.strictObject({ selection: attachmentSelectionSchema, preparationId: token });
const cancelledResult = z.strictObject({ cancelled: z.boolean() });
const receiptResult = z.custom<AttachmentReceipt>(isAttachmentReceipt);
const codec = <T>(schema: z.ZodType<T>, typeSymbol: string) => ({ mode: "strict" as const, typeSymbol,
  create: () => schema, decode: (value: unknown) => schema.parse(value) });
const parameter = <T>(schema: z.ZodType<T>, symbol: string) => ({ name: "request", source: "json" as const,
  codec: codec(schema, symbol), strictCodec: codec(schema, symbol) });
export const attachmentsContribution = createTypertRemoteInfo({ package: "@omp-webui/attachment-preparation", methods: {
  "ompAttachments/prepare": { service: "ompAttachments", invocation: { kind: "direct" },
    parameters: [parameter(attachmentPrepareRequestSchema, "AttachmentPrepareRequest")], result: codec(receiptResult, "AttachmentReceipt") },
  "ompAttachments/consent": { service: "ompAttachments", invocation: { kind: "direct" },
    parameters: [parameter(attachmentConsentRequestSchema, "AttachmentConsentRequest")], result: codec(consentResult, "AttachmentConsentHandle") },
  "ompAttachments/bind": { service: "ompAttachments", invocation: { kind: "direct" },
    parameters: [parameter(bindRequest, "AttachmentDispatchBinding")], result: codec(boundResult, "AttachmentBound") },
  "ompAttachments/cancel": { service: "ompAttachments", invocation: { kind: "direct" },
    parameters: [parameter(cancelRequest, "AttachmentCancelRequest")], result: codec(cancelledResult, "AttachmentCancelled") },
}}, z);
export const attachmentsHostContribution: TypertContribution = { package: attachmentsContribution.package, face: "host",
  schemas: [{ name: "AttachmentReceipt", create: () => receiptResult }],
  model: { services: [], events: [], objects: [] }, invocations: attachmentsContribution.descriptors };
declare module "@deepseek-ai/dsh-typert-protocol" {
  interface TypertRemoteNamespaceMap {
    ompAttachments: {
      prepare(request: AttachmentPrepareRequest): Promise<RemoteResult<AttachmentReceipt>>;
      consent(request: AttachmentConsentRequest): Promise<RemoteResult<{ consentId: string }>>;
      bind(request: AttachmentDispatchBinding): Promise<RemoteResult<{ bound: true }>>;
      cancel(request: z.infer<typeof cancelRequest>): Promise<RemoteResult<{ cancelled: boolean }>>;
    };
  }
}
