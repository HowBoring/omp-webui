import { z } from "zod";
import { createTypertRemoteInfo } from "@deepseek-ai/dsh-typert-protocol/remote-info";
import type { RemoteResult } from "@deepseek-ai/dsh-typert-protocol";
import type { TypertContribution } from "@deepseek-ai/dsh-typert-registry";

/** Fixture-only view of the real worker. The product Host has no counterpart. */
export interface NavigationFixtureTreeItem {
  readonly id: string; readonly parentId: string | null; readonly kind: string;
  readonly active: boolean; readonly entryId: string | null;
  readonly text: string | null; readonly role: string | null;
}
export interface NavigationFixtureSnapshot {
  readonly phase: "booting" | "idle" | "crashed" | "reopened" | "failed";
  readonly sessionId: string; readonly starts: number; readonly nativeSessionId: string;
  readonly tree: NavigationFixtureTreeItem[]; readonly activeId: string | null;
  readonly hooks: { before: number; tree: number } | null; readonly providerCalls: number | null;
  readonly error?: string;
}
export type NavigationFixtureAction = { readonly type: "crash" } | { readonly type: "reopen" };

const treeItem = z.strictObject({ id: z.string().min(1).max(256), parentId: z.string().min(1).max(256).nullable(),
  kind: z.string().min(1).max(64), active: z.boolean(), entryId: z.string().min(1).max(256).nullable(),
  text: z.string().max(4096).nullable(), role: z.string().min(1).max(64).nullable() });
const snapshot = z.strictObject({ phase: z.enum(["booting", "idle", "crashed", "reopened", "failed"]),
  sessionId: z.string().uuid(), starts: z.number().int().nonnegative(), nativeSessionId: z.string().min(1).max(256),
  tree: z.array(treeItem).max(2048), activeId: z.string().min(1).max(256).nullable(),
  hooks: z.strictObject({ before: z.number().int().nonnegative(), tree: z.number().int().nonnegative() }).nullable(),
  providerCalls: z.number().int().nonnegative().nullable(), error: z.string().max(256).optional() });
const action = z.discriminatedUnion("type", [z.strictObject({ type: z.literal("crash") }), z.strictObject({ type: z.literal("reopen") })]);
const snapshotCodec = { mode: "strict" as const, typeSymbol: "NavigationFixtureSnapshot", create: () => snapshot,
  decode: (value: unknown) => snapshot.parse(value) as NavigationFixtureSnapshot };
const actionCodec = { mode: "strict" as const, typeSymbol: "NavigationFixtureAction", create: () => action,
  decode: (value: unknown) => action.parse(value) as NavigationFixtureAction };

/** Public fixture surface. Navigation itself is exercised through historyNavigationSourceContribution. */
export const navigationFixtureContribution = createTypertRemoteInfo({ package: "@omp-webui/navigation-fixture", methods: {
  "ompNavigationFixture/snapshot": { service: "ompNavigationFixture", invocation: { kind: "direct" }, parameters: [], result: snapshotCodec },
  "ompNavigationFixture/act": { service: "ompNavigationFixture", invocation: { kind: "direct" },
    parameters: [{ name: "action", source: "json", codec: actionCodec, strictCodec: actionCodec }], result: snapshotCodec },
}}, z);
export const navigationHostContribution: TypertContribution = {
  package: navigationFixtureContribution.package, face: "host",
  schemas: [{ name: "NavigationFixtureSnapshot", create: () => snapshot }], model: { services: [], events: [], objects: [] },
  invocations: navigationFixtureContribution.descriptors,
};
declare module "@deepseek-ai/dsh-typert-protocol" {
  interface TypertRemoteNamespaceMap {
    ompNavigationFixture: {
      snapshot(): Promise<RemoteResult<NavigationFixtureSnapshot>>;
      act(action: NavigationFixtureAction): Promise<RemoteResult<NavigationFixtureSnapshot>>;
    };
  }
}
