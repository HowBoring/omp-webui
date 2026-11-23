import { Remote, TypertRemoteService, RemoteError } from "@deepseek-ai/dsh-typert-protocol";
import type { Context } from "@deepseek-ai/cordis";
import type { SessionFollowRequest, SessionPageRequest, SessionControlFrame, SessionFollowFrame,
  SessionListRequest, SessionProjectionsRequest, SessionProjectionBinding, SessionCreateRequest,
  SessionCreateValue, ModelCatalog, SessionSelectModelRequest, SessionSelectModelValue } from "@deepseek-ai/dsh-api-session-controller/types";
import { sameProjection } from "@deepseek-ai/dsh-api-session-controller/projection";
import { SessionId } from "@deepseek-ai/dsh-session/types";
import type { BrowserAccess } from "../access/index.ts";
import type { LiveJournal } from "../projection/live-journal.ts";
import type { SessionSupervisor } from "./supervisor.ts";
import { sessionCaller, type SessionsService } from "./service.ts";
export class SessionPresentationService extends TypertRemoteService {
  constructor(ctx: Context, readonly supervisor: SessionSupervisor,
    private readonly sessions: SessionsService, private readonly changed?: () => void) {
    super(ctx, "sessionController", { namespace: "session" });
  }
  private identity(): BrowserAccess { const identity = sessionCaller.getStore(); if (!identity) throw new Error("SESSION_AUTH_REQUIRED"); return identity; }
  private addressId(address: SessionFollowRequest["address"]): string {
    if (address.kind !== "session") throw new Error("SESSION_ADDRESS_DENIED"); return address.sessionId;
  }
  /** Refuse to answer an opening pinned to a generation the Host has already retired. */
  private assertOpening(journal: LiveJournal, projection: SessionProjectionBinding | undefined): void {
    if (projection !== undefined && !sameProjection(projection, journal.projection)) {
      throw new RemoteError("session/projections-unavailable",
        "The requested Session projection generation was replaced; reopen after the control invalidation.", {});
    }
  }
  @Remote("list") async list(_request: SessionListRequest) {
    const identity = this.identity();
    const current = await this.supervisor.listed(identity);
    const items = (await this.sessions.nativeCatalog()).map(item => ({
      sessionId: SessionId(item.nativeSessionId),
      updatedAt: Number.isFinite(Date.parse(item.modifiedAt)) ? Date.parse(item.modifiedAt) : Date.parse(item.observedAt),
      agentAvailable: false, running: false, blank: false, formatStatus: "current" as const,
      ...(item.cwd.canonical ? { cwd: item.cwd.canonical } : {}),
      projections: { kind: "cached" as const, asOfSeq: -1, values: {} },
    }));
    if (current !== undefined) {
      const sessionId = SessionId(current.view.registration.nativeSessionId);
      const updatedAt = Date.parse(current.view.registration.observedAt);
      const existing = items.find(item => item.sessionId === sessionId);
      if (existing === undefined) items.unshift({ sessionId, updatedAt, agentAvailable: true, running: current.running,
        blank: current.blank, formatStatus: "current",
        projections: { kind: "cached" as const, asOfSeq: -1, values: {} },
        ...(current.view.registration.cwd ? { cwd: current.view.registration.cwd } : {}) });
      else Object.assign(existing, { agentAvailable: true, running: current.running, blank: current.blank,
        updatedAt: Number.isFinite(updatedAt) ? Math.max(existing.updatedAt, updatedAt) : existing.updatedAt });
    }
    items.sort((left, right) => right.updatedAt - left.updatedAt);
    return { items };
  }
  /** Present a stock-addressed native Session, switching the one live worker when needed. */
  private async presented(sessionId: string): Promise<LiveJournal> {
    const identity = this.identity();
    try { return await this.supervisor.presentation(identity, sessionId); }
    catch (error) {
      if (!(error instanceof Error) || error.message !== "SESSION_MANUAL_OPEN_REQUIRED") throw error;
      await this.sessions.nativeOpen(sessionId);
      return this.supervisor.presentation(identity, sessionId);
    }
  }
  @Remote("create") async create(request: SessionCreateRequest): Promise<SessionCreateValue> {
    const view = await this.sessions.stockCreate({ ...(request.workspaceId === undefined ? {} : { workspaceId: request.workspaceId }),
      ...(request.cwd === undefined ? {} : { cwd: request.cwd }), ...(request.sessionId === undefined ? {} : { sessionId: request.sessionId }) });
    this.changed?.();
    return { sessionId: SessionId(view.sessionId) };
  }
  @Remote("modelCatalog") modelCatalog(): Promise<ModelCatalog> {
    return this.sessions.stockModelCatalog() as Promise<ModelCatalog>;
  }
  @Remote("selectModel") async selectModel(request: SessionSelectModelRequest): Promise<SessionSelectModelValue> {
    return await this.sessions.stockSelectModel({ sessionId: request.sessionId, provider: request.provider,
      model: request.model, ...(request.reasoningEffort === undefined ? {} : { reasoningEffort: request.reasoningEffort }) }) as SessionSelectModelValue;
  }
  @Remote("projections") async projections(request: SessionProjectionsRequest) {
    const journal = await this.supervisor.presentation(this.identity(), request.sessionId);
    return { kind: "sequenced" as const, projection: journal.projection, asOfSeq: journal.cursor,
      values: { conversationContinuation: journal.continuation } };
  }
  @Remote("page") async page(request: SessionPageRequest) {
    const journal = await this.presented(this.addressId(request.address));
    this.assertOpening(journal, request.projection);
    return { cursor: request.throughSeq ?? journal.cursor, ...await journal.page(request) };
  }
  @Remote({ mode: "stream" }) async *control(signal: AbortSignal): AsyncGenerator<SessionControlFrame> {
    const identity = this.identity();
    // Captured before the renewal so a cut recovery performed here still reaches the viewer as one
    // invalidation; the baseline itself must name a generation the next follow can actually open.
    let epoch = this.supervisor.presentationEpoch(identity);
    const presented = this.supervisor.activeJournal(identity);
    let live: LiveJournal | undefined;
    if (presented !== undefined) {
      try { live = await this.supervisor.presentation(identity, presented.sessionId); } catch { live = undefined; }
    }
    let continuation = live?.continuation ?? null;
    yield { type: "baseline", value: { projections: live ? { [live.sessionId]: {
      projection: live.projection, asOfSeq: live.cursor, values: { conversationContinuation: live.continuation },
    } } : {} } };
    while (!signal.aborted) {
      await Bun.sleep(100);
      let current = this.supervisor.activeJournal(identity);
      // A live journal can fail on a native cut change before its viewer reopens. Rebuild it from the
      // authoritative history here: the epoch advances only with the replacement, so the invalidation
      // below always names a generation the viewer's next follow can open. A still-busy cut retries on
      // the next tick instead of stranding the page on the retired snapshot.
      if (current?.failure) {
        try { await this.supervisor.presentation(identity, current.sessionId); } catch { /* retry next tick */ }
        current = this.supervisor.activeJournal(identity);
      }
      const next = this.supervisor.presentationEpoch(identity);
      if (next !== epoch && current) {
        epoch = next;
        yield { type: "projection-invalidated", sessionId: SessionId(current.sessionId), projection: current.projection };
        continue;
      }
      // The stock Continue button reads this view through the control stream; a failure that settles
      // while the page is open must publish the new value, not wait for a reload.
      const value = current?.continuation ?? null;
      if (!current || value === continuation) continue;
      continuation = value;
      yield { type: "projection", sessionId: SessionId(current.sessionId), projection: current.projection,
        seq: current.cursor, changes: [{ key: "conversationContinuation", val: value }] };
    }
  }
  @Remote({ mode: "stream" }) async *follow(request: SessionFollowRequest, signal: AbortSignal): AsyncGenerator<SessionFollowFrame> {
    const identity = this.identity(), id = this.addressId(request.address);
    const journal = await this.presented(id);
    this.assertOpening(journal, request.projection);
    const queue: SessionFollowFrame[] = []; let bytes = 0;
    const dispose = journal.subscribe(frame => {
      const size = Buffer.byteLength(JSON.stringify(frame));
      if (queue.length >= 256 || bytes + size > 1_048_576) journal.invalidate("live_follow_buffer_overflow");
      else { queue.push(frame); bytes += size; }
    });
    try {
      yield journal.snapshot();
      while (!signal.aborted) {
        this.supervisor.requirePresentation(identity, id, journal);
        if (journal.failure) throw new RemoteError("gateway/bad-request", "Session history changed; manually reopen the full view.", {});
        while (queue.length) { this.supervisor.requirePresentation(identity, id, journal); const frame = queue.shift()!;
          bytes -= Buffer.byteLength(JSON.stringify(frame)); yield frame; }
        await this.supervisor.pollPresentation(identity, id, journal); await Bun.sleep(100);
      }
    } finally { dispose(); }
  }
}
