import { isDeepStrictEqual } from 'node:util';
import { SessionId, SessionSeq } from '@deepseek-ai/dsh-session/types';
import { LlmAttemptId } from '@deepseek-ai/dsh-llm/brand';
import type { JsonValue } from '@deepseek-ai/dsh-util-values';
import { parseProjectionBinding } from '@deepseek-ai/dsh-api-session-controller/projection';
import type {
  SessionFollowFrame, SessionHistoryRecord, SessionPage,
  SessionAssistantStreamBaseline, SessionAssistantStreamFrame,
} from '@deepseek-ai/dsh-api-session-controller/types';
import type { HistoryClient } from '../contracts/generated/history-client.ts';
import type { HistoryOpen, HistoryItem, HistoryChange, HistoryPoll, HistoryLiveIdentity } from '../contracts/generated/omp-wire.ts';
import { HistoryRecordParts } from './history-record-parts.ts';
import { historyEvent, historyMessage, MAX_EVENTS, MAX_ITEM_BYTES, PAGE_BYTES, PAGE_OVERHEAD,
  pageCoordinates, settledCoordinates, ToolCallLedger, type PageRequest } from './history-records.ts';

type AssistantFrameInput = {
  [K in SessionAssistantStreamFrame['type']]: Omit<Extract<SessionAssistantStreamFrame, {type: K}>, 'revision'>
}[SessionAssistantStreamFrame['type']];
/** Read per journal, not at module load: a harness cap must not depend on import order. */
function journalMaxBytes(): number {
  const configured = Number(process.env.OMP_LIVE_JOURNAL_MAX_BYTES);
  return Number.isSafeInteger(configured) && configured > 0 ? configured : 32 * 1024 * 1024;
}
const ATTEMPT_BYTES = 8 * 1024 * 1024;
const OPEN_BYTES = 256 * 1024 * 1024, ASSOCIATIONS = 4096;
/** The Native cut moves while a cold Session activates (bookkeeping is appended), so an opening
 * that observed a changed cut retries the same journal instead of failing the projection. */
const OPEN_RETRY_ATTEMPTS = 20, OPEN_RETRY_DELAY_MS = 150;
/** Quiet polls an opening must observe before the journal is published. */
const OPEN_QUIET_POLLS = 3, OPEN_QUIET_DELAY_MS = 60, OPEN_SETTLE_READS = 40;
const OPEN_RETRY_CODES: readonly string[] = [
  'history_handoff_changed', 'history_changed', 'history_stale_cursor', 'history_stale_observation',
  'history_stale_content_cursor', 'live_context_changed', 'live_open_cut_changed', 'live_open_unsettled',
];
function errorCode(error: unknown): string {
  const code = (error as {code?: unknown} | undefined)?.code;
  if (typeof code === 'string') return code;
  return error instanceof Error ? error.message : '';
}
function delay(ms: number): Promise<void> {
  const {promise, resolve} = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}
const identity = (live: HistoryLiveIdentity): string => JSON.stringify([
  live.workerId, live.sourceId, live.sessionId, live.contextId, live.branchLeafId, live.messageId,
]);
interface Attempt {
  id: LlmAttemptId; live: HistoryLiveIdentity; index: number; turn: number; step: number;
  startedAfterSeq: number; stream: JsonValue[]; bytes: number;
}
interface OpeningBudget { bytes: number; items: number }

/** Read one immutable live cut; only the current Native page and unfinished records are retained locally. */
async function* readLiveItems(history: HistoryClient, opened: HistoryOpen, budget: OpeningBudget) {
  let pending: HistoryRecordParts | undefined;
  let next: string | undefined = opened.cursors.live;
  while (next !== undefined) {
    const page = await history.page(next);
    if (page.snapshot !== opened.snapshot || page.scope !== 'live' || page.expiresAt !== opened.expiresAt
      || !isDeepStrictEqual(page.cut, opened.cut)) {
      throw Error('live_open_cut_changed');
    }
    if (page.nextCursor !== undefined && (!page.nextCursor || page.nextCursor === next || page.items.length === 0)) {
      throw Error('live_open_cursor');
    }
    for (const item of page.items) {
      budget.bytes += Buffer.byteLength(JSON.stringify(item)); budget.items++;
      if (budget.bytes > OPEN_BYTES || budget.items > MAX_EVENTS) throw Error('live_open_budget');
      if (!pending) {
        const count = item.partCount ?? 1;
        if (count < 1 || count > MAX_EVENTS) throw Error('live_open_parts');
        pending = new HistoryRecordParts({...item, text: ''}, count, item.livePhase === 'streaming');
      }
      const record = pending.append(item, item.partIndex ?? 0);
      if (record) { pending = undefined; yield record; }
    }
    next = page.nextCursor;
  }
  if (pending) throw Error('live_open_parts');
}

