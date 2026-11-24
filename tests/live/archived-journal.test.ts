import { expect, test } from 'bun:test';
import type { ActiveHistoryEntry, ActiveHistorySource } from '../../packages/contracts/active-history-source.ts';
import { HistoryClient } from '../../packages/contracts/generated/history-client.ts';
import type { HistoryCut, HistoryItem } from '../../packages/contracts/generated/omp-wire.ts';
import type { StopSnapshot } from '../../packages/contracts/stop.ts';
import { ArchivedJournal } from '../../packages/projection/archived-journal.ts';
import { LiveJournal } from '../../packages/projection/live-journal.ts';

const cut: HistoryCut = { durability: 'not_attested', sourceBindingStatus: 'worker',
  workerId: 'worker', sourceId: 'source', sessionId: 'session', contextId: 'context',
  contentRevision: '1'.repeat(64), retainedRevision: '2'.repeat(64),
  nativeRevision: 1, observationSeq: 1, leafId: null };
const stop: StopSnapshot = { scope: { kind: 'session', sessionId: cut.sessionId },
  generation: 'stop', workerGeneration: 'worker-generation', status: 'idle', nativeSettled: true,
  acceptingWork: true, pending: { interactions: 0, history: 0, queued: 0, other: 0 }, failures: [],
  forceAvailable: false, restored: null, draftConflict: false };
const metadata = (ordinal: number): ActiveHistoryEntry => ({
  ordinal, entryId: String(ordinal), parentId: ordinal ? String(ordinal - 1) : null,
  digest: (ordinal + 1).toString(16).padStart(64, '0'), kind: 'message', role: 'user',
});
const filler = 'x'.repeat(11_000);
const text = (ordinal: number) => String(ordinal) + filler;

function fixture(count: number) {
  const openCut = { ...cut, leafId: count ? String(count - 1) : null };
  const envelope = { cut: openCut, snapshot: '00000000-0000-0000-0000-000000000001', expiresAt: Date.now() + 60_000 };
  const reads: number[][] = [];
  const source: ActiveHistorySource = {
    open: async () => ({ ...envelope, version: 'active-history-index-v1', count, indexBytes: count * 240,
      scannedBytes: count * filler.length, streaming: false }),
    index: async (binding, start) => {
      expect(binding).toEqual({ snapshot: envelope.snapshot, contentRevision: cut.contentRevision });
      const end = Math.min(count, start + 2048);
      return { ...envelope, items: Array.from({ length: end - start }, (_, i) => metadata(start + i)),
        ...(end < count ? { nextOrdinal: end } : {}) };
    },
    range: async (binding, keys, startPart) => {
      expect(binding).toEqual({ snapshot: envelope.snapshot, contentRevision: cut.contentRevision });
      expect(startPart).toBe(0);
      reads.push(keys.map(key => key.ordinal));
      return { ...envelope, items: keys.map(({ ordinal, entryId, digest }) => {
        expect(digest).toBe(metadata(ordinal).digest);
        return { entryId, id: entryId, parentId: metadata(ordinal).parentId, kind: 'message',
          active: true, role: 'user', text: text(ordinal), partCount: 1, partIndex: 0 };
      }) };
    },
    close: async () => ({ closed: true }),
  };
  const owner = { workerId: cut.workerId, sourceId: cut.sourceId, contextId: cut.contextId,
    sessionId: cut.sessionId, workerGeneration: stop.workerGeneration, current: () => true, stop: () => stop };
  return { source, owner, reads, envelope };
}

