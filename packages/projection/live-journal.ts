import { isDeepStrictEqual } from 'node:util';
import { SessionId, SessionSeq } from '@deepseek-ai/dsh-session/types';
import { LlmAttemptId } from '@deepseek-ai/dsh-llm/brand';
import type { JsonValue } from '@deepseek-ai/dsh-util-values';
import type {
  SessionFollowFrame, SessionHistoryRecord, SessionPage,
  SessionAssistantStreamBaseline, SessionAssistantStreamFrame,
} from '@deepseek-ai/dsh-api-session-controller/types';
import type { HistoryClient } from '../contracts/generated/history-client.ts';
import type { HistoryOpen, HistoryItem, HistoryChange, HistoryPoll, HistoryLiveIdentity } from '../contracts/generated/omp-wire.ts';
import { HistoryRecordParts } from './history-record-parts.ts';
import { historyEvent, historyMessage, MAX_EVENTS, MAX_ITEM_BYTES, PAGE_BYTES, PAGE_OVERHEAD,
  pageCoordinates, settledCoordinates, type PageRequest } from './history-records.ts';

type AssistantFrameInput = {
  [K in SessionAssistantStreamFrame['type']]: Omit<Extract<SessionAssistantStreamFrame, {type: K}>, 'revision'>
}[SessionAssistantStreamFrame['type']];
const MAX_BYTES = 32 * 1024 * 1024, ATTEMPT_BYTES = 8 * 1024 * 1024;
const OPEN_BYTES = 256 * 1024 * 1024, ASSOCIATIONS = 4096;
const identity = (live: HistoryLiveIdentity): string => JSON.stringify([
  live.workerId, live.sourceId, live.sessionId, live.contextId, live.branchLeafId, live.messageId,
]);
interface Attempt {
  id: LlmAttemptId; live: HistoryLiveIdentity; index: number; turn: number; step: number;
  startedAfterSeq: number; stream: JsonValue[]; bytes: number;
}
interface OpeningBudget { bytes: number; items: number }

/** Read one immutable cut, retaining only the current Native page and any unfinished record. */
async function* readItems(history: HistoryClient, opened: HistoryOpen, scope: 'active' | 'live', budget: OpeningBudget) {
  let pending: HistoryRecordParts | undefined;
  const start = budget.items;
  let next: string | undefined = opened.cursors[scope];
  while (next !== undefined) {
    const page = await history.page(next);
    if (page.snapshot !== opened.snapshot || page.scope !== scope || page.expiresAt !== opened.expiresAt
      || !isDeepStrictEqual(page.cut, opened.cut)) {
      throw Error('live_open_cut_changed');
    }
    if (page.nextCursor !== undefined && (!page.nextCursor || page.nextCursor === next || page.items.length === 0)) {
      throw Error('live_open_cursor');
    }
    for (const item of page.items) {
      budget.bytes += Buffer.byteLength(JSON.stringify(item)); budget.items++;
      if (budget.bytes > OPEN_BYTES || budget.items > MAX_EVENTS) throw Error('live_open_budget');
      if (scope === 'active' && budget.items - start > opened.count) throw Error('live_open_count');
      if (!pending) {
        const count = item.partCount ?? 1;
        if (count < 1 || count > MAX_EVENTS) throw Error('live_open_parts');
        pending = new HistoryRecordParts({...item, text: ''}, count, scope === 'active' || item.livePhase === 'streaming');
      }
      const record = pending.append(item, item.partIndex ?? 0);
      if (record) { pending = undefined; yield record; }
    }
    next = page.nextCursor;
  }
  if (pending) throw Error('live_open_parts');
  if (scope === 'active' && budget.items - start !== opened.count) throw Error('live_open_count');
}

