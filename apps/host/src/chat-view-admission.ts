import type { PeerScope } from "@deepseek-ai/dsh-typert-protocol";
import { parseProjectionBinding, sameProjection } from "@deepseek-ai/dsh-api-session-controller/projection";
import type { SessionProjectionBinding } from "@deepseek-ai/dsh-api-session-controller/types";
import { chatViewCaller } from "../../../packages/chat/service.ts";
import type { ChatCaller, ChatWorkerPort } from "../../../packages/chat/gateway.ts";
import type { BrowserAccess, BrowserAuthority } from "../../../packages/access/index.ts";
import type { SessionSupervisor } from "../../../packages/sessions/supervisor.ts";
import { sameSubmissionTarget } from "../../../packages/contracts/submission-reply.ts";
import type { DirectoryGrants } from "../../../packages/workspaces/grants.ts";

/** Trusted composition supplies one lifetime for the exact View and draft attachment to the open worker. */
export interface ChatViewSelection {
  readonly workerId: string;
  readonly grantId: string;
  readonly lifetime: AbortSignal;
  projection(): SessionProjectionBinding | undefined;
}

/** Host-side handle. Its object identity must survive reconnects of the same View and draft. */
export interface ChatViewEnrollment { revoke(): void }

interface WorkerScope extends Pick<ChatWorkerPort, "generation" | "target"> {
  readonly cwd: string;
  readonly grantIdentity: string;
}

interface Enrollment {
  readonly identity: BrowserAccess;
  readonly selection: ChatViewSelection;
  readonly worker: WorkerScope;
  readonly owner: string;
  readonly control: AbortController;
}

interface Invocation {
  readonly peer: PeerScope;
  readonly enrollment: Enrollment;
  readonly projection: SessionProjectionBinding;
  current(): boolean;
}

const maxViews = 128;

/** Host-only enrollment and worker authorization. No request data creates an enrollment. */
export class ChatViewAdmission {
  readonly #enrollments = new Map<ChatViewEnrollment, Enrollment>();
  readonly #invocations = new WeakMap<object, Invocation>();
  #closed = false;

  constructor(readonly authority: BrowserAuthority, private readonly grants: DirectoryGrants,
    private readonly supervisor: Pick<SessionSupervisor, "view">) {}

  enroll(identity: BrowserAccess, selection: ChatViewSelection): ChatViewEnrollment | undefined {
    if (this.#closed || this.#enrollments.size >= maxViews || selection.lifetime.aborted) return;
    const { workerId, grantId, lifetime } = selection;
    if (!grantId) return;
    const worker = this.#worker(identity, workerId, grantId);
    if (!worker || lifetime.aborted) return;
    const record: Enrollment = { identity, selection: { workerId, grantId, lifetime, projection: () => selection.projection() },
      worker, owner: crypto.randomUUID(), control: new AbortController() };
    let detach = () => {};
    const enrollment = Object.freeze({ revoke: () => {
      if (!this.#enrollments.delete(enrollment)) return;
      record.selection.lifetime.removeEventListener("abort", enrollment.revoke);
      detach();
      record.control.abort();
    } });
    this.#enrollments.set(enrollment, record);
    record.selection.lifetime.addEventListener("abort", enrollment.revoke, { once: true });
    detach = this.authority.attachPeer(identity, enrollment.revoke);
    if (!record.control.signal.aborted) return enrollment;
  }

  #worker(identity: BrowserAccess, workerId: string, grantId: string): WorkerScope | undefined {
    if (!this.authority.revalidate(identity)) return;
    try {
      const view = this.supervisor.view(identity, workerId);
      if (view.state !== "open") return;
      const grant = this.grants.authorize(view.cwd, view.cwd, grantId);
      if (grant.status !== "authorized" || !grant.grantIdentity) return;
      const { nativeSessionId, sourceId, instanceId } = view.registration;
      return { target: { nativeSessionId, sourceId, instanceId }, generation: view.generation, cwd: view.cwd,
        grantIdentity: grant.grantIdentity };
    } catch { return; }
  }

  #projection(record: Enrollment): SessionProjectionBinding | undefined {
    try {
      const projection = record.selection.projection();
      if (projection) return parseProjectionBinding(projection);
    } catch { return; }
  }

  bind(identity: BrowserAccess, enrollment: ChatViewEnrollment, peer: PeerScope, request: AbortSignal) {
    const record = this.#enrollments.get(enrollment);
    if (!record || record.identity.credentialId !== identity.credentialId || !this.authority.revalidate(identity)) return;
    const signal = AbortSignal.any([request, record.control.signal, peer.signal]);
    const projection = this.#projection(record);
    const current = () => {
      if (signal.aborted) return false;
      const worker = this.#worker(identity, record.selection.workerId, record.selection.grantId);
      if (!worker || worker.generation !== record.worker.generation || !sameSubmissionTarget(worker.target, record.worker.target)
        || worker.cwd !== record.worker.cwd || worker.grantIdentity !== record.worker.grantIdentity) {
        enrollment.revoke();
        return false;
      }
      return !!projection && sameProjection(projection, this.#projection(record)) && !signal.aborted;
    };
    if (!projection || !current()) return;
    const run = async (invoke: () => Promise<unknown>) => {
      const capability = Object.freeze({});
      this.#invocations.set(capability, { peer, enrollment: record, projection, current });
      try { return await chatViewCaller.run(capability, invoke); }
      finally { this.#invocations.delete(capability); }
    };
    return { current, signal, run };
  }

  /** Bind this to the worker's ChatWorkerPort, using its exact supervised generation. */
  authorize(caller: ChatCaller, sessionId: string, worker: Pick<ChatWorkerPort, "generation" | "target">) {
    const invocation = this.#invocations.get(caller.view);
    const record = invocation?.enrollment;
    if (!invocation || !record || invocation.peer !== caller.peer || sessionId !== record.worker.target.nativeSessionId
      || worker.generation !== record.worker.generation || !sameSubmissionTarget(worker.target, record.worker.target)
      || !invocation.current()) return;
    return { owner: record.owner, lifetime: record.control.signal, projection: invocation.projection };
  }

  close(): void {
    this.#closed = true;
    for (const enrollment of this.#enrollments.keys()) enrollment.revoke();
  }
}
