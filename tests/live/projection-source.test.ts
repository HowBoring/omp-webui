import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { HistoryClient } from '../../packages/contracts/generated/history-client.ts';
import type { HistoryCut, HistoryItem, HistoryOpen, HistoryPage } from '../../packages/contracts/generated/omp-wire.ts';
import { LiveJournal } from '../../packages/projection/live-journal.ts';

const initialCut: HistoryCut = {
  durability: 'not_attested', sourceBindingStatus: 'worker', sourceId: 'source', sessionId: 'session', workerId: 'worker',
  contextId: 'context', contentRevision: 'content-v1', nativeRevision: 1, retainedRevision: 'retained-v1',
  leafId: 'last', observationSeq: 0,
};
const item = (id: string, parentId: string | null, text: string): HistoryItem =>
  ({id, parentId, active: true, kind: 'message', role: 'user', text});
const prefixMarker: HistoryItem = {id: 'running-prefix', parentId: null, active: false, kind: 'running_prefix',
  text: "[Running prefix content is available through this snapshot's running cursor]"};
const prefixLive = {workerId: initialCut.workerId, sourceId: initialCut.sourceId, sessionId: initialCut.sessionId,
  contextId: initialCut.contextId, branchLeafId: 'last', messageId: 'msg-1'};
const prefixRow: HistoryItem = {...prefixMarker, entryId: prefixMarker.id, partIndex: 0, partCount: 1,
  role: 'assistant', live: prefixLive, livePhase: 'streaming', text: 'In flight'};

function fixture(active: HistoryItem[][], options: {
  cut?: HistoryCut;
  page?: (page: HistoryPage, index: number) => HistoryPage;
  refusePage?: number;
  live?: HistoryItem[][];
  prefix?: HistoryItem;
} = {}) {
  const cut = options.cut ?? initialCut;
  const opened: HistoryOpen = {
    version: 'coherent-history-v1', handoff: 'live', snapshot: 'snapshot', cursor: 'active-0', scope: 'active', cut,
    cursors: {active: 'active-0', live: 'live-0', tree: 'tree-0', running: 'running-0'},
    expiresAt: Date.now() + 10_000, count: active.reduce((sum, page) => sum + page.length, 0),
    prefix: options.prefix ?? null, streaming: options.prefix !== undefined, compacting: false,
    scannedBytes: 0, scanMs: 0, snapshotMs: 0,
    limits: {entries: 20_000, runningMessages: 10_000, scanItems: 60_000, bytes: 320 * 1024 * 1024,
      nativeItemBytes: 64 * 1024 * 1024, itemBytes: 512 * 1024, ms: 10_000, snapshotBytes: 256 * 1024 * 1024,
      cacheBytes: 512 * 1024 * 1024, snapshots: 2, pageItems: 128, pageBytes: 768 * 1024,
      responseBytes: 1024 * 1024, ttlMs: 10_000, contentItems: 64, contentPageBytes: 256 * 1024,
      liveEvents: 1024, liveBytes: 1024 * 1024, pollItems: 100},
  };
  const history = new HistoryClient(async command => {
    switch (command.type) {
      case 'history_snapshot_open':
        assert.equal(command.scope, 'active');
        assert.equal(command.handoff, 'live');
        return opened;
      case 'history_snapshot_close':
        assert.equal(command.snapshot, opened.snapshot);
        return {closed: true};
      case 'history_observation_poll':
        assert.equal(command.after, cut.observationSeq);
        return {cut, after: cut.observationSeq, through: cut.observationSeq, events: [], hasMore: false};
      case 'history_snapshot_page': {
        const scope = command.cursor.startsWith('active-') ? 'active' : 'live';
        const index = Number(command.cursor.split('-')[1]);
        if (scope === 'active' && index === options.refusePage) throw Error('fixture_read_past_oversized_record');
        const pages = scope === 'active' ? active : options.live ?? [[]];
        const page: HistoryPage = {snapshot: opened.snapshot, scope, cut, expiresAt: opened.expiresAt,
          items: pages[index] ?? [], complete: true,
          ...(index + 1 < pages.length ? {nextCursor: `${scope}-${index + 1}`} : {})};
        return scope === 'active' && options.page ? options.page(page, index) : page;
      }
    }
  });
  return history;
}

test('opening refuses an oversized active record before asking for more native pages', async () => {
  const pages = Array.from({length: 20}, (_, partIndex) => [{
    ...item(partIndex === 0 ? 'last' : `last:part:${partIndex}`, null, 'x'.repeat(32 * 1024)),
    entryId: 'last', partIndex, partCount: 20,
  }]);
  await assert.rejects(LiveJournal.open(fixture(pages, {refusePage: 17})), /live_event_bytes/);
});

