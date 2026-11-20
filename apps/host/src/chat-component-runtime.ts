/**
 * Component-only Chat composition over the current supervised worker.
 *
 * It enrolls one explicitly attached browser View, and every prompt still passes through the public
 * DSH `session/prompt` descriptor, the reviewed Chat Gateway, and the native submission transport.
 * Stop is the real #48 coordinator over public RPC: pending answers, history summary and the
 * unexecuted queue are withdrawn before the interruption, and quiescence is only the joint native
 * settle plus Host pending and queue facts. Force stays a separate, user-confirmed 30s offer.
 */
import { randomUUID } from "node:crypto";
import { parseProjectionBinding } from "@deepseek-ai/dsh-api-session-controller/projection";
import type { BrowserAccess, BrowserAuthority } from "../../../packages/access/index.ts";
import type { ChatAttachment, ChatAttachmentResult } from "../../../packages/contracts/chat-component.ts";
import type { SubmissionClientCommand } from "../../../packages/contracts/candidates/durable-submission-v1/submission-client.ts";
import type { SessionState, AbortAndRestoreQueueResult, PromptResultEvent, RpcWireCommands,
  SessionSettledEvent } from "../../../packages/contracts/generated/omp-wire.ts";
import type { StopSnapshot } from "../../../packages/contracts/stop.ts";
import type { StopCaller } from "../../../packages/interactions/stop-service.ts";
import { StopCoordinator, createStopNativePort, type StopPage } from "../../../packages/interactions/stop.ts";
import liveNotification from "../../../packages/contracts/generated/live-notification.js";
import type { DirectoryGrants } from "../../../packages/workspaces/grants.ts";
import { ChatGateway, type ChatWorkerPort } from "../../../packages/chat/gateway.ts";
import type { AttachmentSubmissionGate } from "../../../packages/attachments/submission-gate.ts";
import type { AttachmentNativePort } from "../../../packages/attachments/bridge.ts";
import type { SubmissionTarget } from "../../../packages/contracts/generated/omp-wire.ts";
import type { ChatViewAdmission, ChatViewEnrollment } from "./chat-view-admission.ts";
import type { SessionSupervisor, SessionView, SupervisedSessionWorker } from "../../../packages/sessions/supervisor.ts";

