import { z } from "zod";
import { createTypertRemoteInfo } from "@deepseek-ai/dsh-typert-protocol/remote-info";
import type { RemoteResult } from "@deepseek-ai/dsh-typert-protocol";
import type { TypertContribution } from "@deepseek-ai/dsh-typert-registry";
import { catalogPageInput } from "./catalog.ts";
import { validCatalogPage, validCatalogSources } from "./generated/catalog.generated.ts";
import type { CatalogPage, CatalogSources } from "./generated/omp-wire.ts";
const path = z.string().min(1).max(4096), id = z.string().uuid();
const directory = z.strictObject({ status: z.enum(["authorized", "ungranted", "unknown", "missing", "inaccessible", "changed"]),
  canonical: path.optional() });
const registered = z.strictObject({ items: z.array(z.strictObject({ id: z.string().max(128),
  nativeSessionId: z.string().max(128), title: z.string().max(8192),
  nativeStatus: z.enum(["verified", "missing", "replaced", "invalid_reference", "source_unavailable", "inaccessible"]),
  observedAt: z.string().datetime(), directory, ownership: z.strictObject({ state: z.enum(["held", "free", "unknown"]),
    observedAt: z.string().datetime() }), admission: z.literal("blocked_pending_41_44") })).max(32),
  nextCursor: z.string().max(128).optional() });
export type RegisteredPage = z.infer<typeof registered>;
const grant = z.strictObject({ id, path, grantedAt: z.string().datetime(), status: z.enum(["valid", "changed"]) });
const preview = z.strictObject({ path, confirmation: id, expiresAt: z.string().datetime() });
const row = z.strictObject({ sourceId: z.string(), instanceId: z.string(), directory,
  registration: z.literal("discovered"), admission: z.literal("blocked_pending_41_44") });
const page = z.discriminatedUnion("status", [z.strictObject({ status: z.literal("ok"),
  page: z.custom<CatalogPage>(validCatalogPage), access: z.array(row).max(32) }),
  z.strictObject({ status: z.literal("error"), code: z.string().regex(/^CATALOG_[A-Z_]+$/).max(96) })]);
export type WorkspacePage = z.infer<typeof page>;
export type Grant = z.infer<typeof grant>;
export type GrantPreview = z.infer<typeof preview>;
const codec = <T>(schema: z.ZodType<T>, typeSymbol: string) =>
  ({ mode: "strict" as const, typeSymbol, create: () => schema, decode: (value: unknown) => schema.parse(value) });
const parameter = <T>(name: string, schema: z.ZodType<T>) => {
  const value = codec(schema, name); return { name, source: "json" as const, codec: value, strictCodec: value };
};
const method = <T>(parameters: ReturnType<typeof parameter>[], schema: z.ZodType<T>) =>
  ({ service: "ompWorkspaces", invocation: { kind: "direct" as const }, parameters, result: codec(schema, "result") });
/** Isolated authenticated component surface; no Session history/open/execution methods. */
export const workspaceContribution = createTypertRemoteInfo({ package: "@omp-webui/workspaces", methods: {
  "ompWorkspaces/sources": method([], z.custom<CatalogSources>(validCatalogSources)),
  "ompWorkspaces/page": method([parameter("options", catalogPageInput)], page),
  "ompWorkspaces/registered": method([parameter("options", catalogPageInput)], registered),
  "ompWorkspaces/grants": method([], z.array(grant).max(256)),
  "ompWorkspaces/preview": method([parameter("path", path)], preview),
  "ompWorkspaces/confirm": method([parameter("confirmation", id)], grant),
  "ompWorkspaces/revoke": method([parameter("id", id)], z.strictObject({ revoked: z.literal(true),
    workers: z.literal("unavailable_pending_44") })),
}}, z);
export const workspaceHostContribution: TypertContribution = { package: workspaceContribution.package, face: "host",
  schemas: [], model: { services: [], events: [], objects: [] }, invocations: workspaceContribution.descriptors };
declare module "@deepseek-ai/dsh-typert-protocol" {
  interface TypertRemoteNamespaceMap {
    ompWorkspaces: {
      sources(): Promise<RemoteResult<CatalogSources>>;
      page(options: z.infer<typeof catalogPageInput>): Promise<RemoteResult<WorkspacePage>>;
      registered(options: z.infer<typeof catalogPageInput>): Promise<RemoteResult<RegisteredPage>>;
      grants(): Promise<RemoteResult<Grant[]>>;
      preview(path: string): Promise<RemoteResult<GrantPreview>>;
      confirm(confirmation: string): Promise<RemoteResult<Grant>>;
      revoke(id: string): Promise<RemoteResult<{ revoked: true; workers: "unavailable_pending_44" }>>;
    }
  }
}