test('an archived generation represents over 100 MiB and hydrates only the two requested DSH windows', async () => {
  const count = 10_000;
  expect(count * Buffer.byteLength(filler)).toBeGreaterThan(100 * 1024 * 1024);
  const { source, owner, reads } = fixture(count);
  const archive = await ArchivedJournal.open(source, owner);
  expect(archive.cursor).toBe(count * 2 - 1);
  expect(reads).toEqual([]);
  const access = { generation: archive.generation, current: () => true };
  const initial = await archive.snapshot(access);
  expect(initial.records).toHaveLength(64);
  expect(initial.assistantStream).toEqual({ revision: 0 });
  expect(initial.cursor).toBe(19_999);
  const old = await archive.page(access, { throughSeq: 19_999, beforeSeq: 27, maxMessages: 2 });
  expect(old.records.map(record => record.event)).toEqual([
    { seq: 24, time: 0, type: 'turn/start', ignorable: true, data: { turn: 13 } },
    { seq: 25, time: 0, type: 'user/message', surfaceOp: 'append',
      data: { id: '12', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: text(12) }] } },
    { seq: 26, time: 0, type: 'turn/start', ignorable: true, data: { turn: 14 } },
  ]);
  expect(old.hasMore).toBe(true);
  expect(reads).toEqual([Array.from({ length: 32 }, (_, i) => count - 32 + i), [12, 13]]);
  for (const page of [initial, old]) expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThan(768 * 1024);
  await archive.close();
});

test('a revoked Browser View cannot publish a range while another holder keeps the same archive', async () => {
  const { source, owner } = fixture(100);
  const archive = await ArchivedJournal.open(source, owner);
  const payload = source.range;
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  source.range = async (...request) => {
    entered.resolve();
    await release.promise;
    return payload(...request);
  };

  let current = true;
  const view = { generation: archive.generation, current: () => current };
  const another = { generation: archive.generation, current: () => true };
  const first = archive.page(view, { maxMessages: 1 });
  const second = archive.page(another, { maxMessages: 1 });
  await entered.promise;
  current = false;
  release.resolve();
  await expect(first).rejects.toThrow('live_archive_access');
  expect((await second).records.map(record => record.event.seq)).toEqual([198, 199]);
  await expect(archive.page({ ...another, generation: 'retired' }, {})).rejects.toThrow('live_archive_access');
  await archive.close();
});

test('a replacement Native cut and an in-flight projection retirement cannot publish a page', async () => {
  const { source, owner, envelope } = fixture(100);
  const archive = await ArchivedJournal.open(source, owner);
  const view = { generation: archive.generation, current: () => true };
  const payload = source.range;
  source.range = async (...request) => ({ ...await payload(...request),
    cut: { ...envelope.cut, observationSeq: envelope.cut.observationSeq + 1 } });
  await expect(archive.page(view, { maxMessages: 1 })).rejects.toThrow('live_archive_cut');

  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  source.range = async (...request) => {
    entered.resolve();
    await release.promise;
    return payload(...request);
  };
  const pending = archive.page(view, { maxMessages: 1 });
  await entered.promise;
  archive.invalidate('live_projection_invalidated');
  release.resolve();
  await expect(pending).rejects.toThrow('live_projection_invalidated');
  await archive.close();
});

test('streaming, unmatched Stop authority and revocation during open cannot admit an archived cut', async () => {
  const { source, owner } = fixture(100);
  await expect(ArchivedJournal.open(undefined, owner)).rejects.toThrow('live_archive_unsupported');
  const open = source.open;
  let closes = 0;
  source.close = async () => { closes++; return { closed: true }; };
  source.open = async () => ({ ...await open(), streaming: true });
  await expect(ArchivedJournal.open(source, owner)).rejects.toThrow('live_archive_unsupported');
  expect(closes).toBe(1);

  const wrongStop = { ...owner, stop: () => ({ ...stop, workerGeneration: 'retired' }) };
  await expect(ArchivedJournal.open(source, wrongStop)).rejects.toThrow('live_archive_unsettled');
  expect(closes).toBe(1);

  let current = true;
  source.open = async () => { current = false; return open(); };
  const revoked = ArchivedJournal.open(source, { ...owner, current: () => current });
  await expect(revoked).rejects.toThrow('live_archive_owner');
  expect(closes).toBe(2);
});

const partWidth = 32 * 1024;
const sourcePageParts = 8;

function partsFor(entry: ActiveHistoryEntry, text: string): HistoryItem[] {
  const { ordinal: _ordinal, digest: _digest, ...row } = entry;
  const count = Math.max(1, Math.ceil(text.length / partWidth));
  return Array.from({ length: count }, (_, partIndex) => ({
    ...row, id: partIndex ? `${row.entryId}:part:${partIndex}` : row.entryId, active: true,
    partIndex, partCount: count, text: text.slice(partWidth * partIndex, partWidth * (partIndex + 1)),
  }));
}

