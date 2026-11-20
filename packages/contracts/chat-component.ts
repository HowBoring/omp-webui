/**
 * Component-only Chat View enrollment. The browser supplies the worker it already opened and the exact
 * projection it holds; the Host verifies both and returns its own draft owner. Absent from the product
 * Chat contract until private Session admission is reviewed.
 */
import { z } from "zod";
import { createTypertRemoteInfo } from "@deepseek-ai/dsh-typert-protocol/remote-info";
import type { RemoteResult } from "@deepseek-ai/dsh-typert-protocol";
import type { TypertContribution } from "@deepseek-ai/dsh-typert-registry";
import { chatSessionId } from "./chat.ts";

export const chatProjection = z.strictObject({ source: z.string().min(1).max(512), generation: z.string().min(1).max(512) });
export type ChatProjection = z.infer<typeof chatProjection>;
export const chatAttachment = z.strictObject({
  workerId: z.string().min(1).max(128),
  projection: chatProjection,
  draftId: z.string().min(1).max(128),
});
export const chatAttachmentResult = z.strictObject({
  owner: z.string().min(1).max(128),
  workerId: z.string().min(1).max(128),
  sessionId: chatSessionId,
  generation: z.string().min(1).max(128),
  draftId: z.string().min(1).max(128),
});
export type ChatAttachment = z.infer<typeof chatAttachment>;
export type ChatAttachmentResult = z.infer<typeof chatAttachmentResult>;
const codec = <T>(schema: z.ZodType<T>, typeSymbol: string) => ({ mode: "strict" as const, typeSymbol,
  create: () => schema, decode: (value: unknown) => schema.parse(value) });
const input = codec(chatAttachment, "ChatAttachment");

export const chatComponentContribution = createTypertRemoteInfo({ package: "@omp-webui/chat-component", methods: {
  "ompChatComponent/attach": { service: "ompChatComponent", implementation: "enroll", invocation: { kind: "direct" },
    parameters: [{ name: "input", source: "json" as const, codec: input, strictCodec: input }],
    result: codec(chatAttachmentResult, "ChatAttachmentResult") },
} }, z);
export const chatComponentHostContribution: TypertContribution = { package: chatComponentContribution.package,
  face: "host", schemas: [], model: { services: [], events: [], objects: [] },
  invocations: chatComponentContribution.descriptors };
declare module "@deepseek-ai/dsh-typert-protocol" {
  interface TypertRemoteNamespaceMap {
    ompChatComponent: { attach(input: ChatAttachment):
      Promise<RemoteResult<ChatAttachmentResult>> };
  }
}
