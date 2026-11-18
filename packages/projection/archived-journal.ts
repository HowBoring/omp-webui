import { isDeepStrictEqual } from 'node:util';
import { SessionId } from '@deepseek-ai/dsh-session/types';
import type {
  SessionFollowFrame, SessionHistoryRecord, SessionPage,
} from '@deepseek-ai/dsh-api-session-controller/types';
import type { ActiveHistoryEntry, ActiveHistoryEntryKey, ActiveHistoryOpen, ActiveHistoryPosition,
  ActiveHistorySource } from '../contracts/active-history-source.ts';
import type { HistoryCut, HistoryItem, HistorySourceBinding } from '../contracts/generated/omp-wire.ts';
import type { StopSnapshot } from '../contracts/stop.ts';
import { HistoryRecordParts } from './history-record-parts.ts';
import { MAX_EVENTS, MAX_ITEM_BYTES, PAGE_BYTES, PAGE_OVERHEAD,
  pageCoordinates, settledCoordinates, settledHistoryRecords, type PageRequest } from './history-records.ts';

const INDEX_BYTES = 8 * 1024 * 1024;
const INDEX_ENTRIES = 20_000;
const INDEX_PAGE_ENTRIES = 2048;
const RANGE_PAGE_PARTS = 128;
const PART_WIDTH = 32 * 1024;
const MAX_PARTS = Math.ceil(MAX_ITEM_BYTES / PART_WIDTH);
const MAX_READERS = 4;
const digest = /^[0-9a-f]{64}$/;
const handle = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const entryFields = new Set<string>(['ordinal', 'entryId', 'digest', 'parentId', 'kind',
  'role', 'provider', 'model', 'stopReason', 'live'] satisfies (keyof ActiveHistoryEntry)[]);
const encodedBytes = (value: unknown): number => Buffer.byteLength(JSON.stringify(value));

export interface ArchivedHistoryOwner {
  readonly workerId: string;
  readonly workerGeneration: string;
  readonly sourceId: string;
  readonly sessionId: string;
  readonly contextId: string;
  readonly catalogBinding?: HistorySourceBinding;
  /** The projection owner's trusted lifetime for this exact Native worker and Session. */
  current(): boolean;
  /** Trusted joint Native and Broker settlement for this worker and Session, at the cut when supplied. */
  stop(cut?: HistoryCut): StopSnapshot | undefined;
}
export interface ArchivedHistoryAccess {
  readonly generation: string;
  /** Synchronously revalidate the initiating Browser View, holder and grant. */
  current(): boolean;
}

interface ArchivedRow {
  readonly entry: ActiveHistoryEntry;
  readonly start: number;
  readonly turn: number;
  readonly step: number;
}
type ArchiveEnvelope = Pick<ActiveHistoryOpen, 'snapshot' | 'cut' | 'expiresAt'>;

function settled(owner: ArchivedHistoryOwner, cut?: HistoryCut, generation?: string): string {
  if (!owner.current()) throw Error('live_archive_owner');
  const state = owner.stop(cut);
  if (!state || state.workerGeneration !== owner.workerGeneration || state.scope.kind !== 'session'
    || state.scope.sessionId !== owner.sessionId || state.status !== 'idle' || !state.nativeSettled
    || !state.acceptingWork || Object.values(state.pending).some(count => count !== 0) || state.failures.length
    || (generation !== undefined && state.generation !== generation)) throw Error('live_archive_unsettled');
  return state.generation;
}

