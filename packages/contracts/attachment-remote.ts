/** OMP workflow on DSH's public typed Remote; exact prose enters only through the trusted Session prompt adapter. */
import { z } from "zod";
import { createTypertRemoteInfo } from "@deepseek-ai/dsh-typert-protocol/remote-info";
import type { RemoteResult } from "@deepseek-ai/dsh-typert-protocol";
import type { TypertContribution } from "@deepseek-ai/dsh-typert-registry";
import { isAttachmentReceipt } from "./attachment-preparation.ts";
import type { AttachmentReceipt } from "./attachment-preparation.ts";
import { isSubmissionResult } from "./submissions.ts";
import type { SubmissionResult } from "./submissions.ts";

const token = z.string().min(1).max(96).regex(/^[A-Za-z0-9_-]+$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
/** Opaque projection/draft identities. Host authorization resolves all targets and original bytes. */
export const attachmentSelectionSchema = z.strictObject({
  session: token, draftId: token, revision: token, originalIds: z.array(token).min(1).max(8),
});
export type AttachmentSelection = z.infer<typeof attachmentSelectionSchema>;
/** Internal bridge validation; preparation is deliberately absent from the browser Remote. */
export const attachmentPrepareRequestSchema = z.strictObject({ selection: attachmentSelectionSchema, preparationId: token });
export type AttachmentPrepareRequest = z.infer<typeof attachmentPrepareRequestSchema>;
export const attachmentConsentRequestSchema = z.strictObject({ selection: attachmentSelectionSchema,
  receiptId: token, resultDigest: digest, acceptedDegradations: z.array(token).max(32) });
export type AttachmentConsentRequest = z.infer<typeof attachmentConsentRequestSchema>;
export interface AttachmentDispatchBinding { selection: AttachmentSelection; consentId: string; submissionId: string; requestId: string }
const attemptSchema = z.strictObject({ selection: attachmentSelectionSchema, submissionId: token, requestId: token });
export type AttachmentAttempt = z.infer<typeof attemptSchema>;
const phaseSchema = z.enum(["registered", "preparing", "awaiting-consent", "submitting", "submitted", "failed", "cancelled", "unresolved"]);
export type AttachmentGatePhase = z.infer<typeof phaseSchema>;
const receiptSchema = z.custom<AttachmentReceipt>(isAttachmentReceipt);
const resultSchema = z.custom<SubmissionResult>(isSubmissionResult);
const finishOutcomeSchema = z.enum(["accepted", "not-submitted", "completed-without-input"]);
/** Successful execution without native input is distinct from attachment acceptance or pre-dispatch refusal. */
export type AttachmentFinishOutcome = z.infer<typeof finishOutcomeSchema>;
const statusSchema = z.strictObject({ phase: phaseSchema, requestId: token, submissionId: token,
  nativeState: z.enum(["not-dispatched", "in-flight", "reserved", "unresolved"]),
  recovery: z.enum(["accepted", "not-submitted", "completed-without-input", "unresolved"]), receipt: receiptSchema.optional(),
  prompt: z.string().max(128 * 1024).optional(), code: z.string().max(96).optional(), result: resultSchema.optional() });
export type AttachmentGateStatus = z.infer<typeof statusSchema>;
const statusRequest = z.strictObject({ requestId: token, knownDigest: digest.optional() });
const consentRequest = attachmentConsentRequestSchema.extend({ requestId: token });
export type AttachmentContinueRequest = z.infer<typeof consentRequest>;
const requestKey = z.strictObject({ requestId: token });
const finishRequest = z.strictObject({ requestId: token, outcome: finishOutcomeSchema });
const codec = <T>(schema: z.ZodType<T>, typeSymbol: string) => ({ mode: "strict" as const, typeSymbol,
  create: () => schema, decode: (value: unknown) => schema.parse(value) });
const parameter = <T>(schema: z.ZodType<T>, symbol: string) => ({ name: "request", source: "json" as const,
  codec: codec(schema, symbol), strictCodec: codec(schema, symbol) });
export const attachmentsContribution = createTypertRemoteInfo({ package: "@omp-webui/attachment-preparation", methods: {
  "ompAttachments/begin": { service: "ompAttachments", invocation: { kind: "direct" },
    parameters: [parameter(attemptSchema, "AttachmentAttempt")], result: codec(z.strictObject({ registered: z.literal(true) }), "AttachmentRegistered") },
  "ompAttachments/status": { service: "ompAttachments", invocation: { kind: "direct" },
    parameters: [parameter(statusRequest, "AttachmentStatusRequest")], result: codec(statusSchema, "AttachmentGateStatus") },
  "ompAttachments/consent": { service: "ompAttachments", invocation: { kind: "direct" },
    parameters: [parameter(consentRequest, "AttachmentContinueRequest")], result: codec(z.strictObject({ continuing: z.literal(true) }), "AttachmentContinuing") },
  "ompAttachments/cancel": { service: "ompAttachments", invocation: { kind: "direct" },
    parameters: [parameter(requestKey, "AttachmentRequestKey")], result: codec(z.strictObject({ cancelled: z.boolean() }), "AttachmentCancelled") },
  "ompAttachments/finish": { service: "ompAttachments", invocation: { kind: "direct" },
    parameters: [parameter(finishRequest, "AttachmentFinishRequest")], result: codec(z.strictObject({ finished: z.literal(true) }), "AttachmentFinished") },
}}, z);
export const attachmentsHostContribution: TypertContribution = { package: attachmentsContribution.package, face: "host",
  schemas: [{ name: "AttachmentGateStatus", create: () => statusSchema }],
  model: { services: [], events: [], objects: [] }, invocations: attachmentsContribution.descriptors };
declare module "@deepseek-ai/dsh-typert-protocol" {
  interface TypertRemoteNamespaceMap {
    ompAttachments: {
      begin(request: AttachmentAttempt): Promise<RemoteResult<{ registered: true }>>;
      status(request: z.infer<typeof statusRequest>): Promise<RemoteResult<AttachmentGateStatus>>;
      consent(request: AttachmentContinueRequest): Promise<RemoteResult<{ continuing: true }>>;
      cancel(request: z.infer<typeof requestKey>): Promise<RemoteResult<{ cancelled: boolean }>>;
      finish(request: z.infer<typeof finishRequest>): Promise<RemoteResult<{ finished: true }>>;
    };
  }
}
