import { Remote, TypertRemoteService, RemoteError } from "@deepseek-ai/dsh-typert-protocol";
import type { Context } from "@deepseek-ai/cordis";
import type { SessionFollowRequest, SessionPageRequest, SessionControlFrame, SessionFollowFrame,
  SessionListRequest, SessionProjectionsRequest, SessionProjectionBinding, SessionCreateRequest,
  SessionCreateValue, ModelCatalog, SessionProjectionValues, SessionSelectModelRequest,
  SessionSelectModelValue, SessionAttachmentRequest, SessionAttachmentValue,
  SessionHistoryRecord } from "@deepseek-ai/dsh-api-session-controller/types";
import { sameProjection } from "@deepseek-ai/dsh-api-session-controller/projection";
import { ReasoningEffortId } from "@deepseek-ai/dsh-llm/brand";
import { SessionId } from "@deepseek-ai/dsh-session/types";
import type { BrowserAccess } from "../access/index.ts";
import type { LiveJournal } from "../projection/live-journal.ts";
import { applyHistoryImages, type SessionImages } from "../projection/history-images.ts";
import type { SessionSupervisor } from "./supervisor.ts";
import { sessionCaller, type SessionsService } from "./service.ts";
/** Wire shape of a model-selection face value; an alias (not interface) so JSON carriers accept it too. */
type SelectionJson = { provider: string; model: string; reasoningEffort?: ReasoningEffortId };
export class SessionPresentationService extends TypertRemoteService {
  constructor(ctx: Context, readonly supervisor: SessionSupervisor,
    private readonly sessions: SessionsService, private readonly changed?: () => void,
    private readonly images?: () => SessionImages | undefined) {
    super(ctx, "sessionController", { namespace: "session" });
  }
  private identity(): BrowserAccess { const identity = sessionCaller.getStore(); if (!identity) throw new Error("SESSION_AUTH_REQUIRED"); return identity; }
  /** Replace a retained-image placeholder with the stock image block the conversation surface renders. */
  private decorate(identity: BrowserAccess, sessionId: string, records: readonly SessionHistoryRecord[]):
    readonly SessionHistoryRecord[] {
    const images = this.images?.();
    if (images === undefined) return records;
    const ids = [...new Set(records.flatMap(record => {
      if (record.type !== "event" || record.event.type !== "user/message") return [];
      const id = (record.event.data as { id?: unknown }).id;
      return typeof id === "string" ? [id] : [];
    }))];
    if (ids.length === 0) return records;
    try {
      return applyHistoryImages(records, [...images.retained(identity, sessionId, ids).values()].flat());
    } catch { return records; }
  }
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
      values: { conversationContinuation: journal.continuation,
        modelSelection: await this.modelSelection() } };
  }
  /** The stock model picker reads this face; synthesize it from the one native worker selection. */
  private async modelSelection(): Promise<{ lastUsed: SelectionJson | null; next: SelectionJson | null }> {
    try {
      const catalog = await this.sessions.stockModelCatalog() as ModelCatalog;
      const selected = catalog.default;
      const next: SelectionJson = { provider: selected.provider, model: selected.model,
        ...(selected.reasoningEffort === undefined ? {} : { reasoningEffort: ReasoningEffortId(selected.reasoningEffort) }) };
      return { lastUsed: next, next };
    } catch { return { lastUsed: null, next: null }; }
  }
  @Remote("page") async page(request: SessionPageRequest) {
    // Reads never open a worker: after a Host or worker restart the supervisor refuses with the typed
    // manual-open condition, the client surfaces that marker, and an explicit public Open answers it.
    // Opening here would resurrect an interrupted worker without its owner's consent.
    const id = this.addressId(request.address), journal = await this.supervisor.presentation(this.identity(), id);
    this.assertOpening(journal, request.projection);
    const page = await journal.page(request);
    return { cursor: request.throughSeq ?? journal.cursor, ...page,
      records: this.decorate(this.identity(), id, page.records) };
  }
  /** Stock durable image read: the Projection only publishes references backed by an associated Original. */
  @Remote("attachment") async attachment(request: SessionAttachmentRequest): Promise<SessionAttachmentValue> {
    const identity = this.identity(), images = this.images?.(), reference = request.attachment;
    if (images === undefined) throw new RemoteError("session/attachment-invalid", "Session images are unavailable.", { reason: "images-unavailable" });
    if (typeof reference.attachmentId !== "string" || !Number.isSafeInteger(reference.bytes)
      || reference.bytes < 1 || !Number.isSafeInteger(reference.width) || reference.width < 1
      || !Number.isSafeInteger(reference.height) || reference.height < 1) {
      throw new RemoteError("gateway/bad-request", "The image reference is invalid.",
        { issues: [] });
    }
    const found = await images.read(identity, request.sessionId, reference);
    if (found.mediaType !== reference.mediaType || found.data.byteLength !== reference.bytes) {
      throw new RemoteError("session/attachment-invalid", "The retained image no longer matches its reference.",
        { reason: "reference-mismatch" });
    }
    return { attachment: reference, data: Buffer.from(found.data).toString("base64") };
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
    const selection = live === undefined ? null : await this.modelSelection();
    yield { type: "baseline", value: { projections: live ? { [live.sessionId]: {
      projection: live.projection, asOfSeq: live.cursor, values: { conversationContinuation: live.continuation,
        ...(selection === null ? {} : { modelSelection: selection }) },
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
    const journal = await this.supervisor.presentation(identity, id);
    this.assertOpening(journal, request.projection);
    const queue: SessionFollowFrame[] = []; let bytes = 0;
    const dispose = journal.subscribe(frame => {
      const size = Buffer.byteLength(JSON.stringify(frame));
      if (queue.length >= 256 || bytes + size > 1_048_576) journal.invalidate("live_follow_buffer_overflow");
      else { queue.push(frame); bytes += size; }
    });
    try {
      // A projection rebuild (a model or effort switch refreshes the journal) withdraws every face; the
      // reopened follow must carry the native selection again or the stock model seat falls back to a
      // catalog loaded before the switch.
      const snapshot = journal.snapshot();
      const values: SessionProjectionValues = { ...snapshot.projections.values };
      values.modelSelection = await this.modelSelection();
      yield { ...snapshot, records: this.decorate(identity, id, snapshot.records),
        projections: { ...snapshot.projections, values } };
      while (!signal.aborted) {
        this.supervisor.requirePresentation(identity, id, journal);
        if (journal.failure) throw new RemoteError("gateway/bad-request", "Session history changed; manually reopen the full view.", {});
        while (queue.length) { this.supervisor.requirePresentation(identity, id, journal); const frame = queue.shift()!;
          bytes -= Buffer.byteLength(JSON.stringify(frame));
          yield frame.type === "event" ? this.decorate(identity, id, [frame])[0]! : frame; }
        await this.supervisor.pollPresentation(identity, id, journal); await Bun.sleep(100);
      }
    } finally { dispose(); }
  }
}