function validateOpen(opened: ActiveHistoryOpen, owner: ArchivedHistoryOwner): void {
  const { cut } = opened;
  if (opened.version !== 'active-history-index-v1' || opened.streaming) throw Error('live_archive_unsupported');
  if (!handle.test(opened.snapshot) || !digest.test(cut.contentRevision)
    || !Number.isSafeInteger(opened.expiresAt) || opened.expiresAt <= Date.now()) throw Error('live_archive_cut');
  if (cut.workerId !== owner.workerId || cut.sourceId !== owner.sourceId || cut.sessionId !== owner.sessionId
    || cut.contextId !== owner.contextId || cut.sourceBindingStatus !== (owner.catalogBinding ? 'catalog' : 'worker')
    || !isDeepStrictEqual(cut.catalogBinding, owner.catalogBinding)) throw Error('live_archive_cut');
  if (!Number.isSafeInteger(opened.count) || opened.count < 0 || opened.count > INDEX_ENTRIES
    || !Number.isSafeInteger(opened.indexBytes) || opened.indexBytes < 0 || opened.indexBytes > INDEX_BYTES) {
    throw Error('live_archive_index_budget');
  }
}

function validatePart(item: HistoryItem, entry: ActiveHistoryEntry, partIndex: number): number {
  const count = item.partCount ?? 0;
  if (item.partIndex !== partIndex || !Number.isSafeInteger(count) || count < 1
    || partIndex >= count || item.text.length > PART_WIDTH || (count > 1 && item.text.length === 0)
    || (partIndex < count - 1 && item.text.length !== PART_WIDTH) || encodedBytes(item) + 1 > MAX_ITEM_BYTES) {
    throw Error('live_archive_part');
  }
  if (count > MAX_PARTS) throw Error('live_event_bytes');
  if (!item.active || item.livePhase !== undefined || item.settlement !== undefined || item.entryId !== entry.entryId
    || item.parentId !== entry.parentId || item.kind !== entry.kind || item.role !== entry.role
    || item.provider !== entry.provider || item.model !== entry.model
    || (entry.role === 'assistant' && item.stopReason !== entry.stopReason)
    || !isDeepStrictEqual(item.live, entry.live)) {
    throw Error('live_archive_part');
  }
  return count;
}

/** Retain the newest whole groups that fit, in the same order as eager backward pagination. */
class PageWindow {
  readonly #groups: { records: SessionHistoryRecord[]; bytes: number }[] = [];
  #bytes = PAGE_OVERHEAD;
  #oversized = false;

  constructor(readonly limit: number) {}