function eagerFixture(envelope: ReturnType<typeof fixture>['envelope'], parts: HistoryItem[]) {
  const cursors = { active: '0', tree: 'tree', running: 'running', live: 'live' };
  return new HistoryClient(async command => {
    switch (command.type) {
      case 'history_snapshot_open':
        return { ...envelope, version: 'coherent-history-v1', handoff: 'live', scope: 'active', cursor: cursors.active,
          cursors, count: parts.length, streaming: false, compacting: false, prefix: null, scannedBytes: 0,
          scanMs: 0, snapshotMs: 0, limits: { entries: 20_000, runningMessages: 20_000, scanItems: 40_004,
            bytes: 320 * 1024 * 1024, nativeItemBytes: 64 * 1024 * 1024, itemBytes: 512 * 1024, ms: 5_000,
            snapshotBytes: 256 * 1024 * 1024, cacheBytes: 512 * 1024 * 1024, snapshots: 2, pageItems: 128,
            pageBytes: 768 * 1024, responseBytes: 1024 * 1024, ttlMs: 600_000, contentItems: 20_000,
            contentPageBytes: 256 * 1024, liveEvents: 4096, liveBytes: 8 * 1024 * 1024, pollItems: 128 } };
      case 'history_snapshot_page': {
        if (command.cursor === 'live') return { ...envelope, scope: 'live', items: [], complete: true };
        if (command.before !== undefined) {
          const end = Math.min(command.before, parts.length), start = Math.max(0, end - sourcePageParts);
          return {...envelope, scope: 'active', items: parts.slice(start, end), complete: true, offset: start};
        }
        const start = Number(command.cursor);
        const end = Math.min(start + sourcePageParts, parts.length);
        return { ...envelope, scope: 'active', items: parts.slice(start, end), complete: true,
          ...(end < parts.length ? { nextCursor: String(end) } : {}) };
      }
      case 'history_snapshot_close':
        return { closed: true };
      case 'history_observation_poll':
        return { cut: envelope.cut, after: command.after, through: command.after, events: [], hasMore: false };
      default:
        throw Error('unexpected_history_command');
    }
  });
}

test('multipart archived groups match eager DSH pages under cut and encoded byte limits', async () => {
  const { source, owner, envelope } = fixture(3);
  const entries = [
    metadata(0),
    { ...metadata(1), role: 'assistant', model: 'fixture-model', provider: 'fixture-provider', stopReason: 'aborted' },
    { ...metadata(2), kind: 'compaction', role: 'compactionSummary' },
  ];
  const assistantText = 'a'.repeat(partWidth - 1) + '🌐' + 'é'.repeat(180_000);
  const parts = [...partsFor(entries[0]!, 'u'.repeat(395_000)), ...partsFor(entries[1]!, assistantText),
    ...partsFor(entries[2]!, 'retained summary')];
  expect(parts.find(item => item.entryId === '1' && item.partIndex === 0)?.text.charCodeAt(partWidth - 1)).toBe(0xd83c);
  source.index = async () => ({ ...envelope, items: entries });
  source.range = async (_binding, keys, startPart) => {
    const matches = parts.filter(item => keys.some(key => key.entryId === item.entryId
      && key.digest === entries[key.ordinal]?.digest)).slice(startPart);
    const next = matches[sourcePageParts];
    return { ...envelope, items: matches.slice(0, sourcePageParts),
      ...(next ? { next: { ordinal: Number(next.entryId), partIndex: next.partIndex! } } : {}) };
  };
  const archive = await ArchivedJournal.open(source, owner);
  const eager = await LiveJournal.open(eagerFixture(envelope, parts), archive.generation);
  const view = { generation: archive.generation, current: () => true };
  const current = await archive.snapshot(view);
  expect(current).toEqual(eager.snapshot());
  expect(current.records.map(record => record.event.seq)).toEqual([2, 3, 4, 5, 6]);
  expect(current.records[1]?.event.data).toMatchObject({ turn: 1, step: 1, interrupted: true,
    message: { id: '1', source: { kind: 'model', provider: 'fixture-provider', model: 'fixture-model' },
      content: [{ type: 'text', text: assistantText }] } });
  const split = { throughSeq: 4, beforeSeq: 3, maxMessages: 3 };
  const old = await archive.page(view, split);
  expect(old).toEqual(await eager.page(split));
  expect(old.records.map(record => record.event.type)).toEqual(['turn/start', 'user/message', 'step/start']);
  expect(old.hasMore).toBe(false);

  const range = source.range;
  source.range = async (...request) => ({ ...await range(...request), next: { ordinal: 0, partIndex: 0 } });
  await expect(archive.page(view, {})).rejects.toThrow('live_archive_range');
  await archive.close();
});

