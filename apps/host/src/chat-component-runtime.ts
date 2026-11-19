/**
 * Component-only Chat composition over the current supervised worker.
 *
 * It enrolls one explicitly attached browser View, and every prompt still passes through the public
 * DSH `session/prompt` descriptor, the reviewed Chat Gateway, and the native submission transport.
 * Stop/idle facts come from the public get_state reply; the product stop broker is not composed here.
 */
import { randomUUID } from "node:crypto";
import type { SessionProjectionBinding } from "@deepseek-ai/dsh-api-session-controller/types";
import { parseProjectionBinding } from "@deepseek-ai/dsh-api-session-controller/projection";
import type { BrowserAccess, BrowserAuthority } from "../../../packages/access/index.ts";
import type { ChatAttachment, ChatAttachmentResult } from "../../../packages/contracts/chat-component.ts";
import type { SubmissionClientCommand } from "../../../packages/contracts/candidates/durable-submission-v1/submission-client.ts";
import type { SessionState } from "../../../packages/contracts/generated/omp-wire.ts";
import type { StopSnapshot } from "../../../packages/contracts/stop.ts";
import type { DirectoryGrants } from "../../../packages/workspaces/grants.ts";
import { ChatGateway, type ChatWorkerPort } from "../../../packages/chat/gateway.ts";
import type { ChatViewAdmission, ChatViewEnrollment } from "./chat-view-admission.ts";
import type { SessionSupervisor, SupervisedSessionWorker } from "../../../packages/sessions/supervisor.ts";

interface Entry {
  readonly workerId: string;
  readonly generation: string;
  readonly sessionId: string;
  readonly target: ChatWorkerPort["target"];
  readonly grantId: string;
  readonly gateway: ChatGateway;
  readonly lifetime: AbortController;
  readonly idleGeneration: string;
  idle: StopSnapshot;
}

interface View {
  readonly enrollment: ChatViewEnrollment;
  readonly owner: string;
  readonly workerId: string;
  readonly generation: string;
  readonly draftId: string;
}

export class ChatComponentRuntime {
  readonly #entries = new Map<string, Entry>();
  readonly #views = new Map<string, View>();
  #closed = false;

  constructor(private readonly authority: BrowserAuthority, private readonly grants: DirectoryGrants,
    private readonly supervisor: Pick<SessionSupervisor, "runtime" | "view">, private readonly admission: ChatViewAdmission) {}

  attach(identity: BrowserAccess, input: ChatAttachment): ChatAttachmentResult | undefined {
    if (this.#closed) return;
    try {
      const { view, worker } = this.supervisor.runtime(identity, input.workerId);
      if (view.state !== "open") return;
      const grantId = this.#grantId(view.cwd);
      if (!grantId) return;
      const projection = parseProjectionBinding(input.projection);
      const key = `${view.workerId}\u0000${view.generation}`;
      let entry = this.#entries.get(key);
      if (!entry) {
        entry = this.#entry(view, worker, grantId);
        this.#entries.set(key, entry);
      }
      const previous = this.#views.get(identity.credentialId);
      previous?.enrollment.revoke();
      const lifetime = new AbortController();
      const enrollment = this.admission.enroll(identity, { workerId: view.workerId, grantId, lifetime: lifetime.signal,
        projection: () => projection });
      if (!enrollment) return;
      const same = previous && previous.workerId === view.workerId && previous.generation === view.generation
        && previous.draftId === input.draftId ? previous : undefined;
      const owner = same?.owner ?? randomUUID();
      this.#views.set(identity.credentialId, { enrollment, owner, workerId: view.workerId,
        generation: view.generation, draftId: input.draftId });
      return { owner, workerId: view.workerId, sessionId: entry.sessionId, generation: view.generation,
        draftId: input.draftId };
    } catch { return; }
  }

  enrollment(identity: BrowserAccess): ChatViewEnrollment | undefined {
    const view = this.#views.get(identity.credentialId);
    if (!view || !this.authority.revalidate(identity)) return;
    return view.enrollment;
  }

  gateway(sessionId: string): ChatGateway | undefined {
    for (const entry of this.#entries.values()) if (entry.sessionId === sessionId) return entry.gateway;
  }

  close(): void {
    this.#closed = true;
    for (const view of this.#views.values()) view.enrollment.revoke();
    this.#views.clear();
    for (const entry of this.#entries.values()) entry.lifetime.abort();
    this.#entries.clear();
    this.admission.close();
  }

  #grantId(cwd: string): string | undefined {
    for (const grant of this.grants.list()) {
      const access = this.grants.authorize(cwd, cwd, grant.id);
      if (access.status === "authorized" && access.grantIdentity) return grant.id;
    }
  }

  #entry(view: ReturnType<SessionSupervisor["view"]>, worker: SupervisedSessionWorker, grantId: string): Entry {
    const { nativeSessionId, sourceId, instanceId } = view.registration;
    const target = { nativeSessionId, sourceId, instanceId };
    const lifetime = new AbortController();
    const idleGeneration = randomUUID();
    let idle = this.#snapshot(idleGeneration, view.generation, nativeSessionId, undefined);
    const gateway = new ChatGateway({
      sessionId: nativeSessionId, generation: view.generation, target, lifetime: lifetime.signal,
      matchedCohort: "omp-webui-chat-component-v1",
      authorize: (caller, sessionId) => this.admission.authorize(caller, sessionId, { generation: view.generation, target }),
      // The component has no product stop broker; the last public get_state reply is the joint idle fact.
      stop: () => idle,
      state: async () => {
        const state = await worker.state();
        idle = this.#snapshot(idleGeneration, view.generation, nativeSessionId, state);
        return state;
      },
      request: (command: SubmissionClientCommand) => worker.submitCommand(command),
    });
    return { workerId: view.workerId, generation: view.generation, sessionId: nativeSessionId, target, grantId,
      gateway, lifetime, idleGeneration, idle };
  }

  #snapshot(generation: string, workerGeneration: string, sessionId: string, state: Partial<SessionState> | undefined): StopSnapshot {
    const settled = state?.isSettled === true && state.isStreaming !== true;
    const queued = state?.queuedMessageCount ?? 0;
    const other = state?.hasPendingAsyncWork === true ? 1 : 0;
    return { generation, workerGeneration, scope: { kind: "session", sessionId }, status: settled ? "idle" : "stopping",
      nativeSettled: settled, acceptingWork: settled && queued === 0 && other === 0,
      pending: { interactions: 0, history: 0, queued, other }, failures: [], forceAvailable: false,
      restored: null, draftConflict: false };
  }
}