for (const [label, text, refusePage] of [['escaped', '\u0000', 3], ['multibyte', '界', 6]] as const) {
  test(`opening limits ${label} record text before asking for more native pages`, async () => {
    const pages = Array.from({length: 20}, (_, partIndex) => [{
      ...item(partIndex === 0 ? 'last' : `last:part:${partIndex}`, null, text.repeat(32 * 1024)),
      entryId: 'last', partIndex, partCount: 20,
    }]);
    await assert.rejects(LiveJournal.open(fixture(pages, {refusePage})), /live_event_bytes/);
  });
}

test('opening counts paired surrogates once when parts split them near the event byte limit', async () => {
  const emojiCount = 40;
  const ascii = 'a'.repeat(512 * 1024 - 256 - 4 * emojiCount);
  const asciiParts = ascii.match(/.{1,32768}/g) ?? [];
  const splitPairs = Array.from({length: emojiCount}, () => ['\ud83d', '\ude42']).flat();
  const textParts = [...asciiParts, ...splitPairs];
  const pages = textParts.map((text, partIndex) => [{
    ...item(partIndex === 0 ? 'last' : `last:part:${partIndex}`, null, text),
    entryId: 'last', partIndex, partCount: textParts.length,
  }]);
  const journal = await LiveJournal.open(fixture(pages));
  assert.deepEqual(journal.page({maxMessages: 1}).records[1]?.event.data, {
    id: 'last', role: 'user', source: {kind: 'user'}, content: [{type: 'text', text: ascii + '🙂'.repeat(emojiCount)}],
  });
});

test('opening rejects a page with a different Native revision under the same content revision', async () => {
  const history = fixture([[item('first', null, 'Older')], [item('last', 'first', 'Current')]], {
    page: (page, index) => index === 0 ? page : {...page, cut: {...page.cut, nativeRevision: 2}},
  });
  await assert.rejects(LiveJournal.open(history), /live_open_cut_changed/);
});

test('opening rejects a disconnected active path before publishing a snapshot', async () => {
  const history = fixture([[item('first', null, 'Older')], [item('last', 'other-branch', 'Current')]]);
  await assert.rejects(LiveJournal.open(history), /live_open_active_path/);
});

test('opening rejects a changed record role between parts across native pages', async () => {
  const first = {...item('last', null, 'One'), entryId: 'last', partIndex: 0, partCount: 2};
  const second = {...first, id: 'last:part:1', partIndex: 1, role: 'assistant', text: 'Two'};
  await assert.rejects(LiveJournal.open(fixture([[first], [second]])), /live_open_parts/);
});

test('opening refuses a singleton with conflicting Native row and entry IDs', async () => {
  const conflicting = {...item('foreign', null, 'From another record'), entryId: 'last', partIndex: 0, partCount: 1};
  await assert.rejects(LiveJournal.open(fixture([[conflicting]])), /live_open_parts/);
});

test('opening refuses a continuation with another Native record’s part ID', async () => {
  const first = {...item('last', null, 'One'), entryId: 'last', partIndex: 0, partCount: 2};
  const second = {...first, id: 'foreign:part:1', partIndex: 1, text: 'Two'};
  await assert.rejects(LiveJournal.open(fixture([[first], [second]])), /live_open_parts/);
});

test('a streaming row requires the same Native prefix marker in its opening cut', async () => {
  const active = [[item('last', null, 'Current')]];
  await assert.rejects(LiveJournal.open(fixture(active, {live: [[prefixRow]]})), /live_prefix_identity_unavailable/);
  const wrong = {...prefixMarker, id: 'foreign-prefix'};
  await assert.rejects(LiveJournal.open(fixture(active, {prefix: wrong, live: [[prefixRow]]})),
    /live_prefix_identity_unavailable/);
  await assert.rejects(LiveJournal.open(fixture(active, {prefix: prefixMarker})), /live_prefix_identity_unavailable/);
});

test('opening refuses a Native live row without a phase', async () => {
  const {livePhase, ...row} = prefixRow;
  await assert.rejects(LiveJournal.open(fixture([[item('last', null, 'Current')]], {live: [[row]]})), /live_open_phase/);
});