test('the eager journal continues a live assistant through the shared record encoder', async () => {
  const { envelope } = fixture(0);
  const journal = await LiveJournal.open(eagerFixture(envelope, []));
  const live = { workerId: cut.workerId, sourceId: cut.sourceId, sessionId: cut.sessionId,
    contextId: cut.contextId, messageId: 'assistant-runtime', branchLeafId: null };
  const item: HistoryItem = { id: 'assistant', active: true, kind: 'message', parentId: null, text: 'settled',
    role: 'assistant', provider: 'fixture-provider', model: 'fixture-model', live };
  const published: string[] = [];
  journal.subscribe(frame => {
    if (frame.type === 'event') published.push(frame.event.type);
    if (frame.type === 'assistant-stream') published.push(frame.frame.type);
  });

  journal.accept({ after: 1, through: 4, hasMore: false, cut: { ...cut, leafId: item.id, observationSeq: 4 }, events: [
    { seq: 2, kind: 'message_start', live, item },
    { seq: 3, kind: 'native_append', item, source: { kind: 'append', revision: 2, contextRevision: 1,
      sessionId: cut.sessionId, leafId: item.id, entryId: item.id } },
    { seq: 4, kind: 'message_settlement', live, item, settlement: {
      status: 'observed', durability: 'not_attested', entryId: item.id } },
  ] });
  expect(published).toEqual(['step/start', 'start', 'assistant/message', 'end', 'step/end']);
  expect((await journal.page({ maxMessages: 1 })).records.map(record => record.event.seq)).toEqual([0, 1, 2]);
});

test('a single archived DSH event that exceeds the encoded budget fails before publication', async () => {
  const { source, owner, envelope } = fixture(1);
  const archive = await ArchivedJournal.open(source, owner);
  const view = { generation: archive.generation, current: () => true };
  for (const unpageable of ['"'.repeat(265_000), 'x'.repeat(16 * partWidth + 1)]) {
    const parts = partsFor(metadata(0), unpageable);
    source.range = async (_binding, _keys, startPart) => {
      const end = startPart + sourcePageParts;
      return { ...envelope, items: parts.slice(startPart, end),
        ...(end < parts.length ? { next: { ordinal: 0, partIndex: end } } : {}) };
    };
    await expect(archive.page(view, {})).rejects.toThrow('live_event_bytes');
  }
  await archive.close();
});

test('archived user rows require the same stop reason in Native metadata and payload', async () => {
  const { source, owner, envelope } = fixture(1);
  const user = { ...metadata(0), stopReason: 'native-stop' };
  const [body] = partsFor(user, 'retained user text');
  source.index = async () => ({ ...envelope, items: [user] });
  source.range = async () => ({ ...envelope, items: [body!] });

  const archive = await ArchivedJournal.open(source, owner);
  const eager = await LiveJournal.open(eagerFixture(envelope, [body!]), archive.generation);
  const view = { generation: archive.generation, current: () => true };
  expect(await archive.page(view, {})).toEqual(await eager.page({}));

  source.range = async () => ({ ...envelope, items: [{ ...body!, stopReason: 'changed' }] });
  await expect(archive.page(view, {})).rejects.toThrow('live_archive_part');
  await archive.close();
});