  append(records: SessionHistoryRecord[], length: number): void {
    const sizes = records.map(encodedBytes);
    if (sizes.some(size => size > MAX_ITEM_BYTES)) throw Error('live_event_bytes');
    const bytes = sizes.slice(0, length).reduce((sum, size) => sum + size + 1, 0);
    while (this.#bytes + bytes > this.limit && this.#groups.length) this.#bytes -= this.#groups.shift()!.bytes;
    this.#oversized = this.#bytes + bytes > this.limit;
    if (this.#oversized) return;
    this.#groups.push({ records: records.slice(0, length), bytes });
    this.#bytes += bytes;
  }

  finish(): SessionPage {
    if (this.#oversized) throw Error('live_page_group_bytes');
    const records = this.#groups.flatMap(group => group.records);
    return { records, hasMore: (records[0]?.event.seq ?? 0) > 0 };
  }
}

/** An immutable settled Conversation prefix, scoped to one Native cut. All body reads are request-local. */
export class ArchivedJournal {
  readonly generation = crypto.randomUUID();
  readonly sessionId;
  readonly #rows: ArchivedRow[] = [];
  readonly #source: ActiveHistorySource;
  readonly #owner: ArchivedHistoryOwner;
  readonly #opened: ActiveHistoryOpen;
  #nextSeq = 0;
  #readers = 0;
  #failure: string | undefined;
  #closing: Promise<void> | undefined;

  private constructor(source: ActiveHistorySource, owner: ArchivedHistoryOwner, opened: ActiveHistoryOpen) {
    this.#source = source;
    this.#owner = owner;
    this.#opened = opened;
    this.sessionId = SessionId(opened.cut.sessionId);
  }

  static async open(source: ActiveHistorySource | undefined, owner: ArchivedHistoryOwner): Promise<ArchivedJournal> {
    if (!source) throw Error('live_archive_unsupported');
    const { workerId, workerGeneration, sourceId, sessionId, contextId, catalogBinding } = owner;
    const scope = { workerId, workerGeneration, sourceId, sessionId, contextId,
      ...(catalogBinding ? { catalogBinding: { ...catalogBinding } } : {}),
      current: owner.current.bind(owner), stop: owner.stop.bind(owner) };
    const stopGeneration = settled(scope);
    const opened = structuredClone(await source.open());
    try {
      settled(scope, opened.cut, stopGeneration);
      validateOpen(opened, scope);
      const archive = new ArchivedJournal(source, scope, opened);
      await archive.#loadIndex(stopGeneration);
      settled(scope, opened.cut, stopGeneration);
      archive.#assertCurrent();
      return archive;
    } catch (error) {
      try { await source.close({ snapshot: opened.snapshot, contentRevision: opened.cut.contentRevision }); }
      catch { /* Native can already have expired the handle. Preserve the open failure. */ }
      throw error;
    }
  }

  get cursor(): number { return this.#nextSeq - 1; }

  invalidate(code: string): void { this.#failure ??= code; }

  async close(): Promise<void> {
    this.invalidate('live_archive_closed');
    this.#closing ??= (async () => {
      const result = await this.#source.close(this.#binding());
      if (!result.closed) throw Error('live_archive_close');
    })();
    return this.#closing;
  }

  page(access: ArchivedHistoryAccess, request: PageRequest): Promise<SessionPage> {
    return this.#page({ generation: access.generation, current: access.current.bind(access) }, request, PAGE_BYTES);
  }

  async snapshot(access: ArchivedHistoryAccess): Promise<Extract<SessionFollowFrame, { type: 'snapshot' }>> {
    const requestAccess = { generation: access.generation, current: access.current.bind(access) };
    const assistantStream = { revision: 0 };
    const reserve = encodedBytes(assistantStream) + 8192;
    const page = await this.#page(requestAccess, {}, PAGE_BYTES - reserve);
    this.#assertAccess(requestAccess);
    return { type: 'snapshot', header: { version: 4, id: this.sessionId, createdAt: 0, isSeeded: false },
      cursor: this.cursor, ...page, projections: { asOfSeq: this.cursor, values: {} }, assistantStream };
  }

  #binding() { return { snapshot: this.#opened.snapshot, contentRevision: this.#opened.cut.contentRevision }; }

  #assertCurrent(): void {
    if (this.#failure) throw Error(this.#failure);
    if (!this.#owner.current()) throw Error('live_archive_owner');
    if (this.#opened.expiresAt <= Date.now()) throw Error('live_archive_expired');
  }

  #assertAccess(access: ArchivedHistoryAccess): void {
    this.#assertCurrent();
    if (access.generation !== this.generation || !access.current()) throw Error('live_archive_access');
  }

  #checkEnvelope(page: ArchiveEnvelope): void {
    if (page.snapshot !== this.#opened.snapshot || page.expiresAt !== this.#opened.expiresAt
      || !isDeepStrictEqual(page.cut, this.#opened.cut)) throw Error('live_archive_cut');
    if (encodedBytes(page) > PAGE_BYTES) throw Error('live_archive_native_page_bytes');
  }

  async #loadIndex(stopGeneration: string): Promise<void> {
    const { count, cut, indexBytes } = this.#opened;
    const seen = new Set<string>();
    let bytes = 0, leaf: string | null = null, counters = { turn: 0, step: 0 };
    while (this.#rows.length < count) {
      const start = this.#rows.length;
      const page = await this.#source.index(this.#binding(), start);
      this.#assertCurrent();
      settled(this.#owner, cut, stopGeneration);
      if (!page.items.length || page.items.length > INDEX_PAGE_ENTRIES || start + page.items.length > count) {
        throw Error('live_archive_index_order');
      }
      this.#checkEnvelope(page);
      for (const item of page.items) {
        const size = encodedBytes(item);
        bytes += size;
        if (size > MAX_ITEM_BYTES || bytes > indexBytes) throw Error('live_archive_index_budget');
        this.#validateEntry(item, leaf, seen);
        const position = settledCoordinates(item.role, counters);
        this.#rows.push({ entry: structuredClone(item), start: this.#nextSeq,
          turn: position.turn, step: position.step });
        this.#nextSeq += position.length;
        leaf = item.entryId; counters = position;
      }
      const next = this.#rows.length < count ? this.#rows.length : undefined;
      if (page.nextOrdinal !== next || this.#nextSeq > MAX_EVENTS) throw Error('live_archive_index_order');
    }
    if (leaf !== cut.leafId) throw Error('live_archive_index_order');
  }

  #validateEntry(item: ActiveHistoryEntry, parentId: string | null, seen: Set<string>): void {
    if (item.ordinal !== this.#rows.length || item.parentId !== parentId || !item.entryId
      || item.entryId.length > 256 || !digest.test(item.digest) || seen.has(item.entryId)
      || Object.keys(item).some(key => !entryFields.has(key))) {
      throw Error('live_archive_index_order');
    }
    if (item.role === 'assistant' && (!item.provider || !item.model)) throw Error('live_missing_model_source');
    seen.add(item.entryId);
  }

  #lastRow(end: number): number {
    let low = 0, high = this.#rows.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (this.#rows[middle]!.start < end) low = middle + 1;
      else high = middle;
    }
    return low - 1;
  }

  async #page(access: ArchivedHistoryAccess, request: PageRequest, limit: number): Promise<SessionPage> {
    this.#assertAccess(access);
    const { end, maximum } = pageCoordinates(request, this.cursor);
    if (end === 0) return { records: [], hasMore: false };
    if (this.#readers >= MAX_READERS) throw Error('live_archive_busy');
    this.#readers++;
    try {
      const last = this.#lastRow(end);
      const page = await this.#hydrate(access, Math.max(0, last - maximum + 1), last, end, limit);
      this.#assertAccess(access);
      return page;
    } finally { this.#readers--; }
  }

  async #hydrate(access: ArchivedHistoryAccess, first: number, last: number, end: number, limit: number) {
    const rows = this.#rows.slice(first, last + 1);
    const keys: ActiveHistoryEntryKey[] = rows.map(({ entry: { ordinal, entryId, digest } }) =>
      ({ ordinal, entryId, digest }));
    const window = new PageWindow(limit);
    let ordinal = first, partIndex = 0;
    let pending: HistoryRecordParts | undefined;
    while (ordinal <= last) {
      this.#assertAccess(access);
      const page = await this.#source.range(this.#binding(), keys.slice(ordinal - first), partIndex);
      this.#assertAccess(access);
      if (!page.items.length || page.items.length > RANGE_PAGE_PARTS) throw Error('live_archive_range');
      this.#checkEnvelope(page);
      for (const item of page.items) {
        const row = this.#rows[ordinal];
        if (!row || ordinal > last) throw Error('live_archive_range');
        const partCount = validatePart(item, row.entry, partIndex);
        pending ??= new HistoryRecordParts({ ...item, text: '' }, partCount, true);
        const assembled = pending.append(item, partIndex++);
        if (!assembled) continue;
        window.append(settledHistoryRecords(assembled, row.entry.entryId, row.start, row), end - row.start);
        pending = undefined; ordinal++; partIndex = 0;
      }
      const next: ActiveHistoryPosition | undefined = ordinal <= last ? { ordinal, partIndex } : undefined;
      if (!isDeepStrictEqual(page.next, next)) throw Error('live_archive_range');
    }
    return window.finish();
  }
}
