import { z } from "zod";
import { brandString, type Branded } from "@deepseek-ai/dsh-brand";
import { createTypertRemoteInfo } from "@deepseek-ai/dsh-typert-protocol/remote-info";
import type { RemoteResult } from "@deepseek-ai/dsh-typert-protocol";
import type { TypertContribution } from "@deepseek-ai/dsh-typert-registry";
import { interactionSnapshotSchema, interactionAnswerResultSchema, uiAnswerSchema } from "./interactions.ts";
import { sessionAttempt } from "./session-index.ts";
export type SessionSelectionId = Branded<"omp-session-selection">;
export type SessionWorkerId = Branded<"omp-session-worker">;
export type SessionRegistrationId = Branded<"omp-session-registration">;
const selection = z.string().uuid().transform(value => brandString<SessionSelectionId>(value));
const worker = z.string().uuid().transform(value => brandString<SessionWorkerId>(value));
const registration = z.string().uuid().transform(value => brandString<SessionRegistrationId>(value));
const path = z.string().min(1).max(4096), token = z.string().min(1).max(128);
const record = z.strictObject({ id: registration, nativeSessionId: path, sourceId: path, instanceId: path,
  cwd: path.optional(), title: z.string().max(8192).optional(), registeredAt: z.string().datetime(),
  observedAt: z.string().datetime(), attempt: sessionAttempt });
export const sessionViewSchema = z.strictObject({ registration: record, workerId: worker, generation: z.string().uuid(), cwd: path,
  state: z.enum(["opening", "open", "outcome_unknown", "closed"]) });
export type PublicSessionView = z.infer<typeof sessionViewSchema>;
const catalog = z.strictObject({ status: z.enum(["complete", "partial", "scanning"]),
  choices: z.array(z.strictObject({ selectionId: selection, nativeSessionId: path, sourceId: path, instanceId: path,
    cwd: path.optional(), title: z.string().max(8192).optional(), ownership: z.enum(["held", "free", "unknown"]),
    directory: z.string().max(32) })).max(32), nextCursor: token.optional() });
const index = z.strictObject({ records: z.array(record).max(32), nextCursor: token.optional() });
const page = z.strictObject({ cursor: token.optional(), pageSize: z.number().int().min(1).max(32).optional() });
const grant = z.strictObject({ id: z.string().uuid(), path, grantedAt: z.string().datetime(), status: z.enum(["valid", "changed"]) });
const preview = z.strictObject({ path, confirmation: z.string().uuid(), expiresAt: z.string().datetime() });
const codec = <T>(schema: z.ZodType<T>, typeSymbol: string) => ({ mode: "strict" as const, typeSymbol,
  create: () => schema, decode: (value: unknown) => schema.parse(value) });
const parameter = <T>(name: string, schema: z.ZodType<T>) => {
  const c = codec(schema, name); return { name, source: "json" as const, codec: c, strictCodec: c };
};
const method = <T>(parameters: ReturnType<typeof parameter>[], result: z.ZodType<T>) =>
  ({ service: "ompSessions", invocation: { kind: "direct" as const }, parameters, result: codec(result, "result") });
/** Authenticated isolated S1 component. Fixed actions only; no prompt sender or arbitrary native RPC/path selector. */
export const sessionsContribution = createTypertRemoteInfo({ package: "@omp-webui/sessions", methods: {
  "ompSessions/catalog": method([parameter("options", page)], catalog),
  "ompSessions/index": method([parameter("options", page)], index),
  "ompSessions/open": method([parameter("selectionId", selection)], sessionViewSchema),
  "ompSessions/switch": method([parameter("selectionId", selection)], sessionViewSchema),
  "ompSessions/new": method([parameter("grantId", z.string().uuid())], sessionViewSchema),
  "ompSessions/view": method([parameter("workerId", worker)], sessionViewSchema),
  "ompSessions/recheck": method([], sessionViewSchema),
  "ompSessions/interactions": method([], interactionSnapshotSchema.optional()),
  "ompSessions/answer": method([parameter("generation", z.string().uuid()), parameter("id", token), parameter("answer", uiAnswerSchema)], interactionAnswerResultSchema),
  "ompSessions/grants": method([], z.array(grant).max(256)),
  "ompSessions/preview": method([parameter("path", path)], preview),
  "ompSessions/confirm": method([parameter("confirmation", z.string().uuid())], grant),
  "ompSessions/revoke": method([parameter("grantId", z.string().uuid())], z.strictObject({ revoked: z.literal(true) })),
}}, z);
export const sessionsHostContribution: TypertContribution = { package: sessionsContribution.package, face: "host", schemas: [],
  model: { services: [], events: [], objects: [] }, invocations: sessionsContribution.descriptors };
declare module "@deepseek-ai/dsh-typert-protocol" {
  interface TypertRemoteNamespaceMap {
    ompSessions: {
      catalog(options: z.infer<typeof page>): Promise<RemoteResult<z.infer<typeof catalog>>>;
      index(options: z.infer<typeof page>): Promise<RemoteResult<z.infer<typeof index>>>;
      open(selectionId: SessionSelectionId): Promise<RemoteResult<PublicSessionView>>;
      switch(selectionId: SessionSelectionId): Promise<RemoteResult<PublicSessionView>>;
      "new"(grantId: string): Promise<RemoteResult<PublicSessionView>>;
      view(workerId: SessionWorkerId): Promise<RemoteResult<PublicSessionView>>;
      recheck(): Promise<RemoteResult<PublicSessionView>>;
      interactions(): Promise<RemoteResult<z.infer<typeof interactionSnapshotSchema> | undefined>>;
      answer(generation: string, id: string, answer: z.infer<typeof uiAnswerSchema>): Promise<RemoteResult<z.infer<typeof interactionAnswerResultSchema>>>;
      grants(): Promise<RemoteResult<z.infer<typeof grant>[]>>;
      preview(path: string): Promise<RemoteResult<z.infer<typeof preview>>>;
      confirm(confirmation: string): Promise<RemoteResult<z.infer<typeof grant>>>;
      revoke(grantId: string): Promise<RemoteResult<{ revoked: true }>>;
    }
  }
}