/** Disposable bounded DSH generation. Native observations remain authoritative and not-attested. */
export class LiveJournal {
  readonly generation = crypto.randomUUID();
  readonly sessionId;
  readonly #records: SessionHistoryRecord[] = [];
  readonly #recordByteEnds: number[] = [];
  readonly #entries = new Set<string>();
  readonly #groups: number[] = [];
  readonly #settled = new Set<string>();
  readonly #pendingFinals = new Set<string>();
  readonly #appended = new Map<string, {item: HistoryItem; bytes: number}>();
  readonly #listeners = new Set<(frame: SessionFollowFrame) => void>();
  #appendBytes = 0; #after: number; #turn = 0; #step = 0; #assistantRevision = 0;
  #attempt: Attempt | undefined; #failure: string | undefined; #nativeLeaf: string | null;
  private constructor(readonly opened: HistoryOpen) {
    this.sessionId = SessionId(opened.cut.sessionId); this.#after = opened.cut.observationSeq;
    this.#nativeLeaf = opened.cut.leafId;
  }
  static async open(history: HistoryClient): Promise<LiveJournal> {
    const opened = await history.open('active', 'live'), journal = new LiveJournal(opened);
    try {
      if (opened.compacting) throw Error('live_open_compacting');
      if (opened.scope !== 'active' || opened.handoff !== 'live' || !opened.cursor || !opened.cursors.live
        || opened.cursor !== opened.cursors.active) throw Error('live_open_cut_changed');
      if (opened.count > MAX_EVENTS) throw Error('live_open_budget');
      if (opened.count < 0) throw Error('live_open_count');
      const budget = {bytes: 0, items: 0};
      await journal.#loadOpening(history, budget);
      if (opened.prefix && !journal.#attempt) throw Error('live_prefix_identity_unavailable');
      await journal.#catchUp(history);
      return journal;
    } catch (error) {
      journal.invalidate(error instanceof Error ? error.message : 'live_open_failed'); throw error;
    } finally { await history.close(opened.snapshot); }
  }
  async #loadOpening(history: HistoryClient, budget: OpeningBudget): Promise<void> {
    let leaf: string | null = null;
    for await (const item of readItems(history, this.opened, 'active', budget)) {
      const id = item.entryId ?? item.id;
      if (!id || !item.active || item.parentId !== leaf || this.#entries.has(id)) throw Error('live_open_active_path');
      this.#commit(item); leaf = id;
      if (this.#settled.size > ASSOCIATIONS) throw Error('live_settlement_evicted');
    }
    if (leaf !== this.opened.cut.leafId) throw Error('live_open_active_path');
    const {cut: {workerId, sourceId, sessionId, contextId}, prefix} = this.opened;
    const seen = new Set<string>();
    for await (const item of readItems(history, this.opened, 'live', budget)) {
      const id = item.entryId ?? item.id;
      if (!id || seen.has(id)) throw Error('live_open_parts');
      seen.add(id);
      const live = item.live;
      if (!live || live.workerId !== workerId || live.sourceId !== sourceId || live.sessionId !== sessionId
        || live.contextId !== contextId) throw Error('live_open_identity');
      if (!item.livePhase) throw Error('live_open_phase');
      if (item.livePhase === 'streaming' && (prefix?.id !== id || prefix.kind !== 'running_prefix'
        || prefix.kind !== item.kind || prefix.parentId !== item.parentId || prefix.active !== item.active)) {
        throw Error('live_prefix_identity_unavailable');
      }
      const key = identity(live);
      if (this.#settled.has(key)) continue;
      if (item.livePhase === 'streaming') {
        if (item.role !== 'assistant' || this.#attempt) throw Error('live_overlapping_assistant');
        this.#beginAttempt(live); this.#chunk(item.text, false);
      } else {
        this.#pendingFinals.add(key);
        if (this.#pendingFinals.size > ASSOCIATIONS) throw Error('live_open_pending_budget');
      }
    }
    // Every earlier runtime message must settle before a newer active Step can be published.
    if (this.#attempt && this.#pendingFinals.size > 0) throw Error('live_open_pending_order');
  }
  async #catchUp(history: HistoryClient): Promise<void> {
    let target: number | undefined;
    for (let reads = 0; reads <= ASSOCIATIONS; reads++) {
      const poll = await history.poll(this.opened.cut.workerId, this.#after);
      target ??= poll.cut.observationSeq;
      const before = this.#after; this.accept(poll);
      if (this.#after >= target) return;
      if (this.#after === before) throw Error('live_open_gap');
    }
    throw Error('live_open_buffer_overflow');
  }
  get cursor(): number { return this.#records.length - 1; }
  get after(): number { return this.#after; }
  get failure(): string | undefined { return this.#failure; }
  invalidate(code: string): void { this.#failure ??= code; this.#listeners.clear(); }
  #fail(code: string): never { this.invalidate(code); throw Error(code); }
  #assert(): void { if (this.#failure) throw Error(this.#failure); }
  page(request: PageRequest): SessionPage {
    return this.#page(request, PAGE_BYTES);
  }
  #page(request: PageRequest, limit: number): SessionPage {
    this.#assert();
    const { end, maximum } = pageCoordinates(request, this.cursor);
    let start = end, bytes = PAGE_OVERHEAD, count = 0;
    for (let index = this.#groupBefore(end); index >= 0 && count < maximum; index--) {
      const candidate = this.#groups[index]!;
      // Include one array separator per record as well as the encoded events.
      const size = this.#recordBytesBefore(start) - this.#recordBytesBefore(candidate) + start - candidate;
      if (bytes + size > limit) { if (!count) throw Error('live_page_group_bytes'); break; }
      bytes += size; start = candidate; count++;
    }
    return structuredClone({records: this.#records.slice(start, end), hasMore: start > 0});
  }
  #groupBefore(end: number): number {
    let low = 0, high = this.#groups.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (this.#groups[middle]! < end) low = middle + 1;
      else high = middle;
    }
    return low - 1;
  }
  #recordBytesBefore(offset: number): number { return this.#recordByteEnds[offset - 1] ?? 0; }
  snapshot(): Extract<SessionFollowFrame, {type: 'snapshot'}> {
    this.#assert();
    const assistantStream: SessionAssistantStreamBaseline = {revision: this.#assistantRevision,
      ...(this.#attempt ? {activeAttempt: {
        attemptId: this.#attempt.id, startedAfterSeq: this.#cursor(this.#attempt.startedAfterSeq),
        turn: this.#attempt.turn, step: this.#attempt.step, nextIndex: this.#attempt.index,
        stream: structuredClone(this.#attempt.stream),
      }} : {}),
    };
    const reserve = Buffer.byteLength(JSON.stringify(assistantStream)) + 8192;
    if (reserve >= PAGE_BYTES) throw Error('live_prefix_bytes');
    const page = this.#page({throughSeq: this.cursor, maxMessages: 32}, PAGE_BYTES - reserve);
    return {type: 'snapshot', header: {version: 4, id: this.sessionId, createdAt: 0, isSeeded: false},
      cursor: this.cursor, ...page, projections: {asOfSeq: this.cursor, values: {}}, assistantStream};
  }
  subscribe(listener: (frame: SessionFollowFrame) => void): () => void {
    this.#assert(); this.#listeners.add(listener); return () => { this.#listeners.delete(listener); };
  }
  #publish(frame: SessionFollowFrame): void { for (const listener of this.#listeners) listener(structuredClone(frame)); }
  #event(type: string, data: JsonValue, surface = false): SessionHistoryRecord {
    const entry = historyEvent(this.#records.length, type, data, surface);
    const bytes = Buffer.byteLength(JSON.stringify(entry));
    if (bytes > MAX_ITEM_BYTES) this.#fail('live_event_bytes');
    const end = this.#recordBytesBefore(this.#records.length) + bytes;
    if (this.#records.length >= MAX_EVENTS || end > MAX_BYTES) this.#fail('live_projection_evicted');
    this.#records.push(entry); this.#recordByteEnds.push(end); this.#publish(entry); return entry;
  }
  #commit(item: HistoryItem): SessionHistoryRecord | undefined {
    const id = item.entryId ?? item.id;
    if (this.#entries.has(id)) return;
    this.#entries.add(id); if (item.live) this.#settled.add(identity(item.live));
    if (item.role === 'assistant' && (!item.provider || !item.model)) this.#fail('live_missing_model_source');
    const attempt = item.role === 'assistant' && item.live && this.#attempt
      && identity(item.live) === identity(this.#attempt.live) ? this.#attempt : undefined;
    const coordinates = settledCoordinates(item.role, { turn: this.#turn, step: this.#step });
    if (!attempt) {
      if (coordinates.length > 1 || !this.#attempt) this.#groups.push(this.#records.length);
      this.#turn = coordinates.turn; this.#step = coordinates.step;
    }
    return historyMessage(item, id, attempt ?? coordinates,
      (type, data, surface) => this.#event(type, data, surface), !!attempt);
  }
  #cursor(value: number) { return value === -1 ? -1 : SessionSeq(value); }
  #beginAttempt(live: HistoryLiveIdentity): void {
    if (this.#attempt) this.#fail('live_overlapping_assistant');
    if (live.branchLeafId !== null && !this.#entries.has(live.branchLeafId)) this.#fail('live_prefix_off_branch');
    this.#groups.push(this.#records.length);
    const turn = this.#turn, step = ++this.#step; this.#event('step/start', {turn, step});
    this.#attempt = {id: LlmAttemptId(identity(live)), live, index: 0, turn, step,
      startedAfterSeq: this.cursor, stream: [], bytes: 0};
  }
  #frame(frame: AssistantFrameInput): void {
    this.#publish({type: 'assistant-stream', frame: {...frame, revision: ++this.#assistantRevision} as SessionAssistantStreamFrame});
  }
  #chunk(text: string, publish = true): void {
    const attempt = this.#attempt; if (!attempt) this.#fail('live_missing_attempt');
    const chunk = {type: 'block-end' as const, index: 0, block: {type: 'text' as const, text}};
    const record = {type: 'chunk', time: 0, chunk};
    const bytes = Buffer.byteLength(JSON.stringify(record));
    if (bytes > MAX_ITEM_BYTES || attempt.index >= ASSOCIATIONS || attempt.bytes + bytes > ATTEMPT_BYTES) this.#fail('live_attempt_evicted');
    const index = attempt.index++; attempt.bytes += bytes; attempt.stream.push(record);
    if (publish) this.#frame({type: 'chunk', attemptId: attempt.id, index, time: 0, chunk});
  }
  accept(poll: HistoryPoll): void {
    this.#assert();
    if (poll.cut.workerId !== this.opened.cut.workerId || poll.cut.sessionId !== this.sessionId || poll.after !== this.#after) {
      this.#fail('live_observation_out_of_order');
    }
    if (poll.cut.sourceId !== this.opened.cut.sourceId || poll.cut.contextId !== this.opened.cut.contextId) this.#fail('live_context_changed');
    for (const event of poll.events) {
      if (event.seq !== this.#after + 1) this.#fail('live_observation_gap');
      this.#apply(event); this.#after = event.seq;
    }
    if (!poll.hasMore && [...this.#appended.values()].some(value => value.item.active)) this.#fail('live_unassociated_source_append');
    if (this.#settled.size > ASSOCIATIONS) this.#fail('live_settlement_evicted');
    if (poll.through !== this.#after || (!poll.hasMore && poll.cut.leafId !== this.#nativeLeaf)) this.#fail('live_observation_gap');
  }
  #sourceAppend(event: HistoryChange): void {
    const source = event.source, item = event.item;
    if (!source?.entryId || !item) this.#fail('live_source_payload_missing');
    if (source.leafId !== this.#nativeLeaf && (source.leafId !== source.entryId || item.parentId !== this.#nativeLeaf)) {
      this.#fail('live_branch_changed');
    }
    this.#nativeLeaf = source.leafId;
    if (this.#entries.has(source.entryId)) this.#fail('live_duplicate_native_append');
    if (item.kind !== 'message' && !(item.kind === 'custom_message' && item.role === 'custom')) {
      if (item.active) this.#commit(item); return;
    }
    // A native-only append without a live lifecycle is already an authoritative source record.
    if (!item.live) { if (item.active) this.#commit(item); return; }
    const bytes = Buffer.byteLength(JSON.stringify(item));
    if (this.#appended.size >= ASSOCIATIONS || this.#appendBytes + bytes > ATTEMPT_BYTES) this.#fail('live_association_evicted');
    this.#appended.set(source.entryId, {item, bytes}); this.#appendBytes += bytes;
  }
  #apply(event: HistoryChange): void {
    if (['native_setLeaf', 'native_clear', 'native_rebuild', 'native_rewrite', 'native_source_replaced', 'native_source_binding',
      'native_untracked_rewrite', 'native_runtime_replaced', 'native_live_gap', 'native_settlement_evicted', 'auto_compaction_start'].includes(event.kind)) {
      this.#fail('live_projection_invalidated');
    }
    if (event.kind === 'native_append') this.#sourceAppend(event);
    if (!event.live || !event.item) return;
    const key = identity(event.live); if (this.#settled.has(key)) return;
    if (event.item.role === 'toolResult' && !event.live.toolOwnerMessageId) this.#fail('live_tool_owner_unavailable');
    if (event.live.contextId !== this.opened.cut.contextId) this.#fail('live_context_changed');
    if (event.kind === 'message_start' && event.item.role === 'assistant') {
      this.#beginAttempt(event.live); const attempt = this.#attempt!;
      this.#frame({type: 'start', attemptId: attempt.id, startedAfterSeq: this.#cursor(this.cursor), turn: attempt.turn, step: attempt.step});
    } else if (event.kind === 'message_update' && event.item.role === 'assistant') {
      if (!this.#attempt || identity(this.#attempt.live) !== key) this.#fail('live_late_attempt');
      this.#chunk(event.item.text);
    } else if (event.kind === 'message_settlement') this.#settle(event, key);
  }
  #settle(event: HistoryChange, key: string): void {
    const settlement = event.settlement, item = event.item, live = event.live;
    if (!settlement || !item || !live) this.#fail('live_missing_settlement');
    if (settlement.status === 'failed') this.#fail('live_native_decision_failed');
    const attempt = this.#attempt && identity(this.#attempt.live) === key ? this.#attempt : undefined;
    if (item.role === 'assistant' && !attempt && !this.#pendingFinals.has(key)) this.#fail('live_late_attempt');
    const source = settlement.entryId ? this.#appended.get(settlement.entryId) : undefined;
    if (source) { this.#appendBytes -= source.bytes; this.#appended.delete(settlement.entryId!); }
    let entry: SessionHistoryRecord | undefined;
    if (settlement.status === 'observed') {
      if (!settlement.entryId || (!source && !this.#entries.has(settlement.entryId))) this.#fail('live_unknown_settlement_entry');
      if (source?.item.active) entry = this.#commit({...item, id: settlement.entryId, entryId: settlement.entryId});
    }
    this.#settled.add(key); this.#pendingFinals.delete(key);
    if (attempt) {
      this.#frame({type: 'end', attemptId: attempt.id, index: attempt.index, outcome: entry
        ? {kind: 'committed', eventType: 'assistant/message', seq: entry.event.seq} : {kind: 'abandoned'}});
      this.#event('step/end', {turn: attempt.turn, step: attempt.step}); this.#attempt = undefined;
    }
  }
}