/** Disposable bounded DSH generation. Native observations remain authoritative and not-attested. */
export class LiveJournal {
  readonly generation: string = crypto.randomUUID();
  /** Opaque Host-journal identity: every reopened journal is a new generation so DSH rejects
   * stale pages and rebuilds its trajectory instead of following retired content. */
  get projection() { return parseProjectionBinding({source: 'omp-webui/live-journal/v1', generation: this.generation}); }
  readonly sessionId;
  readonly #records: SessionHistoryRecord[] = [];
  readonly #recordByteEnds: number[] = [];
  readonly #entries = new Set<string>();
  readonly #groups: number[] = [];
  readonly #settled = new Set<string>();
  readonly #pendingFinals = new Set<string>();
  readonly #appended = new Map<string, {item: HistoryItem; bytes: number}>();
  readonly #listeners = new Set<(frame: SessionFollowFrame) => void>();
  readonly #toolCalls = new ToolCallLedger();
  /** First resident seq and the native row offset/counters it starts at. */
  #firstSeq = 0; #firstNativeOffset = 0; #firstTurn = 0; #firstStep = 0;
  /** Native boundaries already served, keyed by the seq an older page must end at. */
  readonly #boundaries = new Map<number, { offset: number; turn: number; step: number; parent: string | null }>();
  #appendBytes = 0; #after: number; #turn = 0; #step = 0; #assistantRevision = 0;
  #attempt: Attempt | undefined; #failure: string | undefined; #nativeLeaf: string | null; #closed = false;
  /** Last published tip: the visible path this generation already served. Activation re-points the
   *  Native leaf here without changing that path, so a matching setLeaf is bookkeeping, not a branch move. */
  #publishedLeaf: string | null;
  /** In-flight lease renewal shared by concurrent stale pages. */
  #renewing: Promise<HistoryOpen> | undefined;
  readonly #maxBytes = journalMaxBytes();
  private constructor(public opened: HistoryOpen, readonly history: HistoryClient, generation?: string) {
    if (generation !== undefined) this.generation = generation;
    this.sessionId = SessionId(opened.cut.sessionId); this.#after = opened.cut.observationSeq;
    this.#nativeLeaf = opened.cut.leafId; this.#publishedLeaf = opened.cut.leafId;
  }
  static async open(history: HistoryClient, generation?: string): Promise<LiveJournal> {
    for (let attempt = 1; ; attempt++) {
      try { return await LiveJournal.#opened(history, generation); }
      catch (error) {
        const code = errorCode(error);
        if (attempt >= OPEN_RETRY_ATTEMPTS || !OPEN_RETRY_CODES.includes(code)) throw error;
        await delay(OPEN_RETRY_DELAY_MS);
      }
    }
  }
  static async #opened(history: HistoryClient, generation?: string): Promise<LiveJournal> {
    const opened = await history.open('active', 'live');
    const journal = new LiveJournal(opened, history, generation);
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
      await journal.#quiesce(history);
      return journal;
    } catch (error) {
      await history.close(journal.opened.snapshot).catch(() => {});
      journal.invalidate(error instanceof Error ? error.message : 'live_open_failed'); throw error;
    }
  }
  async #loadOpening(history: HistoryClient, budget: OpeningBudget): Promise<void> {
    await this.#loadActiveTail(history, budget);
    const {cut: {workerId, sourceId, sessionId, contextId}, prefix} = this.opened;
    const seen = new Set<string>();
    for await (const item of readLiveItems(history, this.opened, budget)) {
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
  /** Seed only the native tail that the live window needs; older records stay native until paged. */
  async #loadActiveTail(history: HistoryClient, budget: OpeningBudget): Promise<void> {
    const count = this.opened.count;
    if (count === 0) { this.#boundaries.set(0, {offset: 0, turn: 0, step: 0, parent: null}); return; }
    const seed = await this.#nativeOlder(history, count, null);
    if (seed.items.length === 0) throw Error('live_open_count');
    let users = 0, assistants = 0;
    for (const item of seed.items) { if (item.role === 'user') users++; if (item.role === 'assistant') assistants++; }
    const end = seed.offset === 0 ? {turn: users, step: assistants} : {turn: 1_000_000, step: 1_000_000};
    const start = {turn: end.turn - users, step: end.step - assistants};
    if (start.turn < 0 || start.step < 0) throw Error('live_open_count');
    this.#firstNativeOffset = seed.offset; this.#firstSeq = seed.offset === 0 ? 0 : 1_000_000;
    this.#firstTurn = start.turn; this.#firstStep = start.step; this.#turn = start.turn; this.#step = start.step;
    this.#remember(this.#firstSeq, {offset: seed.offset, turn: start.turn, step: start.step, parent: seed.items[0]?.parentId ?? null});
    let leaf: string | null = null;
    for (const item of seed.items) {
      const id = item.entryId ?? item.id;
      if (!id || !item.active || (this.#entries.has(id) && id !== leaf) || (leaf !== null && id !== leaf && item.parentId !== leaf)) throw Error('live_open_active_path');
      budget.bytes += Buffer.byteLength(JSON.stringify(item)); budget.items++;
      if (budget.bytes > OPEN_BYTES || budget.items > MAX_EVENTS) throw Error('live_open_budget');
      this.#commit(item); leaf = id;
      if (this.#settled.size > ASSOCIATIONS) throw Error('live_settlement_evicted');
    }
    if (leaf !== this.opened.cut.leafId) throw Error('live_open_active_path');
    if (this.#turn !== end.turn || this.#step !== end.step) throw Error('live_open_count');
  }
  #checkPage(page: {snapshot: string; scope: string; expiresAt: number; cut: unknown; offset?: number; items: HistoryItem[]}, before: number): number {
    if (page.snapshot !== this.opened.snapshot || page.scope !== 'active' || page.expiresAt !== this.opened.expiresAt
      || !isDeepStrictEqual(page.cut, this.opened.cut) || !Number.isSafeInteger(page.offset)
      || page.offset! < 0 || page.offset! + page.items.length !== before) throw Error('live_open_cut_changed');
    return page.offset!;
  }
  /** Native snapshots carry a bounded lease; re-acquire the same cut once its lease lapses instead of
   * failing older paging. A cut that moved cannot be paged at the retained seqs and fails loudly.
   * Renewal is single-flight: concurrent stale pages share one snapshot, and a renewal that lands after
   * dispose/failure closes exactly what it opened instead of publishing a dead snapshot. */
  #renew(history: HistoryClient): Promise<HistoryOpen> {
    return this.#renewing ??= (async () => {
      try {
        if (this.#failure) throw Error(this.#failure);
        if (this.#closed) throw Error('live_history_closed');
        const expired = this.opened;
        const renewed = await history.open('active', 'live');
        try {
          if (this.#failure) throw Error(this.#failure);
          if (this.#closed) throw Error('live_history_closed');
          if (renewed.scope !== 'active' || renewed.handoff !== 'live' || renewed.cursor !== renewed.cursors.active
            || renewed.compacting || renewed.count !== expired.count
            || renewed.cut.contentRevision !== expired.cut.contentRevision || renewed.cut.leafId !== expired.cut.leafId
            || renewed.cut.sessionId !== expired.cut.sessionId || renewed.cut.workerId !== expired.cut.workerId
            || renewed.cut.sourceId !== expired.cut.sourceId || renewed.cut.contextId !== expired.cut.contextId) {
            throw Error('live_open_cut_changed');
          }
        } catch (error) {
          await history.close(renewed.snapshot).catch(() => {});
          if (errorCode(error) === 'live_open_cut_changed') this.#fail('live_open_cut_changed');
          throw error;
        }
        this.opened = renewed;
        await history.close(expired.snapshot).catch(() => {});
        return renewed;
      } finally { this.#renewing = undefined; }
    })();
  }
  async #nativePage(history: HistoryClient, before: number) {
    try { return await history.page(this.opened.cursors.active, before); }
    catch (error) {
      if (errorCode(error) !== 'history_stale_cursor') throw error;
      const renewed = await this.#renew(history);
      return await history.page(renewed.cursors.active, before);
    }
  }
  /** Read one whole Native chunk ending before an absolute row offset, starting at a user boundary when possible. */
  async #nativeOlder(history: HistoryClient, before: number, parent: string | null): Promise<{items: HistoryItem[]; offset: number}> {
    let accumulated: HistoryItem[] = [], offset = before, bytes = 0;
    for (let pages = 0; pages < 32; pages++) {
      const page = await this.#nativePage(history, before);
      const start = this.#checkPage(page, before);
      if (page.items.length === 0) break;
      accumulated = page.items.concat(accumulated); offset = start;
      for (const item of page.items) bytes += Buffer.byteLength(JSON.stringify(item));
      if (bytes > OPEN_BYTES) throw Error('live_open_budget');
      if (offset === 0) break;
      const first = accumulated[0];
      if (first && (first.partIndex ?? 0) === 0 && first.role === 'user') break;
      before = offset;
    }
    while (accumulated.length > 0 && (accumulated[0]!.partIndex ?? 0) > 0) { accumulated.shift(); offset++; }
    if (accumulated.length === 0) throw Error('live_open_active_path');
    const items = this.#assemble(accumulated);
    if (items.length > 0 && parent !== null && (items.at(-1)?.entryId ?? items.at(-1)?.id) !== parent) throw Error('live_open_active_path');
    for (let index = 1; index < items.length; index++) {
      const prior = items[index - 1]!, item = items[index]!;
      if ((prior.entryId ?? prior.id) === (item.entryId ?? item.id)) continue;
      if (item.parentId !== (prior.entryId ?? prior.id)) throw Error('live_open_active_path');
    }
    return {items, offset};
  }
  /** Rejoin Native record parts without retaining the whole branch. */
  #assemble(rows: HistoryItem[]): HistoryItem[] {
    const items: HistoryItem[] = [];
    let pending: HistoryRecordParts | undefined;
    for (const row of rows) {
      const index = row.partIndex ?? 0, count = row.partCount ?? 1;
      if (index === 0) {
        if (pending) throw Error('live_open_parts');
        pending = new HistoryRecordParts(row, count, true);
        const item = pending.append(row, 0);
        if (item) { items.push(item); pending = undefined; }
      } else {
        if (!pending) throw Error('live_open_parts');
        const item = pending.append(row, index);
        if (item) { items.push(item); pending = undefined; }
      }
    }
    if (pending) throw Error('live_open_parts');
    return items;
  }
  #build(items: HistoryItem[], start: {turn: number; step: number}, ledger: ToolCallLedger) {
    const records: SessionHistoryRecord[] = [];
    let counters = start;
    const emit = (type: string, data: JsonValue, surface = false) => {
      const entry = historyEvent(records.length, type, data, surface); records.push(entry); return entry;
    };
    for (const item of items) {
      const id = item.entryId ?? item.id;
      counters = settledCoordinates(item.role, counters, item.toolCalls?.length ?? 0);
      historyMessage(item, id, counters, emit, false, ledger);
    }
    return {records, end: counters};
  }
  /** A cold Session still appends its own activation bookkeeping after the opening read; hold the
   * journal unpublished until the cut has been quiet for a short window so the client's first
   * follow does not inherit a cut that immediately moves. */
  async #quiesce(history: HistoryClient): Promise<void> {
    let quiet = 0;
    for (let reads = 0; quiet < OPEN_QUIET_POLLS; reads++) {
      if (reads >= OPEN_SETTLE_READS) throw Error('live_open_unsettled');
      await delay(OPEN_QUIET_DELAY_MS);
      const poll = await history.poll(this.opened.cut.workerId, this.#after);
      const before = this.#after;
      this.accept(poll);
      quiet = poll.events.length === 0 && this.#after === before ? quiet + 1 : 0;
    }
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
  get cursor(): number { return this.#firstSeq + this.#records.length - 1; }
  get after(): number { return this.#after; }
  get failure(): string | undefined { return this.#failure; }
  /** Release the retained native cut; older-page paging is impossible after this. */
  dispose(): void {
    if (this.#closed) return; this.#closed = true;
    // Capture the snapshot now: a renewal that lands between dispose and this microtask must be closed by
    // the renewal, never by this deferred close.
    const snapshot = this.opened.snapshot;
    Promise.resolve().then(() => this.history.close(snapshot)).catch(() => {});
  }
  invalidate(code: string): void { this.#failure ??= code; this.#listeners.clear(); this.dispose(); }
  #fail(code: string): never { this.invalidate(code); throw Error(code); }
  #assert(): void { if (this.#failure) throw Error(this.#failure); }
  #remember(seq: number, value: {offset: number; turn: number; step: number; parent: string | null}): void {
    if (this.#boundaries.size >= ASSOCIATIONS) this.#fail('live_history_window_evicted');
    this.#boundaries.set(seq, value);
  }
  #hasOlder(): boolean { return (this.#boundaries.get(this.#firstSeq)?.offset ?? 0) > 0; }
  /** Serve one older Native chunk on demand: seqs stay contiguous and no history is retained here. */
  async #olderPage(before: number): Promise<SessionPage> {
    const boundary = this.#boundaries.get(before);
    if (!boundary) throw Error('live_stale_page');
    if (boundary.offset === 0) return {records: [], hasMore: false, projection: this.projection};
    const older = await this.#nativeOlder(this.history, boundary.offset, boundary.parent);
    let users = 0, assistants = 0;
    for (const item of older.items) { if (item.role === 'user') users++; if (item.role === 'assistant') assistants++; }
    const start = {turn: boundary.turn - users, step: boundary.step - assistants};
    if (start.turn < 0 || start.step < 0 || older.items.length === 0) throw Error('live_open_count');
    const built = this.#build(older.items, start, new ToolCallLedger());
    if (built.end.turn !== boundary.turn || built.end.step !== boundary.step) throw Error('live_open_count');
    const base = before - built.records.length;
    if (base < 0) throw Error('live_open_count');
    const records = built.records.map(record => record.type === 'event'
      ? {...record, event: {...record.event, seq: record.event.seq + base}} : record);
    this.#remember(base, {offset: older.offset, turn: start.turn, step: start.step, parent: older.items[0]?.parentId ?? null});
    // Freshly built per page and never mutated after publication: the wire encoder is the only reader.
    return {records, hasMore: older.offset > 0, projection: this.projection};
  }
  async page(request: PageRequest): Promise<SessionPage> {
    this.#assert();
    if (request.beforeSeq !== undefined && request.beforeSeq <= this.#firstSeq) return this.#olderPage(request.beforeSeq);
    return {...this.#page(request, PAGE_BYTES), projection: this.projection};
  }
  #page(request: PageRequest, limit: number): SessionPage {
    this.#assert();
    const { end, maximum } = pageCoordinates(request, this.cursor);
    const windowEnd = this.#firstSeq + this.#records.length;
    const localEnd = Math.max(0, Math.min(end, windowEnd) - this.#firstSeq);
    let start = localEnd, bytes = PAGE_OVERHEAD, count = 0;
    for (let index = this.#groupBefore(localEnd); index >= 0 && count < maximum; index--) {
      const candidate = this.#groups[index]!;
      // Include one array separator per record as well as the encoded events.
      const size = this.#recordBytesBefore(start) - this.#recordBytesBefore(candidate) + start - candidate;
      if (bytes + size > limit) { if (!count) throw Error('live_page_group_bytes'); break; }
      bytes += size; start = candidate; count++;
    }
    // `slice` copies the window; the records themselves stay immutable after publication, so a deep
    // clone here would only double the transient copy of every page (the biggest reload allocation).
    return {records: this.#records.slice(start, localEnd), hasMore: start > 0 || this.#hasOlder()};
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
    return {type: 'snapshot', projection: this.projection, header: {version: 4, id: this.sessionId, createdAt: 0, isSeeded: false},
      cursor: this.cursor, ...page, projections: {projection: this.projection, asOfSeq: this.cursor, values: {}}, assistantStream};
  }
  subscribe(listener: (frame: SessionFollowFrame) => void): () => void {
    this.#assert(); this.#listeners.add(listener); return () => { this.#listeners.delete(listener); };
  }
  /** Every live frame carries this journal's projection identity: a generation-scoped client drops frames it cannot bind. */
  #publish(frame: SessionFollowFrame): void {
    const stamped = {...frame, projection: this.projection};
    for (const listener of this.#listeners) listener(structuredClone(stamped));
  }
  #event(type: string, data: JsonValue, surface = false): SessionHistoryRecord {
    const entry = historyEvent(this.#firstSeq + this.#records.length, type, data, surface);
    const bytes = Buffer.byteLength(JSON.stringify(entry));
    if (bytes > MAX_ITEM_BYTES) this.#fail('live_event_bytes');
    const end = this.#recordBytesBefore(this.#records.length) + bytes;
    if (this.#records.length >= MAX_EVENTS || end > this.#maxBytes) this.#fail('live_projection_evicted');
    this.#records.push(entry); this.#recordByteEnds.push(end); this.#publish(entry); return entry;
  }
  #commit(item: HistoryItem): SessionHistoryRecord | undefined {
    const id = item.entryId ?? item.id;
    if (this.#entries.has(id)) return;
    this.#entries.add(id); this.#publishedLeaf = id; if (item.live) this.#settled.add(identity(item.live));
    if (item.role === 'assistant' && (!item.provider || !item.model)) this.#fail('live_missing_model_source');
    const attempt = item.role === 'assistant' && item.live && this.#attempt
      && identity(item.live) === identity(this.#attempt.live) ? this.#attempt : undefined;
    const coordinates = settledCoordinates(item.role, { turn: this.#turn, step: this.#step }, item.toolCalls?.length ?? 0);
    if (!attempt) {
      if (coordinates.length > 1 || !this.#attempt) this.#groups.push(this.#records.length);
      this.#turn = coordinates.turn; this.#step = coordinates.step;
    }
    return historyMessage(item, id, attempt ?? coordinates,
      (type, data, surface) => this.#event(type, data, surface), !!attempt, this.#toolCalls);
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
    // Cut/source/context bookkeeping moves under this journal without retiring it: the event stream is
    // still contiguous from `after`, the execution worker and native Session are unchanged, and a real
    // branch move, rewrite or rebuild is rejected in `#apply` below.
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
    // Native bookkeeping keeps this generation: OMP rewrites the file when it records activation, a
    // submission or settled metadata. The published entries and the retained paging snapshot stay valid,
    // and `accept` still proves the stream is contiguous, so a projection the stock client cannot rebind
    // is not retired here — a rebuild, branch move or compaction below still retires it.
    if (event.kind === 'native_setLeaf') {
      const leaf = event.source?.leafId ?? null;
      if (leaf !== this.#publishedLeaf) this.#fail('live_projection_invalidated');
      this.#nativeLeaf = leaf; return;
    }
    if (event.kind === 'native_content_changed' || event.kind === 'native_untracked_rewrite'
      || event.kind === 'native_source_replaced' || event.kind === 'native_source_binding') return;
    if (['native_clear', 'native_rebuild', 'native_rewrite', 'native_runtime_replaced', 'native_live_gap',
      'native_settlement_evicted', 'auto_compaction_start'].includes(event.kind)) {
      this.#fail('live_projection_invalidated');
    }
    if (event.kind === 'native_append') this.#sourceAppend(event);
    if (!event.live || !event.item) return;
    const key = identity(event.live); if (this.#settled.has(key)) return;
    if (event.item.role === 'toolResult' && !event.live.toolOwnerMessageId) this.#fail('live_tool_owner_unavailable');
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
