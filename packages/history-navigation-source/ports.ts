import type { PeerScope } from "@deepseek-ai/dsh-typert-protocol";
import type { SessionProjectionBinding } from "@deepseek-ai/dsh-api-session-controller/types";
import type { NavigationClient } from "../contracts/candidates/durable-navigation-v1/navigation-client.ts";
import type { NavigationPolicy, NavigationPreview, NavigationResult } from "../contracts/candidates/durable-navigation-v1/omp-wire.ts";
import type { StopSnapshot } from "../contracts/stop.ts";

/** Trusted Host identity. Every field is snapshotted before any await. No browser-supplied scope. */
export interface NavigationScope {
  readonly browser: string; readonly grant: string; readonly directory: string; readonly epoch: string;
  readonly sourceId: string; readonly instanceId: string; readonly nativeSessionId: string;
  readonly sessionId: string; readonly workerId: string; readonly workerGeneration: string;
  readonly contextId: string; readonly projection: SessionProjectionBinding;
}
export interface NavigationAccess {
  readonly scope: NavigationScope;
  readonly client: NavigationClient;
  /** Trusted lifetime; abort synchronously on revocation, worker loss or authority epoch replacement. */
  readonly authoritySignal: AbortSignal;
  /** Trusted, independently matched schema/server/cohort identity; never derived from a browser assertion. */
  readonly matchedCohort: string;
  readonly policy: NavigationPolicy;
}
/** Metadata only: never editor text, messages, a tree, or a target to replay automatically. */
export interface NavigationOperationMetadata {
  readonly navigationId: string;
  readonly matchedCohort: string;
  readonly scope: NavigationScope;
  readonly confirmation: NavigationPreview;
  readonly options: "native_defaults";
  readonly state: "unknown" | "resolved" | "not_dispatched";
  readonly outcome?: NavigationResult["outcome"];
  readonly persistence?: NavigationResult["persistence"];
  readonly commitId?: string;
  readonly actualLeafId?: string | null;
}
export interface NavigationOperationRepository {
  /** Atomically persist unknown before dispatch. Refuse an existing key, unresolved operation for this native
   * Session (including previous workers/Host lifetimes), or capacity overflow. Resolve only after durability
   * is established; errors/uncertain writes never authorize dispatch. Limit must not exceed maxOperations. */
  reserveUnknown(record: NavigationOperationMetadata, maxOperations: number): Promise<boolean>;
  read(navigationId: string): Promise<NavigationOperationMetadata | undefined>;
  /** Preserve immutable committed facts; uncertain/absent/reserved replies must remain unknown.
   * not_dispatched is permitted only when the coordinator proves it never called the native client. */
  recordResult(record: NavigationOperationMetadata): Promise<void>;
}
export interface ProjectionRebuildProof {
  readonly navigationId: string;
  readonly sessionId: string;
  readonly previous: SessionProjectionBinding;
  readonly current: SessionProjectionBinding;
  readonly activeSnapshotId: string;
  readonly liveHandoff: string;
  readonly publishedTo: "all_holders";
  readonly retiredWriters: "rejected";
}
export interface NavigationProjectionOwner {
  /** Synchronous, unconditional invalidation for every holder, even after peer revocation. Idempotent by operation key.
   * Withdraw old rows/pages/attempts and reject retired writers without touching independent drafts/Interactions. */
  invalidateAll(scope: NavigationScope, navigationId: string): void;
  /** Reconstruct the coherent native active snapshot/live cut and publish one new generation to all holders. */
  rebuild(scope: NavigationScope, navigationId: string): Promise<ProjectionRebuildProof>;
}
export interface HistoryNavigationSourcePorts {
  /** Synchronously recheck browser, grant/directory, exact native identity, worker, ownership and projection. */
  authorize(peer: PeerScope, sessionId: string): NavigationAccess;
  /** Authoritative joint Stop state, scoped to this exact worker and Broker Session. No browser state. */
  idle(scope: NavigationScope): StopSnapshot;
  readonly repository: NavigationOperationRepository;
  readonly projectionOwner: NavigationProjectionOwner;
  readonly now?: () => number;
}