interface Entry {
  readonly workerId: string;
  readonly generation: string;
  readonly sessionId: string;
  readonly target: ChatWorkerPort["target"];
  readonly grantId: string;
  readonly worker: SupervisedSessionWorker;
  readonly gateway: ChatGateway;
  readonly lifetime: AbortController;
  readonly idleGeneration: string;
  readonly unsubscribe: () => void;
  readonly stop: StopCoordinator;
  readonly pages: Map<string, StopPage>;
  idle: StopSnapshot;
  native?: Partial<SessionState>;
  refreshing?: Promise<void> | undefined;
  poller?: ReturnType<typeof setInterval> | undefined;
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
    private readonly supervisor: Pick<SessionSupervisor, "runtime" | "view" | "forceWorker">,
    private readonly admission: ChatViewAdmission, private readonly gate?: AttachmentSubmissionGate) {}

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
        entry = this.#entry(identity, view, worker, grantId);
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
      // A reload keeps this worker; a Session switch away and back retires it and enrolls a new generation.
      // The attached worker is the only Chat target for its native Session, so its predecessor can no longer be chosen.
      for (const [candidate, held] of this.#entries) {
        if (candidate !== key && held.sessionId === entry.sessionId) this.#discard(candidate);
      }
      this.#views.set(identity.credentialId, { enrollment, owner, workerId: view.workerId,
        generation: view.generation, draftId: input.draftId });
      this.#page(entry, identity);
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

  /** Exact coordinator/page for one authenticated Chat invocation; never a browser-supplied binding. */
  stopBinding(identity: BrowserAccess): StopCaller | undefined {
    if (this.#closed || !this.authority.revalidate(identity)) return;
    const held = this.#views.get(identity.credentialId);
    if (!held) return;
    const entry = this.#entries.get(`${held.workerId}\u0000${held.generation}`);
    const page = entry?.pages.get(identity.credentialId);
    if (!entry || !page) return;
    return { coordinator: entry.stop, page, refresh: () => this.#refresh(entry, page) };
  }

  /** The gate's native port is the exact retained worker for the prepared target, never a browser tunnel. */
  native(target: SubmissionTarget): AttachmentNativePort {
    for (const entry of this.#entries.values()) {
      if (entry.target.nativeSessionId !== target.nativeSessionId || entry.target.sourceId !== target.sourceId
        || entry.target.instanceId !== target.instanceId) continue;
      return {
        prepare: input => entry.worker.attachments.prepare(input),
        cancel: preparationId => entry.worker.attachments.cancel(preparationId),
        submit: input => entry.worker.submissions.submit(input),
        query: (clientSubmissionId, offset, limit) => entry.worker.submissions.query(clientSubmissionId, offset, limit),
      };
    }
    throw Error("ATTACHMENT_TARGET_CHANGED");
  }

  /** Rechecks the attached View, grant and live worker before any original or preparation authority is granted. */
  attachment(identity: BrowserAccess, sessionId: string, draftId: string): { view: SessionView; entry: Entry } | undefined {
    if (this.#closed || !this.authority.revalidate(identity)) return;
    const held = this.#views.get(identity.credentialId);
    if (!held || held.draftId !== draftId) return;
    const entry = this.#entries.get(`${held.workerId}\u0000${held.generation}`);
    if (!entry || entry.sessionId !== sessionId) return;
    let current: SessionView;
    try { current = this.supervisor.runtime(identity, held.workerId).view; } catch { return; }
    if (current.state !== "open" || current.workerId !== held.workerId || current.generation !== held.generation
      || current.registration.nativeSessionId !== sessionId || current.registration.sourceId !== entry.target.sourceId
      || current.registration.instanceId !== entry.target.instanceId || this.#grantId(current.cwd) !== entry.grantId) return;
    return { view: current, entry };
  }

  close(): void {
    this.#closed = true;
    for (const view of this.#views.values()) view.enrollment.revoke();
    this.#views.clear();
    for (const key of [...this.#entries.keys()]) this.#discard(key);
    this.admission.close();
  }

  #discard(key: string): void {
    const entry = this.#entries.get(key);
    if (!entry) return;
    this.#entries.delete(key);
    entry.unsubscribe();
    entry.lifetime.abort();
    this.#stopPolling(entry);
    for (const page of entry.pages.values()) entry.stop.disconnect(page);
    entry.stop.close();
  }

  #grantId(cwd: string): string | undefined {
    for (const grant of this.grants.list()) {
      const access = this.grants.authorize(cwd, cwd, grant.id);
      if (access.status === "authorized" && access.grantIdentity) return grant.id;
    }
  }

  #page(entry: Entry, identity: BrowserAccess): StopPage {
    const held = entry.pages.get(identity.credentialId);
    if (held) return held;
    const page = entry.stop.attach({ credentialId: identity.credentialId, clientId: identity.credentialId,
      peerId: identity.credentialId });
    entry.pages.set(identity.credentialId, page);
    return page;
  }

  #entry(identity: BrowserAccess, view: SessionView, worker: SupervisedSessionWorker, grantId: string): Entry {
    const { nativeSessionId, sourceId, instanceId } = view.registration;
    const target = { nativeSessionId, sourceId, instanceId };
    const lifetime = new AbortController();
    const idleGeneration = randomUUID();
    const scope = { kind: "session" as const, sessionId: nativeSessionId };
    let entry: Entry;
    const stop = new StopCoordinator(scope, view.generation, createStopNativePort({
      abortBranchSummary: async command => await worker.control(command.type) as
        RpcWireCommands["abort_branch_summary"]["result"],
      abortAndRestoreQueue: async command => await worker.control(command.type) as AbortAndRestoreQueueResult,
    }), {
      beginStop: async () => {}, cancellationUncertain: () => false,
      pending: () => {
        const state = entry.native;
        return { interactions: 0, history: 0, queued: state?.queuedMessageCount ?? 0,
          other: state?.hasPendingAsyncWork === true ? 1 : 0 };
      },
      resume: () => {},
    }, (page, held) => {
      if (page.credentialId !== identity.credentialId || held.kind !== "session" || held.sessionId !== nativeSessionId) return false;
      if (this.#views.get(page.credentialId)?.owner !== undefined && !this.authority.revalidate(identity)) return false;
      return this.#entries.get(`${view.workerId}\u0000${view.generation}`) === entry;
    }, () => performance.now(), {
      workerGeneration: view.generation,
      isCurrent: () => {
        try { return this.supervisor.runtime(identity, view.workerId).view.generation === view.generation; }
        catch { return false; }
      },
      terminateAndReap: () => this.supervisor.forceWorker(identity, view.workerId, view.generation),
    });
    const gateway = new ChatGateway({
      sessionId: nativeSessionId, generation: view.generation, target, lifetime: lifetime.signal,
      matchedCohort: "omp-webui-chat-component-v1",
      authorize: (caller, sessionId) => this.admission.authorize(caller, sessionId, { generation: view.generation, target }),
      // Real #48 snapshot: status/force/restored queue/draft conflict all come from the coordinator.
      stop: () => entry.idle,
      state: async () => {
        const state = await worker.state();
        entry.native = state;
        entry.stop.observeState(view.generation, state);
        const page = entry.pages.values().next().value;
        if (page) entry.idle = entry.stop.state(page);
        return state;
      },
      request: async (command: SubmissionClientCommand) => await worker.submitCommand(command),
      cancel: async () => {
        const page = entry.pages.values().next().value;
        if (page) { entry.stop.stop(page); this.#refresh(entry, page); return; }
        await worker.control("abort_and_restore_queue");
      },
      ...(this.gate ? { attachments: {
        has: (requestId: string) => this.gate!.has(requestId),
        submit: (requestId: string, message: string, signal: AbortSignal) => this.gate!.submit(requestId, message, signal),
        recovery: (requestId: string) => this.gate!.recovery(requestId),
      } } : {}),
    });
    const unsubscribe = worker.subscribe(frame => {
      gateway.observe(frame);
      if (!liveNotification(frame)) return;
      if (frame.type === "session_settled" || (frame.type === "prompt_result" && frame.sessionSettled))
        stop.observeNotification(view.generation, frame as PromptResultEvent | SessionSettledEvent);
    });
    entry = { workerId: view.workerId, generation: view.generation, sessionId: nativeSessionId, target, grantId, worker,
      gateway, lifetime, idleGeneration, unsubscribe, stop, pages: new Map(),
      idle: { generation: idleGeneration, workerGeneration: view.generation, scope, status: "idle", nativeSettled: false,
        acceptingWork: false, pending: { interactions: 0, history: 0, queued: 0, other: 0 }, failures: [],
        forceAvailable: false, restored: null, draftConflict: false } };
    return entry;
  }

  /** One real get_state observation per tick while Stop is in flight; settlement clears the poller. */
  #refresh(entry: Entry, page: StopPage): void {
    const snapshot = entry.stop.state(page);
    entry.idle = snapshot;
    if (snapshot.status !== "stopping" && snapshot.status !== "terminating") { this.#stopPolling(entry); return; }
    if (!entry.refreshing) entry.refreshing = this.#observe(entry, page);
    if (entry.poller) return;
    entry.poller = setInterval(() => { if (!entry.refreshing) entry.refreshing = this.#observe(entry, page); }, 250);
    entry.poller.unref?.();
  }

  async #observe(entry: Entry, page: StopPage): Promise<void> {
    try {
      const state = await entry.worker.state();
      entry.native = state;
      entry.stop.observeState(entry.generation, state);
    } catch { entry.stop.observe(entry.generation, { kind: "eof" }); }
    entry.idle = entry.stop.state(page);
    if (entry.idle.status !== "stopping" && entry.idle.status !== "terminating") this.#stopPolling(entry);
    entry.refreshing = undefined;
  }

  #stopPolling(entry: Entry): void {
    if (entry.poller) clearInterval(entry.poller);
    entry.poller = undefined;
  }
}