test('multipart opening keeps older pages and the in-flight assistant settlement on one journal', async () => {
  const cut = initialCut;
  const user = {...item('first', null, 'Old \ud83d'), entryId: 'first', partIndex: 0, partCount: 2};
  const userTail = {...user, id: 'first:part:1', partIndex: 1, text: '\ude42 question'};
  const assistant = {...item('last', 'first', 'Earlier answer'), role: 'assistant', provider: 'provider', model: 'model'};
  const live = prefixLive;
  const journal = await LiveJournal.open(fixture([[user], [userTail, assistant]], {
    prefix: prefixMarker, live: [[prefixRow]],
  }));
  const opening = journal.snapshot();
  assert.deepEqual(opening.records.map(record => [record.event.seq, record.event.type]), [
    [0, 'turn/start'], [1, 'user/message'], [2, 'step/start'], [3, 'assistant/message'], [4, 'step/end'], [5, 'step/start'],
  ]);
  assert.deepEqual(opening.assistantStream?.activeAttempt?.stream, [
    {type: 'chunk', time: 0, chunk: {type: 'block-end', index: 0, block: {type: 'text', text: 'In flight'}}},
  ]);
  const older = journal.page({maxMessages: 1, throughSeq: 5, beforeSeq: 2});
  assert.deepEqual(older.records[1]?.event.data, {
    id: 'first', role: 'user', source: {kind: 'user'}, content: [{type: 'text', text: 'Old 🙂 question'}],
  });
  assert.equal(older.hasMore, false);

  const final = {...assistant, id: 'published', parentId: 'last', text: 'Final answer', live};
  journal.accept({cut: {...cut, leafId: final.id, nativeRevision: 2, observationSeq: 2}, after: 0, through: 2, hasMore: false,
    events: [
      {seq: 1, kind: 'native_append', item: final,
        source: {kind: 'append', revision: 2, contextRevision: 1, sessionId: cut.sessionId,
          leafId: final.id, entryId: final.id}},
      {seq: 2, kind: 'message_settlement', item: final, live,
        settlement: {status: 'observed', durability: 'not_attested', entryId: final.id}},
    ],
  });
  assert.deepEqual(journal.page({maxMessages: 1, throughSeq: 5, beforeSeq: 2}), older);
  const latest = journal.page({maxMessages: 1});
  assert.deepEqual(latest.records.map(record => [record.event.seq, record.event.type]), [
    [5, 'step/start'], [6, 'assistant/message'], [7, 'step/end'],
  ]);
  assert.equal(latest.hasMore, true);
  assert.equal(journal.snapshot().assistantStream?.activeAttempt, undefined);
});

test('page byte limits keep chronological message groups separately addressable', async () => {
  const parts = (id: string, parentId: string | null) => Array.from({length: 13}, (_, partIndex) => ({
    ...item(partIndex === 0 ? id : `${id}:part:${partIndex}`, parentId, 'x'.repeat(32 * 1024)),
    entryId: id, partIndex, partCount: 13,
  }));
  const journal = await LiveJournal.open(fixture([parts('first', null), parts('last', 'first')]));
  const recent = journal.page({maxMessages: 2});
  assert.deepEqual(recent.records.map(record => record.event.seq), [2, 3]);
  assert.equal(recent.hasMore, true);
  const older = journal.page({maxMessages: 2, throughSeq: 3, beforeSeq: 2});
  assert.deepEqual(older.records.map(record => record.event.seq), [0, 1]);
  assert.equal(older.hasMore, false);
});

test('a branch change withdraws old pages and a fresh opening uses the same Native Session', async () => {
  const cut = {...initialCut, leafId: 'new-leaf', observationSeq: 1, nativeRevision: 2, contentRevision: 'content-v2'};
  const first = item('first', null, 'Shared ancestor');
  const old = await LiveJournal.open(fixture([[first], [item('last', 'first', 'Abandoned')]]));
  const oldCursor = old.cursor;
  assert.throws(() => old.accept({cut, after: 0, through: 1, hasMore: false,
    events: [{seq: 1, kind: 'native_setLeaf'}]}), /live_projection_invalidated/);
  assert.throws(() => old.page({throughSeq: oldCursor}), /live_projection_invalidated/);

  const current = await LiveJournal.open(fixture([[first], [item('new-leaf', 'first', 'Current')]], {cut}));
  assert.equal(current.sessionId, old.sessionId);
  assert.notEqual(current.generation, old.generation);
  assert.deepEqual(current.page({maxMessages: 1}).records[1]?.event.data, {
    id: 'new-leaf', role: 'user', source: {kind: 'user'}, content: [{type: 'text', text: 'Current'}],
  });
});
