/** Fixture-only public surface. The product Host drives the same gate from its trusted Session prompt handler. */
import { z } from "zod";
import { createTypertRemoteInfo } from "@deepseek-ai/dsh-typert-protocol/remote-info";
import type { RemoteResult } from "@deepseek-ai/dsh-typert-protocol";
import type { TypertContribution } from "@deepseek-ai/dsh-typert-registry";

export const fixtureFormats = z.enum(["png", "jpeg", "webp", "gif", "utf8", "pdf", "docx", "pptx", "xlsx", "epub", "broken-utf8", "long-utf8"]);
export interface AttachmentFixtureSnapshot {
  readonly selection: { session: string; draftId: string; revision: string; originalIds: string[] } | null;
  readonly message: string | null;
  readonly originals: { id: string; name: string; mediaType: string }[];
  readonly target: { sourceId: string; instanceId: string; nativeSessionId: string };
  readonly build: { base: string; sourceSha256: string; patchSha256: string; schemaSha256: string };
}
const selection = z.strictObject({ session: z.string().min(1).max(96), draftId: z.string().min(1).max(96),
  revision: z.string().min(1).max(96), originalIds: z.array(z.string().min(1).max(96)).min(1).max(8) });
const describe = z.strictObject({ formats: z.array(fixtureFormats).min(1).max(8), message: z.string().min(1).max(128 * 1024) });
const original = z.strictObject({ id: z.string().min(1).max(96), name: z.string().min(1).max(255), mediaType: z.string().min(1).max(128) });
const snapshot = z.strictObject({ selection: selection.nullable(), message: z.string().max(128 * 1024).nullable(),
  originals: z.array(original).max(8), target: z.strictObject({ sourceId: z.string(), instanceId: z.string(), nativeSessionId: z.string() }),
  build: z.strictObject({ base: z.string(), sourceSha256: z.string(), patchSha256: z.string(), schemaSha256: z.string() }) });
const send = z.strictObject({ requestId: z.string().min(1).max(96), message: z.string().min(1).max(128 * 1024) });
const query = z.strictObject({ clientSubmissionId: z.string().min(1).max(96) });
const codec = <T>(schema: z.ZodType<T>, typeSymbol: string) => ({ mode: "strict" as const, typeSymbol,
  create: () => schema, decode: (value: unknown) => schema.parse(value) });
const parameter = <T>(schema: z.ZodType<T>, symbol: string) => ({ name: "request", source: "json" as const,
  codec: codec(schema, symbol), strictCodec: codec(schema, symbol) });
const free = codec<unknown>(z.unknown(), "AttachmentFixtureValue");

export const attachmentFixtureContribution = createTypertRemoteInfo({ package: "@omp-webui/attachment-fixture", methods: {
  "ompAttachmentFixture/snapshot": { service: "ompAttachmentFixture", invocation: { kind: "direct" },
    parameters: [], result: codec(snapshot, "AttachmentFixtureSnapshot") },
  "ompAttachmentFixture/select": { service: "ompAttachmentFixture", invocation: { kind: "direct" },
    parameters: [parameter(describe, "AttachmentFixtureDescribe")], result: codec(snapshot, "AttachmentFixtureSnapshot") },
  "ompAttachmentFixture/send": { service: "ompAttachmentFixture", invocation: { kind: "direct" },
    parameters: [parameter(send, "AttachmentFixtureSend")], result: free },
  "ompAttachmentFixture/query": { service: "ompAttachmentFixture", invocation: { kind: "direct" },
    parameters: [parameter(query, "AttachmentFixtureQuery")], result: free },
  "ompAttachmentFixture/effects": { service: "ompAttachmentFixture", invocation: { kind: "direct" },
    parameters: [], result: free },
} }, z);
export const attachmentFixtureHostContribution: TypertContribution = { package: attachmentFixtureContribution.package, face: "host",
  schemas: [{ name: "AttachmentFixtureSnapshot", create: () => snapshot }],
  model: { services: [], events: [], objects: [] }, invocations: attachmentFixtureContribution.descriptors };
declare module "@deepseek-ai/dsh-typert-protocol" {
  interface TypertRemoteNamespaceMap {
    ompAttachmentFixture: {
      snapshot(): Promise<RemoteResult<AttachmentFixtureSnapshot>>;
      select(request: z.infer<typeof describe>): Promise<RemoteResult<AttachmentFixtureSnapshot>>;
      send(request: z.infer<typeof send>): Promise<RemoteResult<unknown>>;
      query(request: z.infer<typeof query>): Promise<RemoteResult<unknown>>;
      effects(): Promise<RemoteResult<unknown>>;
    };
  }
}
