import { z } from "zod";
import { brandString, type Branded } from "@deepseek-ai/dsh-brand";
import { createTypertRemoteInfo } from "@deepseek-ai/dsh-typert-protocol/remote-info";
import type { RemoteResult } from "@deepseek-ai/dsh-typert-protocol";
import type { TypertContribution } from "@deepseek-ai/dsh-typert-registry";
import descriptorValidator from "./generated/catalog-descriptor.js";
import strictState from "./generated/strict-state.js";
import type { CatalogDescriptor, StrictStartState } from "./generated/omp-wire.ts";
export type ContinuationSelectionId = Branded<"omp-continuation-selection">;
export type ContinuationRegistrationId = Branded<"omp-continuation-registration">;
export type ContinuationWorkerId = Branded<"omp-continuation-worker">;
const selection = z.string().uuid();
const actionSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("discover") }), z.strictObject({ type: z.literal("continue"), selectionId: selection }),
  z.strictObject({ type: z.literal("new") }), z.strictObject({ type: z.literal("cancel") }),
  z.strictObject({ type: z.literal("recheck") }), z.strictObject({ type: z.literal("close") }),
]);
export type ContinuationAction = Exclude<z.infer<typeof actionSchema>, { type: "continue" }>
  | { type: "continue"; selectionId: ContinuationSelectionId };
export interface ContinuationRegistration {
  id: ContinuationRegistrationId; intent: "continue" | "new";
  status: "registered"; attempt: "opening" | "open" | "failed" | "cancelling" | "cancelled" | "outcome_unknown" | "closed";
  nativeSessionId?: string | undefined; sourceId?: string | undefined; instanceId?: string | undefined; reference?: string | undefined; code?: string | undefined;
}
export interface ContinuationSnapshot {
  sessionAdmission: "blocked";
  choices: { selectionId: ContinuationSelectionId; descriptor: CatalogDescriptor }[];
  registrations: ContinuationRegistration[];
  worker: { status: "none" | "opening" | "open" | "outcome_unknown" | "closing" | "closed"; id?: ContinuationWorkerId | undefined; starts: number };
  state?: StrictStartState | undefined;
}
const registration = z.strictObject({ id: z.string().uuid(), intent: z.enum(["continue", "new"]), status: z.literal("registered"),
  attempt: z.enum(["opening", "open", "failed", "cancelling", "cancelled", "outcome_unknown", "closed"]),
  nativeSessionId: z.string().optional(), sourceId: z.string().optional(), instanceId: z.string().optional(),
  reference: z.string().max(4096).optional(), code: z.string().max(96).optional() });
const descriptor = z.custom<CatalogDescriptor>(descriptorValidator);
const snapshotSchema = z.strictObject({ sessionAdmission: z.literal("blocked"),
  choices: z.array(z.strictObject({ selectionId: z.string().uuid(), descriptor })).max(32),
  registrations: z.array(registration).max(32),
  worker: z.strictObject({ status: z.enum(["none", "opening", "open", "outcome_unknown", "closing", "closed"]), id: z.string().uuid().optional(), starts: z.number().int().nonnegative() }),
  state: z.custom<StrictStartState>(strictState).optional() });
export function decodeContinuationAction(value: unknown): ContinuationAction {
  const parsed = actionSchema.parse(value);
  return parsed.type === "continue" ? { ...parsed, selectionId: brandString<ContinuationSelectionId>(parsed.selectionId) } : parsed;
}
export function decodeContinuationSnapshot(value: unknown): ContinuationSnapshot {
  const parsed = snapshotSchema.parse(value);
  return { ...parsed, choices: parsed.choices.map(item => ({ ...item, selectionId: brandString<ContinuationSelectionId>(item.selectionId) })),
    registrations: parsed.registrations.map(item => ({ ...item, id: brandString<ContinuationRegistrationId>(item.id) })),
    worker: { status: parsed.worker.status, starts: parsed.worker.starts,
      ...(parsed.worker.id ? { id: brandString<ContinuationWorkerId>(parsed.worker.id) } : {}) } };
}
const actionCodec = { mode: "strict" as const, typeSymbol: "ContinuationAction", create: () => actionSchema, decode: decodeContinuationAction };
const snapshotCodec = { mode: "strict" as const, typeSymbol: "ContinuationSnapshot", create: () => snapshotSchema, decode: decodeContinuationSnapshot };
/** Public typed fixture surface. Opaque selection IDs never become browser paths, executable names or argv. */
export const continuationContribution = createTypertRemoteInfo({ package: "@omp-webui/continuation-fixture", methods: {
  "ompContinuationFixture/snapshot": { service: "ompContinuationFixture", invocation: { kind: "direct" }, parameters: [], result: snapshotCodec },
  "ompContinuationFixture/act": { service: "ompContinuationFixture", invocation: { kind: "direct" },
    parameters: [{ name: "action", source: "json", codec: actionCodec, strictCodec: actionCodec }], result: snapshotCodec },
}}, z);
export const continuationHostContribution: TypertContribution = { package: continuationContribution.package, face: "host",
  schemas: [{ name: "ContinuationSnapshot", create: () => snapshotSchema }], model: { services: [], events: [], objects: [] },
  invocations: continuationContribution.descriptors };
declare module "@deepseek-ai/dsh-typert-protocol" {
  interface TypertRemoteNamespaceMap {
    ompContinuationFixture: {
      snapshot(): Promise<RemoteResult<ContinuationSnapshot>>;
      act(action: ContinuationAction): Promise<RemoteResult<ContinuationSnapshot>>;
    };
  }
}
