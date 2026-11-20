import { parseProjectionBinding } from "@deepseek-ai/dsh-api-session-controller/projection";
import type { HistoryNavigationSourcePorts, NavigationAccess,
  NavigationProjectionOwner } from "../../../packages/history-navigation-source/ports.ts";
import type { BrowserAccess } from "../../../packages/access/index.ts";
import type { ChatComponentRuntime } from "./chat-component-runtime.ts";
import type { SessionSupervisor } from "../../../packages/sessions/supervisor.ts";
import { NavigationOperationStore } from "./navigation-operations.ts";

const cohort = "omp-webui-chat-component-v1";
const policy = Object.freeze({ version: "durable-navigation-v1" as const, status: "prototype" as const,
  durability: "process-crash-only" as const, query: "read-only-no-execution" as const, maxOperations: 256 });

export function createNavigationPorts(options: { supervisor: SessionSupervisor; runtime: ChatComponentRuntime;
  identity: () => BrowserAccess | undefined; revalidate: (identity: BrowserAccess) => boolean; dataDir: string;
}): HistoryNavigationSourcePorts {
  const repository = new NavigationOperationStore(options.dataDir);
  let current: BrowserAccess | undefined;
  const capture = (): BrowserAccess => {
    const identity = options.identity();
    if (!identity || !options.revalidate(identity)) throw new Error("navigation_authority_unavailable");
    return current = identity;
  };
  const projectionOwner: NavigationProjectionOwner = {
    invalidateAll(scope) {
      const identity = current;
      if (!identity || !options.revalidate(identity)) throw new Error("navigation_authority_unavailable");
      options.supervisor.invalidatePresentation(identity, scope.workerId, scope.sessionId);
    },
    async rebuild(scope, navigationId) {
      const identity = current ?? capture();
      const journal = await options.supervisor.refreshPresentation(identity, scope.workerId, scope.sessionId);
      if (!journal) throw new Error("navigation_projection_unavailable");
      return { navigationId, sessionId: scope.sessionId, previous: parseProjectionBinding(scope.projection),
        current: journal.projection, activeSnapshotId: journal.generation,
        liveHandoff: `${journal.generation}:${journal.cursor}`, publishedTo: "all_holders", retiredWriters: "rejected" };
    },
  };
  return {
    async authorize(peer, sessionId): Promise<NavigationAccess> {
      const identity = capture();
      const access = await options.supervisor.navigationAccess(identity, sessionId);
      return { scope: access.scope, client: access.worker.navigation, authoritySignal: peer.signal,
        matchedCohort: cohort, policy };
    },
    async idle(scope) {
      const identity = current ?? capture();
      const attached = await options.runtime.navigationIdle(identity, scope.workerId, scope.workerGeneration,
        scope.sessionId);
      if (attached) return attached;
      // No Chat View is attached: the same live worker state and empty interaction queue are the joint fact.
      const access = await options.supervisor.navigationAccess(identity, scope.sessionId);
      if (access.scope.workerId !== scope.workerId || access.scope.workerGeneration !== scope.workerGeneration) {
        throw new Error("navigation_binding_changed");
      }
      const state = await access.worker.state();
      const interactions = options.supervisor.interactions(identity)?.pending.length ?? 0;
      const settled = state.isSettled === true && state.isStreaming !== true && state.isCompacting !== true
        && state.hasPendingAsyncWork !== true;
      const queued = state.queuedMessageCount ?? 0;
      return { generation: scope.epoch, workerGeneration: scope.workerGeneration,
        scope: { kind: "session", sessionId: scope.sessionId }, status: settled ? "idle" : "stopping",
        nativeSettled: settled, acceptingWork: settled && queued === 0 && interactions === 0,
        pending: { interactions, history: 0, queued, other: state.hasPendingAsyncWork ? 1 : 0 },
        failures: [], forceAvailable: false, restored: null, draftConflict: false };
    },
    repository, projectionOwner,
  };
}
